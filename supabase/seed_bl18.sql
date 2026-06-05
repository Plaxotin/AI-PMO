-- BL-18 seed: default tenant (DEFAULT_TENANT_ID in app/.env.example)
INSERT INTO tenants (id, name, storage_quota_bytes)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  'Default Organization',
  1073741824
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name;
