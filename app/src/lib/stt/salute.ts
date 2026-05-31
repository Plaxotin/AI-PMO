import { readFile } from 'fs/promises';

const SALUTE_OAUTH_URL =
  'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

export function isSaluteConfigured(): boolean {
  return Boolean(process.env.SALUTESPEECH_CLIENT_ID && process.env.SALUTESPEECH_SECRET);
}

async function getSaluteAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.SALUTESPEECH_CLIENT_ID!;
  const secret = process.env.SALUTESPEECH_SECRET!;
  const scope = process.env.SALUTESPEECH_SCOPE ?? 'SALUTE_SPEECH_PERS';
  const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const rqUid = crypto.randomUUID();

  const res = await fetch(SALUTE_OAUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      RqUID: rqUid,
    },
    body: new URLSearchParams({ scope }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SaluteSpeech OAuth ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) throw new Error('SaluteSpeech: no access_token');

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 1800) * 1000,
  };
  return cachedToken.accessToken;
}

/** Transcribe audio file via SaluteSpeech async recognize (simplified sync poll). */
export async function transcribeAudioFile(filePath: string): Promise<string> {
  const token = await getSaluteAccessToken();
  const audio = await readFile(filePath);

  const uploadRes = await fetch(
    'https://smartspeech.sber.ru/rest/v1/speech:async_recognize',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'audio/mpeg',
      },
      body: audio,
    },
  );

  if (uploadRes.status === 404 || uploadRes.status === 405) {
    return transcribeAudioFallback(filePath, token);
  }

  if (!uploadRes.ok) {
    return transcribeAudioFallback(filePath, token);
  }

  const uploadData = (await uploadRes.json()) as { id?: string; result?: string[] };
  if (uploadData.result?.length) {
    return uploadData.result.join('\n');
  }

  const taskId = uploadData.id;
  if (!taskId) {
    return transcribeAudioFallback(filePath, token);
  }

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusRes = await fetch(
      `https://smartspeech.sber.ru/rest/v1/task/${taskId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!statusRes.ok) continue;
    const status = (await statusRes.json()) as {
      status?: string;
      result?: string[];
    };
    if (status.status === 'DONE' && status.result?.length) {
      return status.result.join('\n');
    }
    if (status.status === 'ERROR') {
      throw new Error('SaluteSpeech recognition failed');
    }
  }

  throw new Error('SaluteSpeech recognition timeout');
}

async function transcribeAudioFallback(
  filePath: string,
  token: string,
): Promise<string> {
  const audio = await readFile(filePath);
  const res = await fetch(
    'https://smartspeech.sber.ru/rest/v1/speech:recognize',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'audio/mpeg',
      },
      body: audio,
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SaluteSpeech recognize ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { result?: string[]; text?: string };
  if (data.result?.length) return data.result.join('\n');
  if (data.text) return data.text;
  return '';
}
