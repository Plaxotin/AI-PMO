import { spawn } from 'child_process';
import { mkdtemp, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, extname } from 'path';

import { DOCUMENT_EXT, isDocumentExtension } from '@/lib/ingest/documents';

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.ogg', '.wav', '.opus']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv']);
const MEDIA_EXT = new Set([...AUDIO_EXT, ...VIDEO_EXT]);
/** Legacy Word — отклоняем с подсказкой сохранить как .docx */
const DOC_LEGACY_EXT = new Set(['.doc']);

const MAX_BYTES = 500 * 1024 * 1024;
const ASYNC_THRESHOLD = 25 * 1024 * 1024;

export const ALLOWED_EXTENSIONS: string[] = [
  ...MEDIA_EXT,
  ...DOCUMENT_EXT,
  ...DOC_LEGACY_EXT,
];

export function isMediaExtension(ext: string): boolean {
  return MEDIA_EXT.has(ext.toLowerCase());
}

export function isIngestExtension(ext: string): boolean {
  const e = ext.toLowerCase();
  return MEDIA_EXT.has(e) || isDocumentExtension(e) || DOC_LEGACY_EXT.has(e);
}

export function validateIngestFile(
  name: string,
  size: number,
): { ok: true } | { ok: false; message: string } {
  if (size > MAX_BYTES) {
    return {
      ok: false,
      message: 'Файл больше 500 МБ. Сожмите запись или разделите на части.',
    };
  }
  const ext = extname(name).toLowerCase();
  if (!isIngestExtension(ext)) {
    return {
      ok: false,
      message:
        'Формат не поддерживается. Допустимо: аудио/видео (.mp3, .mp4, …), протокол Word (.docx), .txt',
    };
  }
  if (ext === '.doc') {
    return {
      ok: false,
      message:
        'Формат .doc не поддерживается. Откройте файл в Word и сохраните как .docx.',
    };
  }
  return { ok: true };
}

export function shouldProcessAsync(size: number): boolean {
  return size >= ASYNC_THRESHOLD;
}

export async function saveUploadToTmp(
  file: File,
): Promise<{ dir: string; path: string; ext: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'bl6-ingest-'));
  const ext = extname(file.name).toLowerCase();
  const path = join(dir, `upload${ext}`);
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(path, buf);
  return { dir, path, ext };
}

export async function extractAudioPath(
  inputPath: string,
  ext: string,
): Promise<string> {
  if (AUDIO_EXT.has(ext.toLowerCase())) return inputPath;

  const outPath = inputPath.replace(/\.[^.]+$/, '.mp3');
  await runFfmpeg(['-i', inputPath, '-vn', '-acodec', 'libmp3lame', '-y', outPath]);
  return outPath;
}

async function runFfmpeg(args: string[]): Promise<void> {
  let ffmpegPath = 'ffmpeg';
  try {
    const mod = await import('ffmpeg-static');
    const p = mod.default;
    if (typeof p === 'string') ffmpegPath = p;
  } catch {
    // use system ffmpeg
  }

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    proc.stderr?.on('data', (d) => {
      err += d.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${err.slice(-500)}`));
    });
    proc.on('error', reject);
  });
}

export async function cleanupTmp(paths: string[]): Promise<void> {
  for (const p of paths) {
    try {
      await unlink(p);
    } catch {
      // ignore
    }
  }
}

export function meetingSourceLabel(fileName: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `Совещание ${fileName}, ${date}`;
}
