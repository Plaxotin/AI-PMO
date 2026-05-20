# BL-1 — API contract (MVP / BL1-0)

**Prefix:** `/api/projects/:projectId/assignments`

## Коллекция

- `GET` — список; query: `status`, `due_from`, `due_to`, поиск по `assignee_label` / тексту (по согласованию)
- `POST` — создание; body по Zod `AssignmentCreate`; `owner_id` = текущий пользователь

## Элемент

- `GET /api/projects/:projectId/assignments/:assignmentId`
- `PATCH` — частичное обновление (status, due_at, assignee_label, title, description)

## Ошибки

Единый JSON: `{ code, message, details? }`. Коды: `VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`.

## Auth (BL1-0)

Supabase Auth: magic link / OAuth. MVP: любой залогиненный пользователь видит и правит поручения глобального проекта (ACL позже).

## Env (черновик)

`DATABASE_URL` или `NEXT_PUBLIC_SUPABASE_URL` + ключи Supabase; секреты не в git.
