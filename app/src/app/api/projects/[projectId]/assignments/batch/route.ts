import { NextRequest } from 'next/server';
import { parseProjectId } from '@/lib/api/project';
import {
  requireGoogleSession,
  requireSheetConnection,
} from '@/lib/api/google-route-helpers';
import { jsonWithAuth, withAuth } from '@/lib/api/route-helpers';
import { apiError, validationError } from '@/lib/assignments/errors';
import { batchPmiRowsBodySchema, updatePmiRowsBodySchema } from '@/lib/pmi/types';
import { appendRowsBatch, updateRowsBatch } from '@/lib/google/sheets';

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

  const parsed = batchPmiRowsBodySchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const google = await requireGoogleSession();
  if (!google.ok) return google.response;

  const sheetCheck = requireSheetConnection(google.session);
  if (!sheetCheck.ok) return sheetCheck.response;

  try {
    const result = await appendRowsBatch(
      google.auth,
      sheetCheck.sheet.spreadsheetId,
      parsed.data.rows,
    );
    return jsonWithAuth(
      { ok: true, rows_written: result.rows_written },
      { auth: authResult.auth },
    );
  } catch (e) {
    return apiError(
      'SHEETS_API_ERROR',
      e instanceof Error ? e.message : 'Ошибка записи в Google Sheet',
      502,
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
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

  const parsed = updatePmiRowsBodySchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const google = await requireGoogleSession();
  if (!google.ok) return google.response;

  const sheetCheck = requireSheetConnection(google.session);
  if (!sheetCheck.ok) return sheetCheck.response;

  try {
    const result = await updateRowsBatch(
      google.auth,
      sheetCheck.sheet.spreadsheetId,
      parsed.data.rows,
    );
    return jsonWithAuth(
      { ok: true, rows_updated: result.rows_updated },
      { auth: authResult.auth },
    );
  } catch (e) {
    return apiError(
      'SHEETS_API_ERROR',
      e instanceof Error ? e.message : 'Ошибка обновления Google Sheet',
      502,
    );
  }
}
