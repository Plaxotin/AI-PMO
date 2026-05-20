---
name: ai-pmo-assignments
description: "Use for AI PMO BL-1 «Администратор поручений»: domain rules for assignments registry, API contracts, Zod/Postgres model, BL1-0 scope, Telegram ingest (later), reminders, public registry RU hosting. Pair with agents-best-practices for harness/tools/permissions. Do not use for plan audit CPM or Excel parsing."
metadata:
  version: "1.0.0"
  scope: "ai-pmo-bl1-domain"
  file_policy: "markdown-only"
---

# AI PMO — Администратор поручений (BL-1)

Доменный skill для модуля **BL-1**. Архитектуру agent harness (цикл, approvals, MCP policy) — в `@agents-best-practices`; здесь — **продуктовые инварианты и контракты PMO**.

## Когда активировать

- реестр поручений, CRUD, статусы, дедлайны, исполнители;
- BL1-0 / BL1-1, миграции Supabase, `/api/projects/:projectId/assignments`;
- Telegram ingest, STT, slot-filling, напоминания, публичный реестр (этапы после BL1-0);
- параллельные Cloud Agents по `docs/ASSIGNMENTS_ADMIN_CURSOR_PLAN.md`.

Не активировать для: аудита плана (CPM, Excel), лендинга, Stripe/Pro.

## Обязательные артефакты в репозитории

| Документ | Назначение |
|----------|------------|
| `docs/BL1-0_KICKOFF.md` | Скоуп BL1-0, auth, API prefix, **без US-7** в v1 |
| `docs/ASSIGNMENTS_ADMIN_CURSOR_PLAN.md` | Telegram, треки агентов A–G |
| `docs/MVP_SPEC_AND_PLAN.md` | §11 BL-1 в общем MVP |

Перед кодом: сверить решения с **BL1-0**; не тянуть сущности Telegram в миграцию v1 без явного решения команды.

## Инварианты BL-1

1. **Минимальные поля поручения:** описание (или title+description), срок (`due_at`), ответственный (`assignee_label` — строка, не обязателен `user_id` в BL1-0).
2. **Статусы MVP:** `draft` | `open` | `done` | `cancelled`; смена статуса — с записью в `assignment_status_events` (рекомендуется).
3. **API prefix:** `/api/projects/:projectId/assignments` и `…/assignments/:assignmentId`.
4. **Один глобальный проект** в BL1-0: `DEFAULT_PROJECT_ID` / одна строка в `projects`; без мультитенанта.
5. **Черновик ≠ публикация:** внешние действия (сообщение в Telegram, публичный реестр) — только после human confirm / approval record (см. `agents-best-practices`).
6. **Идемпотентность ingest (когда появится):** `external_id` = `chat_id` + `message_id`; повтор webhook не дублирует поручение.
7. **US-7 (авто-извлечение из канала)** — **вне** BL1-0 по `BL1-0_KICKOFF.md`.

## Модель данных (кратко)

См. `references/data-model.md`. Поля `assignments`: `title`, `description`, `status`, `due_at`, `owner_id`, `assignee_label`, `source` (`manual` | `import` | `webhook` — в v1 по умолчанию `manual`).

## Работа агентов в Cursor

- Контракты (Zod, OpenAPI-черновик) — **до** параллельных треков B/C/D.
- В `AGENTS.md` и Rules: не смешивать домен BL-1 с CPM/аудитом.
- На **kickoff BL-1** (после BL1-0): сессия **MVP Builder Mode** — `@agents-best-practices` + этот skill → blueprint инструментов и launch gate (шаг 3 практичного минимума).

## Ссылки на harness

При проектировании tools: `create_assignment_draft`, `confirm_assignment`, `schedule_reminder` — узкие typed tools; не `send_message` / `update_database` без обёртки.

## Reference map

- [data-model.md](references/data-model.md) — таблицы, enum, индексы
- [api-contract.md](references/api-contract.md) — REST, ошибки, query filters
- [phases.md](references/phases.md) — BL1-0 vs Telegram vs public registry
