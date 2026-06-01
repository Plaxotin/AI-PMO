import { NextRequest } from 'next/server';

export const maxDuration = 300;
export const runtime = 'nodejs';
import { parseProjectId } from '@/lib/api/project';
import { jsonWithAuth, withAuth } from '@/lib/api/route-helpers';
import { apiError } from '@/lib/assignments/errors';
import { validateIngestFile, shouldProcessAsync } from '@/lib/ingest/media';
import {
  isDocumentFile,
  isMediaFile,
  processIngestFile,
  startAsyncIngest,
} from '@/lib/ingest/processor';
import { createJob, updateJob } from '@/lib/ingest/jobs';
import { isSaluteConfigured } from '@/lib/stt/salute';
import { isLlmConfigured } from '@/lib/llm/client';

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const authResult = await withAuth();
  if (!authResult.ok) return authResult.response;

  const { projectId } = await context.params;
  const project = parseProjectId(projectId);
  if (!project.ok) return project.response;

  if (!isLlmConfigured()) {
    return apiError('LLM_ERROR', 'LLM не настроен', 503);
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!file || !(file instanceof File)) {
    return apiError('VALIDATION_ERROR', 'Поле file обязательно', 400);
  }

  const check = validateIngestFile(file.name, file.size);
  if (!check.ok) {
    return apiError('INGEST_ERROR', check.message, 400);
  }

  if (isMediaFile(file) && !isSaluteConfigured()) {
    return apiError('STT_ERROR', 'SaluteSpeech не настроен (нужен для аудио/видео)', 503);
  }

  if (!isMediaFile(file) && !isDocumentFile(file)) {
    return apiError('INGEST_ERROR', 'Неподдерживаемый тип файла', 400);
  }

  if (shouldProcessAsync(file.size)) {
    const jobId = startAsyncIngest(file);
    return jsonWithAuth(
      { job_id: jobId, status: 'pending', async: true },
      { auth: authResult.auth, status: 202 },
    );
  }

  const jobId = crypto.randomUUID();
  createJob(jobId);
  try {
    const drafts = await processIngestFile(file, jobId);
    return jsonWithAuth(
      { job_id: jobId, status: 'done', drafts },
      { auth: authResult.auth },
    );
  } catch (e) {
    updateJob(jobId, {
      status: 'failed',
      error: e instanceof Error ? e.message : String(e),
    });
    return apiError(
      'INGEST_ERROR',
      e instanceof Error ? e.message : 'Ошибка обработки файла',
      502,
    );
  }
}
