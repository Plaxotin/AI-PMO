import { NextRequest } from 'next/server';
import { parseProjectId } from '@/lib/api/project';
import { jsonWithAuth, withAuth } from '@/lib/api/route-helpers';
import { apiError, validationError } from '@/lib/assignments/errors';
import { parseTextBodySchema } from '@/lib/pmi/types';
import { parseAssignmentText } from '@/lib/llm/parse-assignment';
import { isLlmConfigured } from '@/lib/llm/client';

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const authResult = await withAuth();
  if (!authResult.ok) return authResult.response;

  const { projectId } = await context.params;
  const project = parseProjectId(projectId);
  if (!project.ok) return project.response;

  if (!isLlmConfigured()) {
    return apiError('LLM_ERROR', 'LLM не настроен (LLM_API_KEY)', 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', 'Тело запроса должно быть JSON', 400);
  }

  const parsed = parseTextBodySchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const result = await parseAssignmentText(parsed.data.text);
    return jsonWithAuth({ parsed: result }, { auth: authResult.auth });
  } catch (e) {
    return apiError(
      'LLM_ERROR',
      e instanceof Error ? e.message : 'Ошибка LLM',
      502,
    );
  }
}
