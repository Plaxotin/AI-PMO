# Документация AI PMO

Структура репозитория: **спеки** (требования) и **планы** (фазы, kickoff, верификация) — в отдельных каталогах.

## Спецификации (`docs/specs/`)

| Файл | Фича |
|------|------|
| [SPEC-BL-6-assignments-admin-v2.2.md](specs/SPEC-BL-6-assignments-admin-v2.2.md) | BL-6 v2.2 — one-screen direct-to-table (актуальная) |
| [SPEC-PLAN-AUDIT.md](specs/SPEC-PLAN-AUDIT.md) | Аудит проектного плана (Excel/CSV, CPM, LLM-отчёт) |
| [SPEC-BL-6-assignments-admin.md](specs/SPEC-BL-6-assignments-admin.md) | BL-6 v1.4 — legacy-спека (заменена v2.2) |
| [BL6_PRODUCT_DECISIONS.md](specs/BL6_PRODUCT_DECISIONS.md) | Зафиксированные продуктовые решения BL-6 |
| [SPEC-BL-18-official-letter-generator.md](specs/SPEC-BL-18-official-letter-generator.md) | BL-18 — Генератор официальных писем |
| [ADR-BL-18-01-tenant-model.md](specs/ADR-BL-18-01-tenant-model.md) | BL-18 — ADR: модель тенанта |
| [ADR-BL-18-02-production-decisions.md](specs/ADR-BL-18-02-production-decisions.md) | BL-18 — ADR: prod-решения |

## Планы реализации (`docs/plans/`)

| Файл | Фича |
|------|------|
| [ASSIGNMENTS_ADMIN_CURSOR_PLAN.md](plans/ASSIGNMENTS_ADMIN_CURSOR_PLAN.md) | BL-6 v2.2 — фазы BL2-0 … BL2-1, readiness и testing scenarios |
| [BL1-0_KICKOFF.md](plans/BL1-0_KICKOFF.md) | BL-6 — стартовые решения BL1-0 |
| [BL1-1_KICKOFF.md](plans/BL1-1_KICKOFF.md) | BL-6 — kickoff BL1-1 (MVP без auth) |
| [BL1-0_VERIFICATION.md](plans/BL1-0_VERIFICATION.md) | BL-6 — отчёт верификации BL1-0 |
| [BL1-0_ENV.md](plans/BL1-0_ENV.md) | BL-6 — переменные окружения приложения |
| [BL18_PLAN.md](plans/BL18_PLAN.md) | BL-18 — план реализации |
| [BL18-PROD-RUNBOOK.md](plans/BL18-PROD-RUNBOOK.md) | BL-18 — runbook |
| [BL1-0_BL18-ALIGNMENT.md](plans/BL1-0_BL18-ALIGNMENT.md) | BL-6 ↔ BL-18 выравнивание |

## Процесс разработки

- [SUBAGENTS_WORKFLOW.md](SUBAGENTS_WORKFLOW.md) — Planner / Implementer / Verifier
