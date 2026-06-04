import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { spawnSync } from 'child_process';

import { DEFAULT_TENANT_ID } from '@/lib/config';
import { processTemplateDocxUpload } from '@/lib/letters/process-template-upload';
import {
  buildInvalidTemplateDocx,
  buildValidTemplateDocx,
} from '@/lib/letters/test-helpers/build-docx';
import { readTemplateBytes } from '@/lib/letters/storage';
import { getLetterTemplate } from '@/lib/db/letter-templates';

const dbUrl = process.env.DATABASE_URL;
const describeDb = dbUrl ? describe : describe.skip;

describeDb('BL18-R1 letter templates (integration)', () => {
  beforeAll(() => {
    process.env.BL18_ENABLED = 'true';
    process.env.LETTER_STORAGE_PATH = join(
      process.cwd(),
      '.data',
      'letters-test',
    );
    const repoRoot = join(process.cwd(), '..');
    const files = [
      'supabase/migrations/20260524000000_bl1_v1.sql',
      'supabase/migrations/20260604000000_bl18_tenants.sql',
      'supabase/migrations/20260604000001_bl18_letters.sql',
      'supabase/seed_bl18.sql',
    ];
    for (const f of files) {
      spawnSync('psql', [dbUrl!, '-f', join(repoRoot, f)], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    }
  });

  it('uploads valid template with version 1 and storage key', async () => {
    const bytes = buildValidTemplateDocx();
    const result = await processTemplateDocxUpload({
      tenantId: DEFAULT_TENANT_ID,
      fileName: 'template-valid.docx',
      bytes,
      name: `IT valid ${Date.now()}`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.version).toBe(1);
    expect(result.storage_key).toContain('/letters/templates/');

    const onDisk = await readTemplateBytes(result.storage_key);
    expect(onDisk.length).toBe(bytes.length);

    const meta = await getLetterTemplate(
      DEFAULT_TENANT_ID,
      result.template_id,
    );
    expect(meta?.active_version).toBe(1);
  });

  it('rejects template without LETTER_BODY', async () => {
    const result = await processTemplateDocxUpload({
      tenantId: DEFAULT_TENANT_ID,
      fileName: 'template-invalid.docx',
      bytes: buildInvalidTemplateDocx(),
      name: 'IT invalid',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(422);
  });

  it('increments version on POST versions flow', async () => {
    const bytes = buildValidTemplateDocx();
    const first = await processTemplateDocxUpload({
      tenantId: DEFAULT_TENANT_ID,
      fileName: 'v.docx',
      bytes,
      name: `IT versioned ${Date.now()}`,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await processTemplateDocxUpload({
      tenantId: DEFAULT_TENANT_ID,
      templateId: first.template_id,
      fileName: 'v.docx',
      bytes,
      name: '',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.version).toBe(2);

    const meta = await getLetterTemplate(
      DEFAULT_TENANT_ID,
      first.template_id,
    );
    expect(meta?.active_version).toBe(2);
  });

  it('rejects file larger than 10MB', async () => {
    const huge = Buffer.alloc(11 * 1024 * 1024);
    const result = await processTemplateDocxUpload({
      tenantId: DEFAULT_TENANT_ID,
      fileName: 'huge.docx',
      bytes: huge,
      name: 'huge',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(422);
  });
});

afterAll(() => {});
