import { getSql } from '@/lib/db/client';
import type { LetterTemplateDetail, LetterTemplateListItem } from '@/lib/letters/types';
import { DOCX_MIME } from '@/lib/letters/storage';

type DbTemplateRow = {
  id: string;
  tenant_id: string;
  name: string;
  organization: string | null;
  style_passport: string | null;
  active_version_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  active_version: number | null;
  storage_key: string | null;
  byte_size: string | number | null;
};

function rowToListItem(row: DbTemplateRow): LetterTemplateListItem {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    organization: row.organization,
    style_passport: row.style_passport,
    active_version: row.active_version,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

function rowToDetail(row: DbTemplateRow): LetterTemplateDetail {
  const base = rowToListItem(row);
  return {
    ...base,
    active_version_id: row.active_version_id,
    storage_key: row.storage_key,
    byte_size:
      row.byte_size === null || row.byte_size === undefined
        ? null
        : Number(row.byte_size),
  };
}

export async function tenantExists(tenantId: string): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM tenants WHERE id = ${tenantId}) AS exists
  `;
  return rows[0]?.exists ?? false;
}

export async function getTenantStorage(tenantId: string): Promise<{
  storage_used_bytes: number;
  storage_quota_bytes: number;
} | null> {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql<
    { storage_used_bytes: string; storage_quota_bytes: string }[]
  >`
    SELECT storage_used_bytes, storage_quota_bytes
    FROM tenants
    WHERE id = ${tenantId}
  `;
  if (!rows[0]) return null;
  return {
    storage_used_bytes: Number(rows[0].storage_used_bytes),
    storage_quota_bytes: Number(rows[0].storage_quota_bytes),
  };
}

export async function listLetterTemplates(
  tenantId: string,
): Promise<LetterTemplateListItem[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<DbTemplateRow[]>`
    SELECT
      t.id,
      t.tenant_id,
      t.name,
      t.organization,
      t.style_passport,
      t.active_version_id,
      t.created_at,
      t.updated_at,
      v.version AS active_version,
      o.storage_key,
      o.byte_size
    FROM letter_templates t
    LEFT JOIN letter_template_versions v ON v.id = t.active_version_id
    LEFT JOIN letter_storage_objects o ON o.id = v.storage_object_id

    WHERE t.tenant_id = ${tenantId}
    ORDER BY t.name ASC
  `;
  return rows.map(rowToListItem);
}

export async function getLetterTemplate(
  tenantId: string,
  templateId: string,
): Promise<LetterTemplateDetail | null> {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql<DbTemplateRow[]>`
    SELECT
      t.id,
      t.tenant_id,
      t.name,
      t.organization,
      t.style_passport,
      t.active_version_id,
      t.created_at,
      t.updated_at,
      v.version AS active_version,
      o.storage_key,
      o.byte_size
    FROM letter_templates t
    LEFT JOIN letter_template_versions v ON v.id = t.active_version_id
    LEFT JOIN letter_storage_objects o ON o.id = v.storage_object_id

    WHERE t.tenant_id = ${tenantId} AND t.id = ${templateId}
  `;
  if (!rows[0]) return null;
  return rowToDetail(rows[0]);
}

export type CreateTemplateInput = {
  tenantId: string;
  templateId: string;
  name: string;
  organization?: string | null;
  stylePassport?: string | null;
  storageKey: string;
  byteSize: number;
  createdBy?: string | null;
};

export async function createLetterTemplateWithVersion(
  input: CreateTemplateInput,
): Promise<{ templateId: string; version: number; storageKey: string }> {
  const sql = getSql();
  if (!sql) {
    throw new Error('DATABASE_UNAVAILABLE');
  }

  return sql.begin(async (tx) => {
    const storageRows = await tx<{ id: string }[]>`
      INSERT INTO letter_storage_objects (tenant_id, storage_key, byte_size, content_type)
      VALUES (${input.tenantId}, ${input.storageKey}, ${input.byteSize}, ${DOCX_MIME})
      RETURNING id
    `;
    const storageObjectId = storageRows[0].id;

    const templateRows = await tx<{ id: string }[]>`
      INSERT INTO letter_templates (id, tenant_id, name, organization, style_passport)
      VALUES (
        ${input.templateId},
        ${input.tenantId},
        ${input.name},
        ${input.organization ?? null},
        ${input.stylePassport ?? null}
      )
      RETURNING id
    `;
    const templateId = templateRows[0].id;

    const versionRows = await tx<{ id: string; version: number }[]>`
      INSERT INTO letter_template_versions (
        template_id, version, storage_object_id, created_by
      )
      VALUES (${templateId}, 1, ${storageObjectId}, ${input.createdBy ?? null})
      RETURNING id, version
    `;
    const versionId = versionRows[0].id;

    await tx`
      UPDATE letter_templates
      SET active_version_id = ${versionId}
      WHERE id = ${templateId}
    `;

    await tx`
      UPDATE tenants
      SET storage_used_bytes = storage_used_bytes + ${input.byteSize}
      WHERE id = ${input.tenantId}
    `;

    return {
      templateId,
      version: versionRows[0].version,
      storageKey: input.storageKey,
    };
  });
}

export type AddTemplateVersionInput = {
  tenantId: string;
  templateId: string;
  storageKey: string;
  byteSize: number;
  createdBy?: string | null;
};

export async function addLetterTemplateVersion(
  input: AddTemplateVersionInput,
): Promise<{ version: number; storageKey: string } | null> {
  const sql = getSql();
  if (!sql) return null;

  return sql.begin(async (tx) => {
    const templateRows = await tx<{ id: string }[]>`
      SELECT id FROM letter_templates
      WHERE id = ${input.templateId} AND tenant_id = ${input.tenantId}
    `;
    if (!templateRows[0]) return null;

    const maxRows = await tx<{ max_version: number | null }[]>`
      SELECT MAX(version) AS max_version
      FROM letter_template_versions
      WHERE template_id = ${input.templateId}
    `;
    const nextVersion = (maxRows[0]?.max_version ?? 0) + 1;

    const storageRows = await tx<{ id: string }[]>`
      INSERT INTO letter_storage_objects (tenant_id, storage_key, byte_size, content_type)
      VALUES (${input.tenantId}, ${input.storageKey}, ${input.byteSize}, ${DOCX_MIME})
      RETURNING id
    `;
    const storageObjectId = storageRows[0].id;

    const versionRows = await tx<{ id: string; version: number }[]>`
      INSERT INTO letter_template_versions (
        template_id, version, storage_object_id, created_by
      )
      VALUES (
        ${input.templateId},
        ${nextVersion},
        ${storageObjectId},
        ${input.createdBy ?? null}
      )
      RETURNING id, version
    `;

    await tx`
      UPDATE letter_templates
      SET active_version_id = ${versionRows[0].id}
      WHERE id = ${input.templateId}
    `;

    await tx`
      UPDATE tenants
      SET storage_used_bytes = storage_used_bytes + ${input.byteSize}
      WHERE id = ${input.tenantId}
    `;

    return {
      version: versionRows[0].version,
      storageKey: input.storageKey,
    };
  });
}
