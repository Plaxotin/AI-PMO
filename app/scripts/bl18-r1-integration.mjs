#!/usr/bin/env node
/**
 * BL18-R1 manual/integration checks (testing_scenario from remediation plan).
 * Usage:
 *   cd app && BL18_ENABLED=true DATABASE_URL=... node scripts/bl18-r1-integration.mjs
 * Optional API:
 *   BASE_URL=http://localhost:3000 node scripts/bl18-r1-integration.mjs --api
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '..');
const repoRoot = join(appRoot, '..');

const TENANT_ID =
  process.env.DEFAULT_TENANT_ID ?? '00000000-0000-4000-8000-000000000002';
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const runApi = process.argv.includes('--api');

function step(id, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} [${id}] ${detail}`);
  return ok;
}

async function applyMigrations() {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  const m1 = join(repoRoot, 'supabase/migrations/20260604000000_bl18_tenants.sql');
  const m2 = join(repoRoot, 'supabase/migrations/20260604000001_bl18_letters.sql');
  const seed = join(repoRoot, 'supabase/seed_bl18.sql');
  const bl1 = join(repoRoot, 'supabase/migrations/20260524000000_bl1_v1.sql');
  for (const f of [bl1, m1, m2, seed]) {
    const r = spawnSync('psql', [url, '-f', f], { encoding: 'utf8' });
    if (r.status !== 0 && !/already exists/i.test(r.stderr || '')) {
      console.warn('psql', f, r.stderr?.slice(0, 200));
    }
  }
  return true;
}

async function main() {
  const results = [];
  process.env.BL18_ENABLED = 'true';
  process.env.LETTER_STORAGE_PATH = join(appRoot, '.data', 'letters-test');

  const { buildValidTemplateDocx, buildInvalidTemplateDocx } = await import(
    '../src/lib/letters/test-helpers/build-docx.ts'
  );
  const { extractPlaceholdersFromDocx } = await import(
    '../src/lib/letters/template-placeholders.ts'
  );
  const { validateTemplatePlaceholders } = await import(
    '../src/lib/letters/template-validation.ts'
  );
  const { processTemplateDocxUpload } = await import(
    '../src/lib/letters/process-template-upload.ts'
  );

  const valid = buildValidTemplateDocx();
  const invalid = buildInvalidTemplateDocx();
  const fixturesDir = join(repoRoot, 'fixtures', 'bl18');
  await mkdir(fixturesDir, { recursive: true });
  await writeFile(join(fixturesDir, 'template-valid.docx'), valid);
  await writeFile(join(fixturesDir, 'template-invalid.docx'), invalid);

  results.push(
    step(
      'T-unit-1',
      extractPlaceholdersFromDocx(valid).has('LETTER_BODY'),
      'extractPlaceholders finds LETTER_BODY in valid fixture',
    ),
  );

  const inv = validateTemplatePlaceholders(extractPlaceholdersFromDocx(invalid));
  results.push(
    step(
      'T-unit-2',
      !inv.ok && inv.missing?.includes('LETTER_BODY'),
      'invalid fixture missing LETTER_BODY in checklist',
    ),
  );

  if (process.env.DATABASE_URL) {
    await applyMigrations();
    const ok = await processTemplateDocxUpload({
      tenantId: TENANT_ID,
      fileName: 'template-valid.docx',
      bytes: valid,
      name: 'R1 test template',
    });
    results.push(
      step(
        'T-db-1',
        ok.ok && ok.version === 1 && Boolean(ok.storage_key),
        ok.ok
          ? `DB upload version=${ok.version} key=${ok.storage_key}`
          : `DB upload failed: ${ok.response?.status}`,
      ),
    );

    if (ok.ok) {
      const v2 = await processTemplateDocxUpload({
        tenantId: TENANT_ID,
        templateId: ok.template_id,
        fileName: 'template-valid.docx',
        bytes: valid,
        name: '',
      });
      results.push(
        step(
          'T-db-2',
          v2.ok && v2.version === 2,
          v2.ok ? `version bump to ${v2.version}` : 'version POST failed',
        ),
      );
    }

    const bad = await processTemplateDocxUpload({
      tenantId: TENANT_ID,
      fileName: 'template-invalid.docx',
      bytes: invalid,
      name: 'bad',
    });
    results.push(
      step(
        'T-db-3',
        !bad.ok,
        !bad.ok ? 'invalid template rejected' : 'expected validation failure',
      ),
    );
  } else {
    console.log('SKIP [T-db-*] DATABASE_URL not set');
  }

  const huge = Buffer.alloc(11 * 1024 * 1024);
  const big = await processTemplateDocxUpload({
    tenantId: TENANT_ID,
    fileName: 'big.docx',
    bytes: huge,
    name: 'big',
  });
  results.push(
    step(
      'T-size',
      !big.ok,
      !big.ok ? 'file >10MB rejected' : 'expected FILE_TOO_LARGE',
    ),
  );

  if (runApi) {
    const form = new FormData();
    form.append('file', new Blob([valid]), 'template-valid.docx');
    form.append('name', 'API test');
    const res = await fetch(
      `${BASE_URL}/api/tenants/${TENANT_ID}/letter-templates`,
      { method: 'POST', body: form },
    );
    const body = await res.json();
    results.push(
      step(
        'T-api-1',
        res.status === 201 && body.template_id,
        `POST letter-templates → ${res.status}`,
      ),
    );
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\nSummary: ${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
