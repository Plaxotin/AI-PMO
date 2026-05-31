import { NextRequest } from 'next/server';
import { parseProjectId } from '@/lib/api/project';
import { requireGoogleSession } from '@/lib/api/google-route-helpers';
import { jsonWithAuth, withAuth } from '@/lib/api/route-helpers';
import { apiError, validationError } from '@/lib/assignments/errors';
import { connectSheetBodySchema } from '@/lib/pmi/types';
import {
  deleteSpreadsheet,
  extractSpreadsheetId,
  getSpreadsheetTitle,
  listAssignmentRows,
  spreadsheetUrl,
  validatePmiHeaders,
} from '@/lib/google/sheets';
import { setBl6Session } from '@/lib/google/session';

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const authResult = await withAuth();
  if (!authResult.ok) return authResult.response;

  const { projectId } = await context.params;
  const project = parseProjectId(projectId);
  if (!project.ok) return project.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', 'Тело запроса должно быть JSON', 400);
  }

  const parsed = connectSheetBodySchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const spreadsheetId = extractSpreadsheetId(parsed.data.spreadsheet_url);
  if (!spreadsheetId) {
    return apiError('VALIDATION_ERROR', 'Некорректный URL Google Sheets', 400);
  }

  const google = await requireGoogleSession();
  if (!google.ok) return google.response;

  const valid = await validatePmiHeaders(google.auth, spreadsheetId);
  if (!valid) {
    return apiError(
      'SHEETS_API_ERROR',
      'Таблица не соответствует шаблону PMI (колонки A1:K1)',
      400,
    );
  }

  const autoId = google.session.sheet?.autoSpreadsheetId;
  if (autoId && autoId !== spreadsheetId) {
    try {
      await deleteSpreadsheet(google.auth, autoId);
    } catch {
      // non-fatal if already deleted
    }
  }

  const rows = await listAssignmentRows(google.auth, spreadsheetId);
  const title = await getSpreadsheetTitle(google.auth, spreadsheetId);

  await setBl6Session({
    ...google.session,
    sheet: {
      spreadsheetId,
      spreadsheetUrl: spreadsheetUrl(spreadsheetId),
    },
  });

  return jsonWithAuth(
    { ok: true, sheet_title: title, row_count: rows.length },
    { auth: authResult.auth },
  );
}
