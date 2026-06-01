import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/assignments/errors';
import { GOOGLE_OAUTH_ERROR_PARAM } from '@/lib/google/oauth-errors';
import { exchangeCodeForTokens, mergeTokensIntoSession } from '@/lib/google/oauth';
import { getBl6Session, setBl6Session } from '@/lib/google/session';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const stateRaw = request.nextUrl.searchParams.get('state');
  const error = request.nextUrl.searchParams.get('error');

  let returnTo = '/assignments';
  if (stateRaw) {
    try {
      const state = JSON.parse(
        Buffer.from(stateRaw, 'base64url').toString('utf8'),
      ) as { returnTo?: string };
      if (state.returnTo?.startsWith('/')) returnTo = state.returnTo;
    } catch {
      // ignore invalid state
    }
  }

  if (error) {
    const base = request.nextUrl.origin;
    const dest = new URL(returnTo, base);
    dest.searchParams.set(GOOGLE_OAUTH_ERROR_PARAM, error);
    return NextResponse.redirect(dest);
  }

  if (!code) {
    return apiError('VALIDATION_ERROR', 'Отсутствует code', 400);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const existing = await getBl6Session();
    const session = await mergeTokensIntoSession(existing, tokens);
    await setBl6Session(session);
  } catch (e) {
    return apiError(
      'GOOGLE_NOT_CONNECTED',
      e instanceof Error ? e.message : 'OAuth callback failed',
      500,
    );
  }

  const base = request.nextUrl.origin;
  return NextResponse.redirect(new URL(returnTo, base));
}
