-- BL-18: letter templates, storage metadata, audit (ADR-BL-18-02)

CREATE TABLE letter_storage_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  content_type text NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX letter_storage_objects_tenant_id_idx ON letter_storage_objects (tenant_id);

CREATE TABLE letter_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  organization text,
  style_passport text,
  active_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX letter_templates_tenant_id_idx ON letter_templates (tenant_id);

CREATE TABLE letter_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES letter_templates (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  storage_object_id uuid NOT NULL REFERENCES letter_storage_objects (id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);

CREATE INDEX letter_template_versions_template_id_idx
  ON letter_template_versions (template_id);

ALTER TABLE letter_templates
  ADD CONSTRAINT letter_templates_active_version_fk
  FOREIGN KEY (active_version_id) REFERENCES letter_template_versions (id);

CREATE TRIGGER letter_templates_set_updated_at
  BEFORE UPDATE ON letter_templates
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TABLE letter_audit_events (
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

CREATE INDEX letter_audit_events_tenant_id_created_at_idx
  ON letter_audit_events (tenant_id, created_at DESC);
