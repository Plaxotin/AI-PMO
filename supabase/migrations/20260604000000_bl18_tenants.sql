-- BL-18: tenants and membership (ADR-BL-18-01 A₀)

CREATE TYPE tenant_member_role AS ENUM ('tenant_admin', 'tenant_member');

CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  storage_used_bytes bigint NOT NULL DEFAULT 0 CHECK (storage_used_bytes >= 0),
  storage_quota_bytes bigint NOT NULL DEFAULT 1073741824 CHECK (storage_quota_bytes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_members (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role tenant_member_role NOT NULL DEFAULT 'tenant_member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX tenant_members_user_id_idx ON tenant_members (user_id);

CREATE TRIGGER tenants_set_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
