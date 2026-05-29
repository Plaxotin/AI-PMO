# BL1-0 — переменные окружения (Next.js приложение в `app/`)

Приложение AI PMO (реестр поручений) запускается из каталога `app/`. Лендинг в корне репозитория секреты не использует.

## Обязательно для локальной разработки API с БД

| Переменная | Описание |
|------------|----------|
| `DATABASE_URL` | PostgreSQL connection string (Supabase → Settings → Database → URI). Альтернатива прямому Supabase REST для read-путей BL1-0. |

После настройки примените миграцию и seed:

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260524000000_bl1_v1.sql
psql "$DATABASE_URL" -f supabase/seed.sql
```

## Supabase Auth (опционально в BL1-0, рекомендуется)

| Переменная | Описание |
|------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL проекта Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key (браузер + cookie session в route handlers) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (только сервер, не публиковать) |

Если заданы `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_ANON_KEY`, API возвращает **401** без сессии.

Если Supabase **не** настроен, API работает без проверки сессии и отдаёт заголовок `X-Auth-Status: todo-supabase-not-configured` (явный TODO для BL1-1).

## Глобальный проект

| Константа | Значение |
|-----------|----------|
| `DEFAULT_PROJECT_ID` | `00000000-0000-4000-8000-000000000001` (см. `app/src/lib/config.ts` и `supabase/seed.sql`) |

## Запуск

```bash
cd app
cp .env.example .env.local   # заполните DATABASE_URL
npm install
npm run dev
```

Проверка списка (без auth, если Supabase не настроен):

```bash
curl -s "http://localhost:3000/api/projects/00000000-0000-4000-8000-000000000001/assignments" | jq
```

## LLM (BL-6 smart-input, BL-18 письма)

Контракт env — `docs/specs/ADR-BL-18-02-production-decisions.md` §3. Ключ API **всегда** называется `LLM_API_KEY`; для Kimi дополнительно `LLM_PROVIDER=kimi`, `LLM_API_BASE_URL`, `LLM_MODEL_ID` (см. `app/.env.example`).

| Куда | Имя переменной |
|------|----------------|
| **Cursor Cloud** → Cloud Agents → Secrets | `LLM_API_KEY` (без `NEXT_PUBLIC_`) |
| **Локально** → `app/.env.local` | `LLM_API_KEY=...` (скопировать из `app/.env.example`) |
| **Vercel** → Environment Variables проекта `app/` | `LLM_API_KEY` |

`KIMI_API_KEY` приложение **не читает** — переименуйте секрет или продублируйте то же значение под именем `LLM_API_KEY` (п.1 и п.3 из чеклиста).

## Деплой

Корень Vercel для приложения — каталог **`app/`** (отдельный проект или monorepo root directory). Статический лендинг остаётся в корне репозитория с `vercel.json` (`buildCommand: null`).
