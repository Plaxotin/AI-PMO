import { NextRequest } from 'next/server';

import {
  ensureTenantReady,
  parseAndValidateTenantId,
  requireBl18Enabled,
} from '@/lib/api/bl18-route-helpers';
import { jsonWithAuth, withAuth, ensureDatabase } from '@/lib/api/route-helpers';
import { apiError } from '@/lib/assignments/errors';
import { uuidSchema } from '@/lib/assignments/types';
import { processTemplateDocxUpload } from '@/lib/letters/process-template-upload';

type RouteContext = {
  params: Promise<{ tenantId: string; id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const bl18 = requireBl18Enabled();
  if (!bl18.ok) return bl18.response;

  const authResult = await withAuth();
  if (!authResult.ok) return authResult.response;

  const db = ensureDatabase();
  if (!db.ok) return db.response;

  const { tenantId: tenantIdParam, id } = await context.params;
  const tenant = parseAndValidateTenantId(tenantIdParam);
  if (!tenant.ok) return tenant.response;

  const ready = await ensureTenantReady(tenant.tenantId);
  if (!ready.ok) return ready.response;

  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) {
    return apiError('VALIDATION_ERROR', 'Некорректный id шаблона', 400);
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!file || !(file instanceof File)) {
    return apiError('VALIDATION_ERROR', 'Поле file обязательно', 400);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await processTemplateDocxUpload({
    tenantId: tenant.tenantId,
    templateId: parsedId.data,
    fileName: file.name,
    bytes,
    name: '',
    createdBy:
      authResult.auth.mode === 'authenticated'
        ? authResult.auth.userId
        : null,
  });

  if (!result.ok) return result.response;

  return jsonWithAuth(
    {
      template_id: result.template_id,
      version: result.version,
      storage_key: result.storage_key,
    },
    { auth: authResult.auth, status: 201 },
  );
}
