/** Global single-project id until multi-tenant (BL1-0 kickoff). */
export const DEFAULT_PROJECT_ID =
  '00000000-0000-4000-8000-000000000001';

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
