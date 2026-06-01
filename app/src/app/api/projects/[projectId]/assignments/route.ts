import { NextRequest } from 'next/server';
import {
  requireGoogleSession,
  requireSheetConnection,
} from '@/lib/api/google-route-helpers';
import { apiError, validationError } from '@/lib/assignments/errors';
import { parseProjectId } from '@/lib/api/project';
import { jsonWithAuth, withAuth } from '@/lib/api/route-helpers';
import { getDevPreviewRows, isDevPreviewMode } from '@/lib/dev/preview';
import { createPmiRowBodySchema } from '@/lib/pmi/types';
import { appendRow, listAssignmentRows } from '@/lib/google/sheets';

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const authResult = await withAuth();
  if (!authResult.ok) return authResult.response;

  const { projectId } = await context.params;
  const project = parseProjectId(projectId);
  if (!project.ok) return project.response;

  if (isDevPreviewMode()) {
    const data = getDevPreviewRows();
    return jsonWithAuth(
      {
        data,
        meta: {
          total: data.length,
          spreadsheet_url: null,
          connected: true,
          dev_preview: true,
        },
      },
      { auth: authResult.auth },
    );
  }

  const google = await requireGoogleSession();
  if (!google.ok) return google.response;

  const sheetCheck = requireSheetConnection(google.session);
  if (!sheetCheck.ok) {
    return jsonWithAuth(
      {
        data: [],
        meta: {
          total: 0,
          spreadsheet_url: null,
          connected: false,
        },
      },
      { auth: authResult.auth },
    );
  }

  try {
    const data = await listAssignmentRows(
      google.auth,
      sheetCheck.sheet.spreadsheetId,
    );
    return jsonWithAuth(
      {
        data,
        meta: {
          total: data.length,
          spreadsheet_url: sheetCheck.sheet.spreadsheetUrl,
          connected: true,
        },
      },
      { auth: authResult.auth },
    );
  } catch (e) {
    return apiError(
      'SHEETS_API_ERROR',
      e instanceof Error ? e.message : 'Ошибка чтения Google Sheet',
      502,
    );
  }
}

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

  const parsed = createPmiRowBodySchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const google = await requireGoogleSession();
  if (!google.ok) return google.response;

  const sheetCheck = requireSheetConnection(google.session);
  if (!sheetCheck.ok) return sheetCheck.response;

  try {
    const { row_number } = await appendRow(
      google.auth,
      sheetCheck.sheet.spreadsheetId,
      parsed.data,
    );
    return jsonWithAuth(
      { ok: true, row_number },
      { auth: authResult.auth, status: 201 },
    );
  } catch (e) {
    return apiError(
      'SHEETS_API_ERROR',
      e instanceof Error ? e.message : 'Ошибка записи в Google Sheet',
      502,
    );
  }
}
