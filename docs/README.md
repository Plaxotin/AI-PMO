# Документация AI PMO

Структура репозитория: **спеки** (требования) и **планы** (фазы, kickoff, верификация) — в отдельных каталогах.

## Спецификации (`docs/specs/`)

| Файл | Фича |
|------|------|
| [SPEC-PLAN-AUDIT.md](specs/SPEC-PLAN-AUDIT.md) | Аудит проектного плана (Excel/CSV, CPM, LLM-отчёт) |
| [SPEC-BL-6-assignments-admin.md](specs/SPEC-BL-6-assignments-admin.md) | BL-6 — Администратор поручений |
| [BL6_PRODUCT_DECISIONS.md](specs/BL6_PRODUCT_DECISIONS.md) | Зафиксированные продуктовые решения BL-6 |
| [SPEC-BL-18-official-letter-generator.md](specs/SPEC-BL-18-official-letter-generator.md) | BL-18 — Генератор официальных писем |

## Планы реализации (`docs/plans/`)

| Файл | Фича |
|------|------|
| [ASSIGNMENTS_ADMIN_CURSOR_PLAN.md](plans/ASSIGNMENTS_ADMIN_CURSOR_PLAN.md) | BL-6 — фазы BL1-0 … BL1-5, testing scenarios |
| [BL1-0_KICKOFF.md](plans/BL1-0_KICKOFF.md) | BL-6 — стартовые решения BL1-0 |
| [BL1-0_VERIFICATION.md](plans/BL1-0_VERIFICATION.md) | BL-6 — отчёт верификации BL1-0 |
| [BL1-0_ENV.md](plans/BL1-0_ENV.md) | BL-6 — переменные окружения приложения |

## Процесс разработки

- [SUBAGENTS_WORKFLOW.md](SUBAGENTS_WORKFLOW.md) — Planner / Implementer / Verifier
