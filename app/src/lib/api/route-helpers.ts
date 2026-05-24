import { NextResponse } from 'next/server';
import { getAuthResult, authHeaders } from '@/lib/auth/session';
import { apiError } from '@/lib/assignments/errors';
import { isDatabaseConfigured } from '@/lib/config';

export async function withAuth() {
  const auth = await getAuthResult();
  if (auth.mode === 'unauthenticated') {
    return {
      ok: false as const,
      response: apiError(
        'UNAUTHORIZED',
        'Требуется вход (Supabase Auth). См. docs/BL1-0_ENV.md',
        401,
      ),
    };
  }
  return { ok: true as const, auth };
}

export function jsonWithAuth<T>(
  body: T,
  init: { status?: number; auth: Awaited<ReturnType<typeof getAuthResult>> },
) {
  return NextResponse.json(body, {
    status: init.status ?? 200,
    headers: authHeaders(init.auth),
  });
}

export function databaseUnavailableResponse() {
  return apiError(
    'DATABASE_UNAVAILABLE',
    'База не настроена. Укажите DATABASE_URL или Supabase и примените supabase/migrations.',
    503,
  );
}

export function ensureDatabase() {
  if (!isDatabaseConfigured()) {
    return { ok: false as const, response: databaseUnavailableResponse() };
  }
  return { ok: true as const };
}
