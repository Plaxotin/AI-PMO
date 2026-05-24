-- BL1-0 seed: global project + sample assignments for local debugging.
-- DEFAULT_PROJECT_ID must match app/src/lib/config.ts

INSERT INTO projects (id, name)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'AI PMO — глобальный проект'
)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO assignments (
  id,
  project_id,
  title,
  description,
  status,
  due_at,
  owner_id,
  assignee_label,
  source
)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'Подготовить реестр поручений MVP',
    'Скелет API и миграция v1 по BL1-0',
    'open',
    now() + interval '7 days',
    NULL,
    '@pmo-lead',
    'manual'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'Согласовать политику auth для глобального проекта',
    NULL,
    'draft',
    NULL,
    NULL,
    'Иванов И.И.',
    'manual'
  )
ON CONFLICT (id) DO NOTHING;
