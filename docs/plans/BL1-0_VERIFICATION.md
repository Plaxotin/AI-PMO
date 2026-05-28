# BL1-0 — отчёт верификации

**phase_id:** BL1-0  
**branch:** `cursor/bl1-0-kickoff-35d7`  
**final_status:** `verified` (статическая проверка + runtime smoke без подключённой БД)

## Проверки

| Шаг | Результат |
|-----|-----------|
| `npm test` (Vitest, Zod) | passed (5/5) |
| `npm run build` | passed |
| GET assignments (no DATABASE_URL) | 200, `data: []`, `X-Auth-Status: todo-supabase-not-configured` |
| POST `{}` | 400 `VALIDATION_ERROR` |
| POST `{ "title": "Тест" }` | 501 `NOT_IMPLEMENTED` |
| projectId `not-a-uuid` | 400 |
| projectId другой UUID | 404 `PROJECT_MISMATCH` |
| Миграция без Telegram-сущностей | passed (code review) |

## Не выполнялось в CI

- `psql` apply migration + seed на живом Postgres (требует `DATABASE_URL` оператора).

## Следующая фаза

BL1-1 — CRUD и авторизация (см. `docs/specs/SPEC-BL-6-assignments-admin-v2.2.md`, `docs/plans/ASSIGNMENTS_ADMIN_CURSOR_PLAN.md`).
