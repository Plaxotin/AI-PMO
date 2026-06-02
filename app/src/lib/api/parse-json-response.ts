/** Vercel Serverless: ~4.5 MB request body (до route handler). */
export const VERCEL_HOSTING_UPLOAD_LIMIT_BYTES = Math.floor(4.5 * 1024 * 1024);

export function isVercelProductionHost(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.includes('vercel.app');
}

export type ParsedApiResponse<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; status: number; message: string };

export async function parseJsonResponse<T = unknown>(
  res: Response,
): Promise<ParsedApiResponse<T>> {
  const text = await res.text();

  if (!text) {
    return {
      ok: false,
      status: res.status,
      message: res.statusText || `HTTP ${res.status}`,
    };
  }

  const trimmed = text.trimStart();
  if (
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<HTML')
  ) {
    return {
      ok: false,
      status: res.status,
      message:
        'Сервер вернул HTML вместо JSON (часто из‑за неверного URL API). ' +
        'Обновите страницу; если ошибка повторяется — проверьте деплой /api на Vercel.',
    };
  }

  try {
    const data = JSON.parse(text) as T;
    if (!res.ok) {
      const err = data as { error?: { message?: string } };
      return {
        ok: false,
        status: res.status,
        message: err?.error?.message ?? `HTTP ${res.status}`,
      };
    }
    return { ok: true, data, status: res.status };
  } catch {
    if (res.status === 413 || /request entity too large/i.test(text)) {
      return {
        ok: false,
        status: 413,
        message:
          'Файл слишком большой для загрузки на Vercel (лимит платформы ~4,5 МБ). ' +
          'Сожмите видео, экспортируйте аудио (mp3) или загрузите фрагмент до 4 МБ. ' +
          'Полный лимит 500 МБ из спеки — при self-host без лимита Vercel.',
      };
    }
    return {
      ok: false,
      status: res.status,
      message: text.slice(0, 300) || `Ответ сервера не JSON (HTTP ${res.status})`,
    };
  }
}

export function hostingUploadLimitMessage(fileSize: number): string | null {
  if (!isVercelProductionHost()) return null;
  if (fileSize <= VERCEL_HOSTING_UPLOAD_LIMIT_BYTES) return null;
  const mb = (VERCEL_HOSTING_UPLOAD_LIMIT_BYTES / (1024 * 1024)).toFixed(1);
  const fileMb = (fileSize / (1024 * 1024)).toFixed(1);
  return (
    `Файл ${fileMb} МБ превышает лимит загрузки на Vercel (~${mb} МБ). ` +
    'Сожмите видео, конвертируйте в mp3 или используйте более короткий фрагмент.'
  );
}
