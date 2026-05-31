import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'bl6_google_session';

export type GoogleTokenSession = {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
};

export type SheetProjectSession = {
  spreadsheetId: string;
  spreadsheetUrl: string;
  /** Auto-created sheet id — removed when user connects own registry */
  autoSpreadsheetId?: string;
};

export type Bl6Session = GoogleTokenSession & {
  sheet?: SheetProjectSession;
};

function sessionSecret(): string {
  const secret =
    process.env.SESSION_SECRET ??
    process.env.GOOGLE_CLIENT_SECRET ??
    'dev-only-change-me';
  return secret;
}

function sign(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

function encodeSession(session: Bl6Session): string {
  const json = JSON.stringify(session);
  const payload = Buffer.from(json, 'utf8').toString('base64url');
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

function decodeSession(value: string): Bl6Session | null {
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  try {
    if (
      expected.length !== sig.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(json) as Bl6Session;
  } catch {
    return null;
  }
}

export async function getBl6Session(): Promise<Bl6Session | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return decodeSession(raw);
}

export async function setBl6Session(session: Bl6Session): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, encodeSession(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearBl6Session(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REDIRECT_URI,
  );
}
