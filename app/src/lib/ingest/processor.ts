import { parseMeetingTranscript } from '@/lib/llm/parse-assignment';
import { transcribeAudioFile } from '@/lib/stt/salute';
import {
  cleanupTmp,
  extractAudioPath,
  meetingSourceLabel,
  saveUploadToTmp,
} from '@/lib/ingest/media';
import { createJob, updateJob } from '@/lib/ingest/jobs';
import type { ParsedAssignment } from '@/lib/pmi/types';

export async function processIngestFile(
  file: File,
  jobId: string,
): Promise<ParsedAssignment[]> {
  updateJob(jobId, { status: 'processing', stage: 'Загрузка…' });

  const { dir, path, ext } = await saveUploadToTmp(file);
  const tmpPaths = [path];

  try {
    updateJob(jobId, { stage: 'Транскрипция…' });
    const audioPath = await extractAudioPath(path, ext);
    if (audioPath !== path) tmpPaths.push(audioPath);

    const transcript = await transcribeAudioFile(audioPath);
    if (!transcript.trim()) {
      throw new Error('Не удалось получить транскрипт');
    }

    updateJob(jobId, { stage: 'Извлечение поручений…' });
    const source = meetingSourceLabel(file.name);
    const drafts = await parseMeetingTranscript(transcript, source);

    updateJob(jobId, { status: 'done', drafts, stage: undefined });
    return drafts;
  } finally {
    await cleanupTmp(tmpPaths);
    try {
      const { rmdir } = await import('fs/promises');
      await rmdir(dir);
    } catch {
      // ignore
    }
  }
}

export function startAsyncIngest(file: File): string {
  const jobId = crypto.randomUUID();
  createJob(jobId);
  void processIngestFile(file, jobId).catch((err) => {
    updateJob(jobId, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
  });
  return jobId;
}
