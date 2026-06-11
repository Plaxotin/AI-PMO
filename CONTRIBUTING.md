# Contributing to AI PMO

Репозиторий: **`Plaxotin/AI-PMO`**. Краткий старт; детали архитектуры — [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Prerequisites

- Node.js 20+ (для `app/`)
- Доступ к Supabase / Postgres (для полного API)
- Аккаунты Google Cloud и SaluteSpeech — по мере работы с BL-6 ([`docs/plans/BL2-0_SECRETS_SETUP.md`](docs/plans/BL2-0_SECRETS_SETUP.md))

## Setup

```bash
# Лендинг — только статика, без npm
python3 -m http.server 8080

# Приложение Next.js
cd app
cp .env.example .env.local   # заполнить по BL1-0_ENV
npm install
npm run dev
```

Проверка сборки и тестов:

```bash
cd app
npm run build
npm test
npm run verify:bl2-secrets   # после настройки секретов BL-6
```

## What to edit where

| Задача | Где |
|--------|-----|
| Лендинг | `index.html` (корень) |
| UI / API приложения | `app/src/` |
| Схема БД | `supabase/migrations/`, seed в `supabase/` |
| Спеки и критерии приёмки | `docs/specs/` |
| Планы фаз, env, runbook | `docs/plans/` |
| BL-18 test DOCX | `fixtures/bl18/` |

## Branching and process

1. Ветка от `main` (для агентов Cursor: `cursor/<описание>-0047`).
2. Одна активная фаза — см. [`docs/SUBAGENTS_WORKFLOW.md`](docs/SUBAGENTS_WORKFLOW.md).
3. Перед merge: верификация по плану фазы (`docs/plans/*_VERIFICATION.md` или сценарий Planner).

## Documentation

- Архитектура и структура репо → [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Индекс спек и планов → [`docs/README.md`](docs/README.md)
- Продукт и бэклог → [Notion](https://app.notion.com/p/33a2fbb64c0e80baa2e4f8cac9adb618)
- Cursor-агенты → [`AGENTS.md`](AGENTS.md)

## Deploy

Push в `main` → Vercel (проект **ai-pmo**). Production: **https://ai-pmo-tawny.vercel.app/**. Маршрутизация — корневой [`vercel.json`](vercel.json).
