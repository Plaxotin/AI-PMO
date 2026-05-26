import postgres from 'postgres';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured } from '@/lib/config';

let sql: ReturnType<typeof postgres> | null = null;

export function getSql() {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  if (!sql) {
    sql = postgres(process.env.DATABASE_URL, {
      max: 5,
      prepare: false,
    });
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
  version: number;
  media_ingest_job_id?: string | null;
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
    version: row.version,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

export type DbAssignmentEventRow = {
  id: string;
  assignment_id: string;
  event_type: 'created' | 'status_change' | 'field_change' | 'cancelled';
  field_name: string | null;
  from_status: string | null;
  to_status: string | null;
  old_value: unknown;
  new_value: unknown;
  actor_id: string | null;
  created_at: Date | string;
};

export function rowToAssignmentEvent(row: DbAssignmentEventRow) {
  return {
    id: row.id,
    assignment_id: row.assignment_id,
    event_type: row.event_type,
    field_name: row.field_name,
    from_status: row.from_status,
    to_status: row.to_status,
    old_value: row.old_value ?? null,
    new_value: row.new_value ?? null,
    actor_id: row.actor_id,
    created_at: new Date(row.created_at).toISOString(),
  };
}
