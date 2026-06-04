import { isBl18Enabled } from '@/lib/config';
import { letterApiError } from '@/lib/letters/errors';
import { tenantExists } from '@/lib/db/letter-templates';
import { parseTenantId } from '@/lib/api/tenant';
import { ensureDatabase } from '@/lib/api/route-helpers';

export function requireBl18Enabled() {
  if (!isBl18Enabled()) {
    return {
      ok: false as const,
      response: letterApiError(
        'BL18_DISABLED',
        'Модуль официальных писем отключён (BL18_ENABLED=false)',
        503,
      ),
    };
  }
  return { ok: true as const };
}

export async function ensureTenantReady(tenantId: string) {
  const db = ensureDatabase();
  if (!db.ok) return db;

  const exists = await tenantExists(tenantId);
  if (!exists) {
    return {
      ok: false as const,
      response: letterApiError(
        'TENANT_NOT_FOUND',
        'Тенант не найден. Примените миграции BL-18 и seed_bl18.sql',
        404,
      ),
    };
  }
  return { ok: true as const };
}

export function parseAndValidateTenantId(tenantId: string) {
  return parseTenantId(tenantId);
}

export async function checkTenantStorageQuota(
  tenantId: string,
  additionalBytes: number,
) {
  const { getTenantStorage } = await import('@/lib/db/letter-templates');
  const storage = await getTenantStorage(tenantId);
  if (!storage) {
    return {
      ok: false as const,
      response: letterApiError('TENANT_NOT_FOUND', 'Тенант не найден', 404),
    };
  }
  if (
    storage.storage_used_bytes + additionalBytes >
    storage.storage_quota_bytes
  ) {
    return {
      ok: false as const,
      response: letterApiError(
        'TENANT_STORAGE_QUOTA_EXCEEDED',
        'Превышена квота хранилища тенанта (1 ГБ). Освободите место или обратитесь к администратору.',
        422,
        {
          used_bytes: storage.storage_used_bytes,
          quota_bytes: storage.storage_quota_bytes,
          required_bytes: additionalBytes,
        },
      ),
    };
  }
  return { ok: true as const };
}
