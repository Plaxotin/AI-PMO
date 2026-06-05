import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function getLetterStorageRoot(): string {
  return (
    process.env.LETTER_STORAGE_PATH ??
    join(process.cwd(), '.data', 'letters')
  );
}

export function buildTemplateStorageKey(
  tenantId: string,
  templateId: string,
  version: number,
): string {
  return `${tenantId}/letters/templates/${templateId}/v${version}.docx`;
}

export async function saveTemplateBytes(
  storageKey: string,
  bytes: Buffer,
): Promise<void> {
  const fullPath = join(getLetterStorageRoot(), storageKey);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, bytes);
}

export async function readTemplateBytes(storageKey: string): Promise<Buffer> {
  const fullPath = join(getLetterStorageRoot(), storageKey);
  return readFile(fullPath);
}

export { DOCX_MIME };
