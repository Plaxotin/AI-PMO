import { randomUUID } from 'crypto';

import {
  addLetterTemplateVersion,
  createLetterTemplateWithVersion,
  getLetterTemplate,
} from '@/lib/db/letter-templates';
import { checkTenantStorageQuota } from '@/lib/api/bl18-route-helpers';
import { validateLetterTemplateFile } from '@/lib/letters/media';
import { letterApiError } from '@/lib/letters/errors';
import {
  buildTemplateStorageKey,
  saveTemplateBytes,
} from '@/lib/letters/storage';
import { extractPlaceholdersFromDocx } from '@/lib/letters/template-placeholders';
import { validateTemplatePlaceholders } from '@/lib/letters/template-validation';

export async function processTemplateDocxUpload(params: {
  tenantId: string;
  templateId?: string;
  fileName: string;
  bytes: Buffer;
  name: string;
  organization?: string | null;
  stylePassport?: string | null;
  createdBy?: string | null;
}): Promise<
  | { ok: true; template_id: string; version: number; storage_key: string }
  | { ok: false; response: ReturnType<typeof letterApiError> }
> {
  const check = validateLetterTemplateFile(params.fileName, params.bytes.length);
  if (!check.ok) {
    if (check.code === 'FILE_TOO_LARGE') {
      return {
        ok: false,
        response: letterApiError('FILE_TOO_LARGE', check.message, 422),
      };
    }
    return {
      ok: false,
      response: letterApiError('VALIDATION_ERROR', check.message, 400),
    };
  }

  const quota = await checkTenantStorageQuota(
    params.tenantId,
    params.bytes.length,
  );
  if (!quota.ok) return { ok: false, response: quota.response };

  let placeholders: Set<string>;
  try {
    placeholders = extractPlaceholdersFromDocx(params.bytes);
  } catch {
    return {
      ok: false,
      response: letterApiError(
        'VALIDATION_ERROR',
        'Не удалось прочитать DOCX. Убедитесь, что файл — корректный документ Word (.docx).',
        400,
      ),
    };
  }

  const validation = validateTemplatePlaceholders(placeholders);
  if (!validation.ok) {
    return {
      ok: false,
      response: letterApiError(
        'TEMPLATE_VALIDATION_FAILED',
        'В шаблоне отсутствуют обязательные плейсхолдеры',
        422,
        {
          missing: validation.missing,
          checklist: validation.checklist,
          found: [...placeholders].sort(),
        },
      ),
    };
  }

  let templateId: string;
  let version: number;

  if (params.templateId) {
    const existing = await getLetterTemplate(
      params.tenantId,
      params.templateId,
    );
    if (!existing) {
      return {
        ok: false,
        response: letterApiError('NOT_FOUND', 'Шаблон не найден', 404),
      };
    }
    templateId = params.templateId;
    version = (existing.active_version ?? 0) + 1;
  } else {
    templateId = randomUUID();
    version = 1;
  }

  const storageKey = buildTemplateStorageKey(
    params.tenantId,
    templateId,
    version,
  );

  await saveTemplateBytes(storageKey, params.bytes);

  try {
    if (params.templateId) {
      const result = await addLetterTemplateVersion({
        tenantId: params.tenantId,
        templateId,
        storageKey,
        byteSize: params.bytes.length,
        createdBy: params.createdBy,
      });
      if (!result) {
        return {
          ok: false,
          response: letterApiError('NOT_FOUND', 'Шаблон не найден', 404),
        };
      }
      return {
        ok: true,
        template_id: templateId,
        version: result.version,
        storage_key: result.storageKey,
      };
    }

    const created = await createLetterTemplateWithVersion({
      tenantId: params.tenantId,
      templateId,
      name: params.name,
      organization: params.organization,
      stylePassport: params.stylePassport,
      storageKey,
      byteSize: params.bytes.length,
      createdBy: params.createdBy,
    });

    return {
      ok: true,
      template_id: created.templateId,
      version: created.version,
      storage_key: created.storageKey,
    };
  } catch (e) {
    return {
      ok: false,
      response: letterApiError(
        'INTERNAL_ERROR',
        e instanceof Error ? e.message : 'Ошибка сохранения шаблона',
        500,
      ),
    };
  }
}
