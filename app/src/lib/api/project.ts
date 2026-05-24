import { DEFAULT_PROJECT_ID } from '@/lib/config';
import { apiError } from '@/lib/assignments/errors';
import { uuidSchema } from '@/lib/assignments/types';

export function parseProjectId(projectId: string) {
  const parsed = uuidSchema.safeParse(projectId);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: apiError(
        'VALIDATION_ERROR',
        'Некорректный projectId (ожидается UUID)',
        400,
        parsed.error.flatten(),
      ),
    };
  }

  if (parsed.data !== DEFAULT_PROJECT_ID) {
    return {
      ok: false as const,
      response: apiError(
        'PROJECT_MISMATCH',
        `Для MVP доступен только глобальный проект (${DEFAULT_PROJECT_ID})`,
        404,
      ),
    };
  }

  return { ok: true as const, projectId: parsed.data };
}
