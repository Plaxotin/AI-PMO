/** Global single-project id until multi-tenant (BL1-0 kickoff). */
export const DEFAULT_PROJECT_ID =
  '00000000-0000-4000-8000-000000000001';

/** Default tenant for BL-18 (ADR A₀, seed in supabase/seed_bl18.sql). */
export const DEFAULT_TENANT_ID =
  process.env.DEFAULT_TENANT_ID ??
  '00000000-0000-4000-8000-000000000002';

const DEFAULT_QUOTA = 1073741824;

export function getTenantStorageQuotaBytes(): number {
  const raw = process.env.TENANT_STORAGE_QUOTA_BYTES;
  if (!raw) return DEFAULT_QUOTA;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_QUOTA;
}

export function isBl18Enabled(): boolean {
  return process.env.BL18_ENABLED === 'true';
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL) || isSupabaseConfigured();
}
