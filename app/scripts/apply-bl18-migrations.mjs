#!/usr/bin/env node
/**
 * Apply BL-18 R1 migrations to Postgres (same DB as Vercel DATABASE_URL).
 *
 * Usage (from app/):
 *   DATABASE_URL='postgresql://...' node scripts/apply-bl18-migrations.mjs
 *
 * Or combined SQL only: supabase/apply_bl18_r1_combined.sql in Supabase SQL Editor.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required (same value as in Vercel → Environment Variables).');
  process.exit(1);
}

const combinedPath = join(repoRoot, 'supabase', 'apply_bl18_r1_combined.sql');
const sqlText = await readFile(combinedPath, 'utf8');

const sql = postgres(url, { max: 1, ssl: url.includes('supabase.co') ? 'require' : undefined });

try {
  await sql.unsafe(sqlText);
  const rows = await sql`
    SELECT id, name FROM tenants
    WHERE id = '00000000-0000-4000-8000-000000000002'
  `;
  console.log('OK: migrations applied.');
  console.log('Tenant:', rows[0] ?? 'MISSING — check seed');
  process.exit(rows[0] ? 0 : 1);
} catch (e) {
  console.error('Migration failed:', e.message);
  process.exit(1);
} finally {
  await sql.end();
}
