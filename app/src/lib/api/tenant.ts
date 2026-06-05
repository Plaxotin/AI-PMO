import { DEFAULT_TENANT_ID } from '@/lib/config';
import { apiError } from '@/lib/assignments/errors';
import { uuidSchema } from '@/lib/assignments/types';

export function parseTenantId(tenantId: string) {
  const parsed = uuidSchema.safeParse(tenantId);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: apiError(
        'VALIDATION_ERROR',
        'Некорректный tenantId (ожидается UUID)',
        400,
        parsed.error.flatten(),
      ),
    };
  }

  if (parsed.data !== DEFAULT_TENANT_ID) {
    return {
      ok: false as const,
      response: apiError(
        'TENANT_MISMATCH',
        `Для MVP доступен только тенант по умолчанию (${DEFAULT_TENANT_ID})`,
        404,
      ),
    };
  }

  return { ok: true as const, tenantId: parsed.data };
}
