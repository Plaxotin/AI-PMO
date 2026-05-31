import { OAuth2Client } from 'google-auth-library';
import { GOOGLE_SHEETS_SCOPES } from '@/lib/google/scopes';
import type { Bl6Session, GoogleTokenSession } from '@/lib/google/session';

export function createOAuth2Client(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth env not configured');
  }
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

export function getGoogleAuthUrl(state: string): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SHEETS_SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(
  code: string,
): Promise<GoogleTokenSession> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Google OAuth: missing access or refresh token');
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryDate: tokens.expiry_date ?? Date.now() + 3600_000,
  };
}

export async function getAuthenticatedClient(session: GoogleTokenSession) {
  const client = createOAuth2Client();
  client.setCredentials({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expiry_date: session.expiryDate,
  });

  if (session.expiryDate <= Date.now() + 60_000) {
    const { credentials } = await client.refreshAccessToken();
    session.accessToken = credentials.access_token ?? session.accessToken;
    session.expiryDate = credentials.expiry_date ?? Date.now() + 3600_000;
    client.setCredentials(credentials);
  }

  return { client, refreshed: session };
}

export async function mergeTokensIntoSession(
  existing: Bl6Session | null,
  tokens: GoogleTokenSession,
): Promise<Bl6Session> {
  return {
    ...tokens,
    sheet: existing?.sheet,
  };
}
