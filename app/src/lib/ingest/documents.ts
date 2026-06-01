import { readFile } from 'fs/promises';
import mammoth from 'mammoth';

export const DOCUMENT_EXT = new Set(['.docx', '.txt']);

export function isDocumentExtension(ext: string): boolean {
  return DOCUMENT_EXT.has(ext.toLowerCase());
}

export async function extractDocumentText(
  filePath: string,
  ext: string,
): Promise<string> {
  const normalized = ext.toLowerCase();

  if (normalized === '.txt') {
    const text = await readFile(filePath, 'utf8');
    return text.trim();
  }

  if (normalized === '.doc') {
    throw new Error(
      'Формат .doc (Word 97–2003) не поддерживается. Сохраните протокол как .docx в Word.',
    );
  }

  if (normalized === '.docx') {
    const buffer = await readFile(filePath);
    const { value } = await mammoth.extractRawText({ buffer });
    return value.trim();
  }

  throw new Error(`Документ формата ${ext} не поддерживается`);
}
