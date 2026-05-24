-- BL1-0: assignments registry v1 (AI PMO)
-- Aligns with docs/BL1-0_KICKOFF.md — no ingest / Telegram tables in v1.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE assignment_status AS ENUM (
  'draft',
  'open',
  'done',
  'cancelled'
);

CREATE TYPE assignment_source AS ENUM (
  'manual',
  'import',
  'webhook'
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status assignment_status NOT NULL DEFAULT 'draft',
  due_at timestamptz,
  owner_id uuid,
  assignee_label text,
  source assignment_source NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assignments_project_id_status_idx ON assignments (project_id, status);
CREATE INDEX assignments_project_id_due_at_idx ON assignments (project_id, due_at);

CREATE TABLE assignment_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments (id) ON DELETE CASCADE,
  from_status assignment_status,
  to_status assignment_status NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assignment_status_events_assignment_id_idx
  ON assignment_status_events (assignment_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER assignments_set_updated_at
  BEFORE UPDATE ON assignments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
