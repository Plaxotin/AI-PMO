import postgres from 'postgres';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured } from '@/lib/config';

let sql: ReturnType<typeof postgres> | null = null;

function postgresOptions(connectionString: string) {
  const needsSsl =
    connectionString.includes('supabase.co') ||
    /sslmode=require/i.test(connectionString);

  return {
    /** Serverless-friendly pool (Vercel). */
    max: 1,
    prepare: false,
    connect_timeout: 15,
    idle_timeout: 20,
    ...(needsSsl ? { ssl: 'require' as const } : {}),
  };
}

export function getSql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }
  if (!sql) {
    sql = postgres(connectionString, postgresOptions(connectionString));
  }
  return sql;
}

let supabaseAdmin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseAdmin;
}

export type DbAssignmentRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  due_at: Date | string | null;
  owner_id: string | null;
  assignee_label: string | null;
  source: string;
  created_at: Date | string;
  updated_at: Date | string;
};

export function rowToAssignment(row: DbAssignmentRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    due_at: row.due_at ? new Date(row.due_at).toISOString() : null,
    owner_id: row.owner_id,
    assignee_label: row.assignee_label,
    source: row.source,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}
