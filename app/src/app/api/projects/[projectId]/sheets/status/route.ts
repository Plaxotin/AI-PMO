import { parseProjectId } from '@/lib/api/project';
import { requireGoogleSession } from '@/lib/api/google-route-helpers';
import { jsonWithAuth, withAuth } from '@/lib/api/route-helpers';
import { isDevPreviewMode } from '@/lib/dev/preview';
import { isGoogleOAuthConfigured } from '@/lib/google/session';

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await withAuth();
  if (!authResult.ok) return authResult.response;

  const { projectId } = await context.params;
  const project = parseProjectId(projectId);
  if (!project.ok) return project.response;

  if (isDevPreviewMode()) {
    return jsonWithAuth(
      {
        connected: true,
        oauth_configured: true,
        google_signed_in: true,
        dev_preview: true,
        spreadsheet_url: null,
      },
      { auth: authResult.auth },
    );
  }

  if (!isGoogleOAuthConfigured()) {
    return jsonWithAuth(
      { connected: false, oauth_configured: false },
      { auth: authResult.auth },
    );
  }

  const google = await requireGoogleSession();
  if (!google.ok) {
    return jsonWithAuth(
      { connected: false, oauth_configured: true, google_signed_in: false },
      { auth: authResult.auth },
    );
  }

  const sheet = google.session.sheet;
  return jsonWithAuth(
    {
      connected: Boolean(sheet?.spreadsheetId),
      spreadsheet_url: sheet?.spreadsheetUrl,
      spreadsheet_id: sheet?.spreadsheetId,
      google_signed_in: true,
    },
    { auth: authResult.auth },
  );
}
