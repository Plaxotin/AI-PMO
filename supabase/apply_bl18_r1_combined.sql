-- BL-18 R1: combined apply for Supabase SQL Editor (idempotent where possible)
-- Run once in: Dashboard → SQL → New query → Run
-- Project host example: db.dthmusuxsmollsudnaxg.supabase.co

-- ========== BL1-0 base (skip sections if already applied) ==========
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE assignment_status AS ENUM ('draft', 'open', 'done', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE assignment_source AS ENUM ('manual', 'import', 'webhook');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assignments (
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

CREATE INDEX IF NOT EXISTS assignments_project_id_status_idx
  ON assignments (project_id, status);
CREATE INDEX IF NOT EXISTS assignments_project_id_due_at_idx
  ON assignments (project_id, due_at);

CREATE TABLE IF NOT EXISTS assignment_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments (id) ON DELETE CASCADE,
  from_status assignment_status,
  to_status assignment_status NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assignment_status_events_assignment_id_idx
  ON assignment_status_events (assignment_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS projects_set_updated_at ON projects;
CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS assignments_set_updated_at ON assignments;
CREATE TRIGGER assignments_set_updated_at
  BEFORE UPDATE ON assignments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ========== BL-18 tenants ==========
DO $$ BEGIN
  CREATE TYPE tenant_member_role AS ENUM ('tenant_admin', 'tenant_member');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  storage_used_bytes bigint NOT NULL DEFAULT 0 CHECK (storage_used_bytes >= 0),
  storage_quota_bytes bigint NOT NULL DEFAULT 1073741824 CHECK (storage_quota_bytes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_members (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role tenant_member_role NOT NULL DEFAULT 'tenant_member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS tenant_members_user_id_idx ON tenant_members (user_id);

DROP TRIGGER IF EXISTS tenants_set_updated_at ON tenants;
CREATE TRIGGER tenants_set_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ========== BL-18 letters ==========
CREATE TABLE IF NOT EXISTS letter_storage_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  content_type text NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS letter_storage_objects_tenant_id_idx
  ON letter_storage_objects (tenant_id);

CREATE TABLE IF NOT EXISTS letter_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  organization text,
  style_passport text,
  active_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS letter_templates_tenant_id_idx ON letter_templates (tenant_id);

CREATE TABLE IF NOT EXISTS letter_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES letter_templates (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  storage_object_id uuid NOT NULL REFERENCES letter_storage_objects (id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);

CREATE INDEX IF NOT EXISTS letter_template_versions_template_id_idx
  ON letter_template_versions (template_id);

DO $$ BEGIN
  ALTER TABLE letter_templates
    ADD CONSTRAINT letter_templates_active_version_fk
    FOREIGN KEY (active_version_id) REFERENCES letter_template_versions (id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DROP TRIGGER IF EXISTS letter_templates_set_updated_at ON letter_templates;
CREATE TRIGGER letter_templates_set_updated_at
  BEFORE UPDATE ON letter_templates
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS letter_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  user_id uuid,
  project_id uuid,
  template_id uuid,
  template_version integer,
  request_id uuid,
  model_id text,
  provider text,
  attachment_count integer,
  attachment_names jsonb,
  zip_issued boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS letter_audit_events_tenant_id_created_at_idx
  ON letter_audit_events (tenant_id, created_at DESC);

-- ========== Seed default tenant ==========
INSERT INTO tenants (id, name, storage_quota_bytes)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  'Default Organization',
  1073741824
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name;

-- Verify (optional result set)
SELECT id, name, storage_quota_bytes FROM tenants
WHERE id = '00000000-0000-4000-8000-000000000002';
