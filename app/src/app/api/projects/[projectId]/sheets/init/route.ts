import { parseProjectId } from '@/lib/api/project';
import { requireGoogleSession } from '@/lib/api/google-route-helpers';
import { jsonWithAuth, withAuth } from '@/lib/api/route-helpers';
import { createPmiSpreadsheet } from '@/lib/google/sheets';
import { setBl6Session } from '@/lib/google/session';

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const authResult = await withAuth();
  if (!authResult.ok) return authResult.response;

  const { projectId } = await context.params;
  const project = parseProjectId(projectId);
  if (!project.ok) return project.response;

  const google = await requireGoogleSession();
  if (!google.ok) return google.response;

  const { spreadsheetId, spreadsheetUrl } = await createPmiSpreadsheet(
    google.auth,
  );

  const session = {
    ...google.session,
    sheet: {
      spreadsheetId,
      spreadsheetUrl,
      autoSpreadsheetId: spreadsheetId,
    },
  };
  await setBl6Session(session);

  return jsonWithAuth(
    { spreadsheet_url: spreadsheetUrl, spreadsheet_id: spreadsheetId },
    { auth: authResult.auth },
  );
}
