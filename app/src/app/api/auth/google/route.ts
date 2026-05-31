import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/assignments/errors';
import { getGoogleAuthUrl } from '@/lib/google/oauth';
import { isGoogleOAuthConfigured } from '@/lib/google/session';

export async function GET(request: NextRequest) {
  if (!isGoogleOAuthConfigured()) {
    return apiError(
      'GOOGLE_NOT_CONNECTED',
      'Google OAuth env не настроен',
      503,
    );
  }

  const returnTo =
    request.nextUrl.searchParams.get('returnTo') ?? '/assignments';
  const state = Buffer.from(
    JSON.stringify({ returnTo }),
    'utf8',
  ).toString('base64url');

  const url = getGoogleAuthUrl(state);
  return NextResponse.redirect(url);
}
