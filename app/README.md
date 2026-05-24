# AI PMO — приложение (Next.js)

Реестр поручений (BL-1). Фаза **BL1-0**: контракты Zod, миграция v1, скелет REST API.

## BL1-0 scope

- `GET/POST` `/api/projects/:projectId/assignments`
- `GET/PATCH` `/api/projects/:projectId/assignments/:assignmentId`
- Таблицы: `projects`, `assignments`, `assignment_status_events`
- Без Telegram, инжеста, STT (см. `docs/ASSIGNMENTS_ADMIN_CURSOR_PLAN.md` — этапы после реестра)

## Команды

```bash
npm install
npm run dev          # http://localhost:3000
npm run build
npm test             # Vitest — Zod-контракты
```

Переменные окружения: **`docs/BL1-0_ENV.md`**.

## Структура

- `src/lib/assignments/` — Zod-схемы и коды ошибок API
- `src/lib/db/` — доступ к Postgres (`DATABASE_URL`)
- `src/lib/auth/` — скелет Supabase session
- `src/app/api/projects/[projectId]/assignments/` — route handlers

Миграции SQL: `../supabase/migrations/`.
