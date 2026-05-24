import { NextRequest } from 'next/server';
import {
  assignmentListQuerySchema,
  createAssignmentBodySchema,
} from '@/lib/assignments/types';
import {
  apiError,
  validationError,
  notImplemented,
} from '@/lib/assignments/errors';
import { parseProjectId } from '@/lib/api/project';
import { jsonWithAuth, withAuth } from '@/lib/api/route-helpers';
import { listAssignments } from '@/lib/db/assignments';

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const authResult = await withAuth();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { projectId } = await context.params;
  const project = parseProjectId(projectId);
  if (!project.ok) {
    return project.response;
  }

  const queryParams = Object.fromEntries(request.nextUrl.searchParams);
  const parsedQuery = assignmentListQuerySchema.safeParse(queryParams);
  if (!parsedQuery.success) {
    return validationError(parsedQuery.error);
  }

  const result = await listAssignments(project.projectId, parsedQuery.data);
  if (!result) {
    return jsonWithAuth(
      {
        data: [],
        meta: {
          total: 0,
          limit: parsedQuery.data.limit,
          offset: parsedQuery.data.offset,
        },
      },
      { auth: authResult.auth },
    );
  }

  return jsonWithAuth(result, { auth: authResult.auth });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authResult = await withAuth();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { projectId } = await context.params;
  const project = parseProjectId(projectId);
  if (!project.ok) {
    return project.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(
      'VALIDATION_ERROR',
      'Тело запроса должно быть JSON',
      400,
    );
  }

  const parsedBody = createAssignmentBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return validationError(parsedBody.error);
  }

  return notImplemented('POST /assignments (создание поручения)');
}
