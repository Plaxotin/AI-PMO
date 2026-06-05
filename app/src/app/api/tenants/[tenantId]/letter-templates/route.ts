import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

import {
  ensureTenantReady,
  parseAndValidateTenantId,
  requireBl18Enabled,
} from '@/lib/api/bl18-route-helpers';
import { jsonWithAuth, withAuth, ensureDatabase } from '@/lib/api/route-helpers';
import { apiError } from '@/lib/assignments/errors';
import { listLetterTemplates } from '@/lib/db/letter-templates';

type RouteContext = { params: Promise<{ tenantId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const bl18 = requireBl18Enabled();
    if (!bl18.ok) return bl18.response;

    const authResult = await withAuth();
    if (!authResult.ok) return authResult.response;

    const db = ensureDatabase();
    if (!db.ok) return db.response;

    const { tenantId: tenantIdParam } = await context.params;
    const tenant = parseAndValidateTenantId(tenantIdParam);
    if (!tenant.ok) return tenant.response;

    const ready = await ensureTenantReady(tenant.tenantId);
    if (!ready.ok) return ready.response;

    const data = await listLetterTemplates(tenant.tenantId);
    return jsonWithAuth({ data }, { auth: authResult.auth });
  } catch (e) {
    console.error('[BL-18] GET letter-templates', e);
    return apiError(
      'INTERNAL_ERROR',
      e instanceof Error ? e.message : 'Ошибка базы данных',
      500,
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
  const bl18 = requireBl18Enabled();
  if (!bl18.ok) return bl18.response;

  const authResult = await withAuth();
  if (!authResult.ok) return authResult.response;

  const db = ensureDatabase();
  if (!db.ok) return db.response;

  const { tenantId: tenantIdParam } = await context.params;
  const tenant = parseAndValidateTenantId(tenantIdParam);
  if (!tenant.ok) return tenant.response;

  const ready = await ensureTenantReady(tenant.tenantId);
  if (!ready.ok) return ready.response;

  const form = await request.formData();
  const file = form.get('file');
  if (!file || !(file instanceof File)) {
    return apiError('VALIDATION_ERROR', 'Поле file обязательно', 400);
  }

  const name = String(form.get('name') ?? '').trim();
  if (!name) {
    return apiError('VALIDATION_ERROR', 'Поле name обязательно', 400);
  }

  const organization = form.get('organization');
  const stylePassport = form.get('style_passport');

  const bytes = Buffer.from(await file.arrayBuffer());
  const { processTemplateDocxUpload } = await import(
    '@/lib/letters/process-template-upload'
  );
  const result = await processTemplateDocxUpload({
    tenantId: tenant.tenantId,
    fileName: file.name,
    bytes,
    name,
    organization:
      organization === null ? null : String(organization).trim() || null,
    stylePassport:
      stylePassport === null ? null : String(stylePassport).trim() || null,
    createdBy:
      authResult.auth.mode === 'authenticated'
        ? authResult.auth.userId
        : null,
  });

  if (!result.ok) return result.response;

  return jsonWithAuth(result, {
    auth: authResult.auth,
    status: 201,
  });
  } catch (e) {
    console.error('[BL-18] POST letter-templates', e);
    return apiError(
      'INTERNAL_ERROR',
      e instanceof Error ? e.message : 'Ошибка базы данных',
      500,
    );
  }
}
