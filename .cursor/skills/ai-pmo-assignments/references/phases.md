# BL-1 — фазы

## BL1-0 (текущий старт)

- Zod + TypeScript types
- Миграция v1: `projects`, `assignments`, опционально `assignment_status_events`
- Скелет Next.js route handlers (заглушки + валидация)
- Seed глобального проекта
- **Нет:** US-7, Telegram webhook, STT, публичный CDN

Критерии готовности: `docs/BL1-0_KICKOFF.md` §6.

## BL1-1+

- UI реестра, фильтры US-5/US-6
- Auth в production paths

## После реестра (план Telegram)

Треки A–G в `docs/ASSIGNMENTS_ADMIN_CURSOR_PLAN.md`:

- A — контракты и данные
- B — Telegram текст/голос
- C — LLM slot-filling + уточнения
- D — scheduler напоминаний
- E — публичный JSON/HTML + РФ CDN
- F — admin import/export
- G — observability

## Kickoff BL-1 — шаг 3 (Cursor)

Один сеанс с `@agents-best-practices` в режиме **MVP Builder Mode**: blueprint harness (tools, permissions, budgets, evals, launch gate) для полного BL-1, с учётом домена из `@ai-pmo-assignments`.
