import { NextRequest } from 'next/server';

import {
  ensureTenantReady,
  parseAndValidateTenantId,
  requireBl18Enabled,
} from '@/lib/api/bl18-route-helpers';
import { jsonWithAuth, withAuth, ensureDatabase } from '@/lib/api/route-helpers';
import { apiError } from '@/lib/assignments/errors';
import { uuidSchema } from '@/lib/assignments/types';
import { getLetterTemplate } from '@/lib/db/letter-templates';

type RouteContext = {
  params: Promise<{ tenantId: string; id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
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

  const template = await getLetterTemplate(tenant.tenantId, parsedId.data);
  if (!template) {
    return apiError('NOT_FOUND', 'Шаблон не найден', 404);
  }

  return jsonWithAuth({ data: template }, { auth: authResult.auth });
}
