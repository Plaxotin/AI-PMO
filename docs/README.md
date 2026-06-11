# Документация AI PMO

## Где что лежит

| Тип | Где |
|-----|-----|
| Продукт, видение, бэклог, описания фич | **Notion** — [хаб AI PMO](https://app.notion.com/p/33a2fbb64c0e80baa2e4f8cac9adb618), [продуктовая документация](https://app.notion.com/p/3632fbb64c0e81ca919ec74125a20a00) |
| Спеки реализации и планы фаз (этот репозиторий) | `docs/specs/`, `docs/plans/` |

В репозитории хранятся только **спеки реализации** (контракты для кода) и **планы фаз** (kickoff, верификация, runbook). Продуктовые материалы — в Notion.

## Спецификации (`docs/specs/`)

| Файл | Фича |
|------|------|
| [SPEC-PLAN-AUDIT.md](specs/SPEC-PLAN-AUDIT.md) | Аудит проектного плана (Excel/CSV, CPM, LLM-отчёт) |
| [SPEC-BL-6-assignments-admin-v2.2.md](specs/SPEC-BL-6-assignments-admin-v2.2.md) | BL-6 — Администратор поручений (v2.2: один экран, Google Sheets, direct-to-table) |
| [BL6_PRODUCT_DECISIONS.md](specs/BL6_PRODUCT_DECISIONS.md) | Зафиксированные продуктовые решения BL-6 |
| [SPEC-BL-18-official-letter-generator.md](specs/SPEC-BL-18-official-letter-generator.md) | BL-18 — Генератор официальных писем |
| [ADR-BL-18-01-tenant-model.md](specs/ADR-BL-18-01-tenant-model.md) | BL-18 — ADR: модель тенанта |
| [ADR-BL-18-02-production-decisions.md](specs/ADR-BL-18-02-production-decisions.md) | BL-18 — ADR: prod-решения |

## Планы реализации (`docs/plans/`)

| Файл | Фича |
|------|------|
| [ASSIGNMENTS_ADMIN_CURSOR_PLAN.md](plans/ASSIGNMENTS_ADMIN_CURSOR_PLAN.md) | BL-6 — фазы BL1-0 … BL1-5 (v1.3, отменены BL1-1+); v2.0 фазы BL2-* — в спеке |
| [BL1-0_KICKOFF.md](plans/BL1-0_KICKOFF.md) | BL-6 — стартовые решения BL1-0 |
| [BL1-0_VERIFICATION.md](plans/BL1-0_VERIFICATION.md) | BL-6 — отчёт верификации BL1-0 |
| [BL1-0_ENV.md](plans/BL1-0_ENV.md) | BL-6 — переменные окружения приложения |
| [BL18_PLAN.md](plans/BL18_PLAN.md) | BL-18 — план реализации |
| [BL18-PROD-RUNBOOK.md](plans/BL18-PROD-RUNBOOK.md) | BL-18 — runbook |
| [BL1-0_BL18-ALIGNMENT.md](plans/BL1-0_BL18-ALIGNMENT.md) | BL-6 ↔ BL-18 выравнивание |

## Инфраструктура репозитория

| Путь | Назначение |
|------|------------|
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | Деплой, структура каталогов, модули BL-6 / BL-18 |
| [`../supabase/`](../supabase/) | SQL-миграции и seed (BL1, BL-18) |
| [`../fixtures/bl18/`](../fixtures/bl18/) | DOCX-фикстуры для приёмки и тестов BL-18 |

## Процесс разработки

- [SUBAGENTS_WORKFLOW.md](SUBAGENTS_WORKFLOW.md) — Planner / Implementer / Verifier
- [CONTRIBUTING.md](../CONTRIBUTING.md) — быстрый старт для разработчиков
