import { NextRequest } from 'next/server';
import {
  patchAssignmentBodySchema,
  uuidSchema,
} from '@/lib/assignments/types';
import { apiError, validationError } from '@/lib/assignments/errors';
import { parseProjectId } from '@/lib/api/project';
import {
  databaseUnavailableResponse,
  withAuth,
  jsonWithAuth,
} from '@/lib/api/route-helpers';
import {
  cancelAssignment,
  getAssignmentById,
  listAssignmentHistoryEvents,
  updateAssignment,
} from '@/lib/db/assignments';

type RouteContext = {
  params: Promise<{ projectId: string; assignmentId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const authResult = await withAuth();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { projectId, assignmentId } = await context.params;
  const project = parseProjectId(projectId);
  if (!project.ok) {
    return project.response;
  }

  const idParsed = uuidSchema.safeParse(assignmentId);
  if (!idParsed.success) {
    return apiError(
      'VALIDATION_ERROR',
      'Некорректный assignmentId (ожидается UUID)',
      400,
      idParsed.error.flatten(),
    );
  }

  const row = await getAssignmentById(project.projectId, idParsed.data);
  if (row === null) {
    return databaseUnavailableResponse();
  }
  if (row === undefined) {
    return apiError('NOT_FOUND', 'Поручение не найдено', 404);
  }

  const history = await listAssignmentHistoryEvents(project.projectId, idParsed.data);
  if (history === null) {
    return databaseUnavailableResponse();
  }

  return jsonWithAuth({ data: { ...row, history } }, { auth: authResult.auth });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const authResult = await withAuth();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { projectId, assignmentId } = await context.params;
  const project = parseProjectId(projectId);
  if (!project.ok) {
    return project.response;
  }

  const idParsed = uuidSchema.safeParse(assignmentId);
  if (!idParsed.success) {
    return validationError(idParsed.error);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', 'Тело запроса должно быть JSON', 400);
  }

  const parsedBody = patchAssignmentBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return validationError(parsedBody.error);
  }

  const updateResult = await updateAssignment(
    project.projectId,
    idParsed.data,
    parsedBody.data,
    authResult.auth.mode === 'authenticated' ? authResult.auth.userId : null,
  );

  if (!updateResult) {
    return databaseUnavailableResponse();
  }
  if (updateResult.kind === 'not_found') {
    return apiError('NOT_FOUND', 'Поручение не найдено', 404);
  }
  if (updateResult.kind === 'version_conflict') {
    return apiError(
      'VERSION_CONFLICT',
      'Запись изменилась, обновите данные и повторите попытку',
      409,
      {
        current_version: updateResult.current.version,
        assignment: updateResult.current,
      },
    );
  }

  return jsonWithAuth({ data: updateResult.assignment }, { auth: authResult.auth });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const authResult = await withAuth();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { projectId, assignmentId } = await context.params;
  const project = parseProjectId(projectId);
  if (!project.ok) {
    return project.response;
  }

  const idParsed = uuidSchema.safeParse(assignmentId);
  if (!idParsed.success) {
    return validationError(idParsed.error);
  }

  const cancelled = await cancelAssignment(
    project.projectId,
    idParsed.data,
    authResult.auth.mode === 'authenticated' ? authResult.auth.userId : null,
  );

  if (cancelled === null) {
    return databaseUnavailableResponse();
  }
  if (cancelled === undefined) {
    return apiError('NOT_FOUND', 'Поручение не найдено', 404);
  }

  return jsonWithAuth({ data: cancelled }, { auth: authResult.auth });
}
