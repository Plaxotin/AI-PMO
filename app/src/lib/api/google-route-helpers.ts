import { NextResponse } from 'next/server';
import { apiError } from '@/lib/assignments/errors';
import {
  getBl6Session,
  isGoogleOAuthConfigured,
  setBl6Session,
  type Bl6Session,
} from '@/lib/google/session';
import { getAuthenticatedClient } from '@/lib/google/oauth';
import type { OAuth2Client } from 'google-auth-library';

export async function requireGoogleSession(): Promise<
  | { ok: true; session: Bl6Session; auth: OAuth2Client }
  | { ok: false; response: NextResponse }
> {
  if (!isGoogleOAuthConfigured()) {
    return {
      ok: false,
      response: apiError(
        'GOOGLE_NOT_CONNECTED',
        'Google OAuth не настроен. См. docs/plans/BL2-0_SECRETS_SETUP.md',
        503,
      ),
    };
  }

  const session = await getBl6Session();
  if (!session?.accessToken || !session.refreshToken) {
    return {
      ok: false,
      response: apiError(
        'GOOGLE_NOT_CONNECTED',
        'Войдите через Google для доступа к таблице',
        401,
      ),
    };
  }

  try {
    const { client, refreshed } = await getAuthenticatedClient(session);
    if (
      refreshed.accessToken !== session.accessToken ||
      refreshed.expiryDate !== session.expiryDate
    ) {
      await setBl6Session({ ...session, ...refreshed });
    }
    return { ok: true, session: { ...session, ...refreshed }, auth: client };
  } catch (e) {
    return {
      ok: false,
      response: apiError(
        'GOOGLE_NOT_CONNECTED',
        e instanceof Error ? e.message : 'Ошибка Google OAuth',
        401,
      ),
    };
  }
}

export function requireSheetConnection(session: Bl6Session) {
  if (!session.sheet?.spreadsheetId) {
    return {
      ok: false as const,
      response: apiError(
        'SHEETS_NOT_CONNECTED',
        'Реестр не подключён. Вызовите sheets/init или sheets/connect.',
        400,
      ),
    };
  }
  return { ok: true as const, sheet: session.sheet };
}
