import { extname } from 'path';

import { LETTER_TEMPLATE_MAX_BYTES } from '@/lib/letters/types';

export function validateLetterTemplateFile(
  name: string,
  size: number,
): { ok: true } | { ok: false; code: 'FILE_TOO_LARGE' | 'VALIDATION_ERROR'; message: string } {
  const ext = extname(name).toLowerCase();
  if (ext !== '.docx') {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'Шаблон должен быть в формате .docx',
    };
  }
  if (size > LETTER_TEMPLATE_MAX_BYTES) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `Файл превышает лимит 10 МБ (${LETTER_TEMPLATE_MAX_BYTES} байт)`,
    };
  }
  if (size === 0) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'Пустой файл шаблона',
    };
  }
  return { ok: true };
}
