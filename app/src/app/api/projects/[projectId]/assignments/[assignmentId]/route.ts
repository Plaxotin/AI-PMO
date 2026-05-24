import { NextRequest } from 'next/server';
import {
  patchAssignmentBodySchema,
  uuidSchema,
} from '@/lib/assignments/types';
import { apiError, validationError, notImplemented } from '@/lib/assignments/errors';
import { parseProjectId } from '@/lib/api/project';
import { withAuth, jsonWithAuth } from '@/lib/api/route-helpers';
import { getAssignmentById } from '@/lib/db/assignments';

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
    return apiError(
      'NOT_FOUND',
      'Поручение не найдено (БД не подключена или запись отсутствует)',
      404,
    );
  }
  if (row === undefined) {
    return apiError('NOT_FOUND', 'Поручение не найдено', 404);
  }

  return jsonWithAuth({ data: row }, { auth: authResult.auth });
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

  void project;
  void idParsed;

  return notImplemented('PATCH /assignments/:id (обновление поручения)');
}
