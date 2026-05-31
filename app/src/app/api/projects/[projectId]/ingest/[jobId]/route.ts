import { parseProjectId } from '@/lib/api/project';
import { jsonWithAuth, withAuth } from '@/lib/api/route-helpers';
import { apiError } from '@/lib/assignments/errors';
import { getJob } from '@/lib/ingest/jobs';

type RouteContext = {
  params: Promise<{ projectId: string; jobId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await withAuth();
  if (!authResult.ok) return authResult.response;

  const { projectId, jobId } = await context.params;
  const project = parseProjectId(projectId);
  if (!project.ok) return project.response;

  const job = getJob(jobId);
  if (!job) {
    return apiError('NOT_FOUND', 'Задача инжеста не найдена', 404);
  }

  return jsonWithAuth(
    {
      status: job.status,
      stage: job.stage,
      drafts: job.drafts,
      error: job.error,
    },
    { auth: authResult.auth },
  );
}
