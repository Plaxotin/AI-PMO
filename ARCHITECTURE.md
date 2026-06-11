# AI PMO — Architecture Overview

Обзор структуры репозитория **`Plaxotin/AI-PMO`**: как устроен деплой, каталоги и модули. Контракты реализации — в `docs/specs/`; планы фаз — в `docs/plans/` (индекс: [`docs/README.md`](docs/README.md)). Продуктовые решения — в [Notion](https://app.notion.com/p/33a2fbb64c0e80baa2e4f8cac9adb618).

## Deployment model: static landing + Next.js

Один Vercel-проект, один домен (**https://ai-pmo-tawny.vercel.app/**). Корневой [`vercel.json`](vercel.json) маршрутизирует трафик:

| Путь | Слой | Как деплоится |
|------|------|----------------|
| `/` | Статический лендинг | `index.html` → `@vercel/static` (без сборки) |
| `/assignments`, `/dashboard`, `/_next/*` | Next.js UI | `app/` → `@vercel/next` |
| `/api/*` | Next.js API routes | те же serverless functions |

Корневой [`package.json`](package.json) запускает сборку только приложения: `npm run build` → `app/`. Лендинг отдаётся как есть.

Дополнительные лимиты для тяжёлых API — в [`app/vercel.json`](app/vercel.json) (например, `maxDuration: 300` для ingest).

## Directory map

```
.
├── index.html              # Статический лендинг (inline CSS/JS, без build)
├── package.json            # Оркестратор сборки Vercel (build → app/)
├── vercel.json             # Маршрутизация static + Next.js
├── AGENTS.md               # Правила для Cursor-агентов
├── ARCHITECTURE.md         # Этот файл
├── CONTRIBUTING.md         # Быстрый старт для разработчиков
├── README.md               # Точка входа в репозиторий
│
├── app/                    # Next.js 15 приложение
│   ├── package.json
│   ├── vercel.json         # Function limits (ingest и др.)
│   ├── src/
│   │   ├── app/            # App Router: страницы и API
│   │   ├── components/
│   │   ├── lib/            # Auth, DB, Google, letters, ingest, LLM
│   │   └── types/
│   └── scripts/            # Миграции, verify-bl2-secrets, BL-18 integration
│
├── docs/
│   ├── README.md           # Индекс спек и планов
│   ├── specs/              # Контракты: что строить
│   ├── plans/              # Фазы: как строить, env, verification, runbook
│   └── SUBAGENTS_WORKFLOW.md
│
├── supabase/               # SQL-миграции и seed (source of truth для схемы БД)
│   ├── migrations/
│   ├── seed.sql            # BL-6 / BL1
│   ├── seed_bl18.sql       # BL-18 tenant seed
│   └── apply_bl18_r1_combined.sql
│
├── fixtures/               # Тестовые артефакты (не prod-данные)
│   └── bl18/               # DOCX-шаблоны для приёмки и интеграционных тестов
│
└── .cursor/
    ├── agents/             # planner, implementer, verifier
    └── rules/              # documentation-sources.mdc
```

## Tech stack

| Слой | Технологии | Зачем |
|------|------------|-------|
| Landing | HTML, CSS, JS (inline) | Нулевая сборка, CDN-кэш, SEO |
| App UI | React 19, Next.js 15, Tailwind 4 | SSR, App Router, единый репо с API |
| App API | Next.js Route Handlers, TypeScript | Serverless, типобезопасность |
| БД | PostgreSQL (Supabase) | Поручения, тенанты, letter templates |
| Auth | Supabase Auth + Google OAuth | Сессии; Google Sheets scope для BL-6 |
| Внешние API | Google Sheets, LLM, SaluteSpeech | BL-6 smart-input и ingest |

## Feature modules

### BL-6 — Assignments Admin (v2.2)

- **Спека:** [`docs/specs/SPEC-BL-6-assignments-admin-v2.2.md`](docs/specs/SPEC-BL-6-assignments-admin-v2.2.md)
- **UI:** `/assignments`
- **API:** `/api/projects/[projectId]/assignments/*`, `/api/projects/[projectId]/sheets/*`, `/api/projects/[projectId]/ingest/*`
- **Auth:** `/api/auth/google`, `/api/auth/google/callback`
- **Миграции:** `supabase/migrations/20260524000000_bl1_v1.sql`, `supabase/seed.sql`

### BL-18 — Official Letter Generator

- **Спека:** [`docs/specs/SPEC-BL-18-official-letter-generator.md`](docs/specs/SPEC-BL-18-official-letter-generator.md)
- **ADR:** [`docs/specs/ADR-BL-18-01-tenant-model.md`](docs/specs/ADR-BL-18-01-tenant-model.md), [`ADR-BL-18-02-production-decisions.md`](docs/specs/ADR-BL-18-02-production-decisions.md)
- **UI:** `/dashboard`
- **API:** `/api/tenants/[tenantId]/letter-templates/*`
- **Миграции:** `supabase/migrations/20260604000000_bl18_tenants.sql`, `20260604000001_bl18_letters.sql`, `supabase/seed_bl18.sql`
- **Fixtures:** `fixtures/bl18/template-valid.docx`, `template-invalid.docx` — ручная приёмка ([`docs/plans/BL18_R1_BLOCKERS_RESOLUTION_PLAN.md`](docs/plans/BL18_R1_BLOCKERS_RESOLUTION_PLAN.md)) и тесты

## Database workflow

Миграции применяются вручную или скриптами из `app/scripts/`:

```bash
# Пример (см. docs/plans/BL1-0_ENV.md)
psql "$DATABASE_URL" -f supabase/migrations/20260524000000_bl1_v1.sql
psql "$DATABASE_URL" -f supabase/seed.sql
```

Альтернатива для BL-18 R1: `supabase/apply_bl18_r1_combined.sql` в Supabase SQL Editor или `node app/scripts/apply-bl18-migrations.mjs`.

Без настроенного Supabase API отвечает с заголовком `X-Auth-Status: todo-supabase-not-configured` — только для local dev ([`docs/plans/BL1-0_BL18-ALIGNMENT.md`](docs/plans/BL1-0_BL18-ALIGNMENT.md)).

## Documentation strategy

| Вопрос | Где искать |
|--------|------------|
| Зачем так устроен репо, деплой, модули | `ARCHITECTURE.md` (этот файл) |
| Что реализовать (контракт, API, UX) | `docs/specs/` |
| Как реализовать фазу (env, verification) | `docs/plans/` |
| Продукт, бэклог, видение | [Notion](https://app.notion.com/p/33a2fbb64c0e80baa2e4f8cac9adb618) |
| Процесс Planner → Implementer → Verifier | [`docs/SUBAGENTS_WORKFLOW.md`](docs/SUBAGENTS_WORKFLOW.md), [`AGENTS.md`](AGENTS.md) |

При расхождении: для кода — GitHub specs/plans; для продуктовых решений — Notion, пока не перенесено в спеку.

## Local development

**Лендинг** (корень репо):

```bash
python3 -m http.server 8080
# → http://localhost:8080
```

**Приложение:**

```bash
cd app && npm install && npm run dev
# → http://localhost:3000
```

Переменные окружения: [`docs/plans/BL1-0_ENV.md`](docs/plans/BL1-0_ENV.md), секреты BL-6: [`docs/plans/BL2-0_SECRETS_SETUP.md`](docs/plans/BL2-0_SECRETS_SETUP.md).
