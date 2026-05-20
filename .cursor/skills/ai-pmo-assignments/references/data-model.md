# BL-1 — модель данных

Источник истины: `docs/BL1-0_KICKOFF.md`, `docs/MVP_SPEC_AND_PLAN.md` §11.

## `projects`

- `id` (uuid), `name`, `created_at`, `updated_at`
- BL1-0: одна seed-строка глобального проекта

## `assignments`

| Поле | Тип | Примечание |
|------|-----|------------|
| `id` | uuid | PK |
| `project_id` | uuid | FK → projects |
| `title` | text | обязательно для UI |
| `description` | text | nullable |
| `status` | enum | `draft`, `open`, `done`, `cancelled` |
| `due_at` | timestamptz | nullable |
| `owner_id` | uuid/text | Supabase Auth user |
| `assignee_label` | text | строковая метка; несколько — `;` до нормализации |
| `source` | enum | v1: только `manual`; зарезервировать `import`, `webhook` |
| `created_at`, `updated_at` | timestamptz | |

**Индексы:** `(project_id, status)`, `(project_id, due_at)`

## `assignment_status_events` (рекомендуется)

- `id`, `assignment_id`, `from_status`, `to_status`, `actor_id`, `created_at`

## Вне BL1-0 (не в миграции v1 без решения)

- `ClarificationSession`, сырой Telegram message, `ReminderLog`, `PublicationSnapshot` — см. `ASSIGNMENTS_ADMIN_CURSOR_PLAN.md`
