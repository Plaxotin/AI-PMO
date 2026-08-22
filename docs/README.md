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
| [SPEC-PLAN-AUDIT.md](specs/SPEC-PLAN-AUDIT.md) | Аудит проектного плана **v0.2.2** (Excel/CSV/MPP/XML, CPM, движок Инструкции R-01…R-12, диаграммы D-01…D-04, LLM-отчёт) |
| [DEMO_ENTITIES.md](specs/DEMO_ENTITIES.md) | Сущности demo «Аудит проекта» (D1–D6, маппинг на бэклог, ER-диаграмма) |
| [SPEC-BL-6-assignments-admin-v2.2.md](specs/SPEC-BL-6-assignments-admin-v2.2.md) | BL-6 — Администратор поручений (v2.2: один экран, Google Sheets, direct-to-table) |
| [BL6_PRODUCT_DECISIONS.md](specs/BL6_PRODUCT_DECISIONS.md) | Зафиксированные продуктовые решения BL-6 |
| [SPEC-BL-18-official-letter-generator.md](specs/SPEC-BL-18-official-letter-generator.md) | BL-18 — Генератор официальных писем |
| [ADR-BL-18-01-tenant-model.md](specs/ADR-BL-18-01-tenant-model.md) | BL-18 — ADR: модель тенанта |
| [ADR-BL-18-02-production-decisions.md](specs/ADR-BL-18-02-production-decisions.md) | BL-18 — ADR: prod-решения |

## Планы реализации (`docs/plans/`)

| Файл | Фича |
|------|------|
| [PLAN-PROJECT-AUDIT.md](plans/PLAN-PROJECT-AUDIT.md) | BL-1 — план реализации v0.2.2 (4 недели, 16–24 ч/д, M1…M4) |
| [BL1-0_KICKOFF.md](plans/BL1-0_KICKOFF.md) | BL-6 — стартовые решения BL1-0 |
| [BL1-0_VERIFICATION.md](plans/BL1-0_VERIFICATION.md) | BL-6 — отчёт верификации BL1-0 |
| [BL1-0_ENV.md](plans/BL1-0_ENV.md) | BL-6 — переменные окружения приложения |
| [BL18_PLAN.md](plans/BL18_PLAN.md) | BL-18 — план реализации |
| [BL18-PROD-RUNBOOK.md](plans/BL18-PROD-RUNBOOK.md) | BL-18 — runbook |
| [BL1-0_BL18-ALIGNMENT.md](plans/BL1-0_BL18-ALIGNMENT.md) | BL-6 ↔ BL-18 выравнивание |

## Процесс разработки

- [SUBAGENTS_WORKFLOW.md](SUBAGENTS_WORKFLOW.md) — Planner / Implementer / Verifier
