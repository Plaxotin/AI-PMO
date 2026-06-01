import { extname } from 'path';
import { parseMeetingTranscript } from '@/lib/llm/parse-assignment';
import { transcribeAudioFile } from '@/lib/stt/salute';
import { extractDocumentText, isDocumentExtension } from '@/lib/ingest/documents';
import {
  cleanupTmp,
  extractAudioPath,
  isMediaExtension,
  meetingSourceLabel,
  saveUploadToTmp,
} from '@/lib/ingest/media';
import { createJob, updateJob } from '@/lib/ingest/jobs';
import type { ParsedAssignment } from '@/lib/pmi/types';

async function processMediaFile(
  path: string,
  ext: string,
  fileName: string,
  jobId: string,
  tmpPaths: string[],
): Promise<ParsedAssignment[]> {
  updateJob(jobId, { stage: 'Транскрипция…' });
  const audioPath = await extractAudioPath(path, ext);
  if (audioPath !== path) tmpPaths.push(audioPath);

  const transcript = await transcribeAudioFile(audioPath);
  if (!transcript.trim()) {
    throw new Error('Не удалось получить транскрипт');
  }

  updateJob(jobId, { stage: 'Извлечение поручений…' });
  const source = meetingSourceLabel(fileName);
  return parseMeetingTranscript(transcript, source);
}

async function processDocumentFile(
  path: string,
  ext: string,
  fileName: string,
  jobId: string,
): Promise<ParsedAssignment[]> {
  updateJob(jobId, { stage: 'Чтение документа…' });
  const text = await extractDocumentText(path, ext);
  if (!text.trim()) {
    throw new Error('Документ пуст или не удалось извлечь текст');
  }

  updateJob(jobId, { stage: 'Извлечение поручений…' });
  const source = `Протокол ${fileName}, ${new Date().toISOString().slice(0, 10)}`;
  return parseMeetingTranscript(text, source);
}

export async function processIngestFile(
  file: File,
  jobId: string,
): Promise<ParsedAssignment[]> {
  updateJob(jobId, { status: 'processing', stage: 'Загрузка…' });

  const { dir, path, ext } = await saveUploadToTmp(file);
  const tmpPaths = [path];

  try {
    const drafts = isDocumentExtension(ext)
      ? await processDocumentFile(path, ext, file.name, jobId)
      : await processMediaFile(path, ext, file.name, jobId, tmpPaths);

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

export function isDocumentFile(file: File): boolean {
  return isDocumentExtension(extname(file.name));
}

export function isMediaFile(file: File): boolean {
  return isMediaExtension(extname(file.name));
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
