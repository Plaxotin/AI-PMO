# BL1-0 — старт разработки (зафиксированные решения)

**Фаза:** BL1-0 — контракты, схема БД v1, скелет API  
**Дата фиксации:** 18 мая 2026  
**Связанные документы:** `docs/specs/SPEC-BL-6-assignments-admin.md` (спека BL-6), `docs/plans/ASSIGNMENTS_ADMIN_CURSOR_PLAN.md` (фазы BL1-*), `docs/specs/SPEC-PLAN-AUDIT.md` (отдельная фича — аудит плана).

> Обновление 2026-05-25: для MVP BL-6 обязательная пользовательская авторизация исключена и перенесена в post-MVP (см. `docs/specs/BL6_PRODUCT_DECISIONS.md`, раздел 8). Этот документ сохраняет исторический контекст BL1-0.

---

## 1. Решения продукта и инфраструктуры (ответы команды)

| # | Тема | Решение |
|---|------|---------|
| 1 | Репозиторий | **Один репозиторий** с лендингом (`index.html` в корне). Код приложения (Next.js) появляется в этом же репо (подкаталог, например `app/` или `packages/web/`) — уточнить структуру при первом коммите приложения. |
| 2 | Организации / тенанты | **Один глобальный проект** без организаций и без мультитенанта в UI BL-1 на старте. Достаточно одной строки в `projects` или константы `DEFAULT_PROJECT_ID`. **BL-18** вводит `tenants` отдельно (см. `docs/plans/BL1-0_BL18-ALIGNMENT.md`, ADR-BL-18-01). |
| 3 | Аутентификация | **Рекомендация:** **Supabase Auth** в связке с **Supabase Postgres** как направление для post-MVP. Для MVP BL-6 обязательный логин не требуется. |
| 4 | База данных | **Supabase (PostgreSQL)**. Регион проекта Supabase выбрать ближе к пользователям и проверить доступность дашборда/API из РФ на практике (политики у провайдеров меняются). |
| 5 | Исполнители | Допускаются **строковые метки** (например ФИО, `@username`, произвольная строка). Не требовать `user_id` исполнителя в BL1-0; поле вида `assignee_label` (text) или массив текстов — зафиксировать в Zod и миграции. |
| 6 | US-7 (инжест из канала) | **Нет** в первом релизе. Таблицы сырого сообщения, вебхуки и LLM-извлечение **не входят** в миграцию v1 и не входят в скелет BL1-0, если не решено иначе позже. |
| 7 | Префикс API | **`/api/projects/:projectId/assignments`** для коллекции и элемента (`…/assignments/:assignmentId` для GET/PATCH по соглашению REST). |

---

## 2. Скоуп BL1-0 (что сделать в коде и артефактах)

- **Zod + TypeScript:** `Project`, `Assignment`, `AssignmentStatus`, query DTO для списка (фильтры: `status`, диапазон `due_at`, поиск по `assignee_label` / тексту при необходимости), единый формат ошибок API.
- **Миграция v1 (Supabase SQL или Prisma/Drizzle):** таблицы минимум `projects`, `assignments`; опционально `assignment_status_events` для аудита смен статуса (предпочтительно отдельная таблица вместо JSON `history` для запросов «кто когда»).
- **Индексы:** `(project_id, status)`, `(project_id, due_at)` на `assignments`.
- **Скелет route handlers** в Next.js App Router под п.7: заглушки или ответы из пустой БД с валидацией `projectId`/тела.
- **Seed:** одна строка `projects` (глобальный проект) и при желании 1–2 тестовых поручения для локальной отладки.
- **Переменные окружения (черновик):** `DATABASE_URL` или пары `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` / anon по политике; без секретов в репозитории.

---

## 3. Модель данных (черновик полей под §11 MVP)

**`projects`**

- `id` (uuid), `name` (text), `created_at`, `updated_at`.

**`assignments`**

- `id`, `project_id` (FK), `title`, `description` (nullable),
- `status` — enum: `draft` | `open` | `done` | `cancelled`,
- `due_at` (timestamptz, nullable),
- `owner_id` — UUID пользователя Supabase Auth (`auth.users`) или text FK на вашу таблицу `profiles`, если введёте её в BL1-0/BL1-1,
- `assignee_label` (text, nullable) — строковая метка исполнителя; при нескольких исполнителях в MVP можно хранить одну строку или разделитель `;` до нормализации в отдельную таблицу,
- `source` — enum: `manual` | `import` | `webhook` (в v1 по умолчанию только `manual`; остальные значения зарезервированы),
- `created_at`, `updated_at`.

**`assignment_status_events`** (рекомендуется)

- `id`, `assignment_id`, `from_status`, `to_status`, `actor_id`, `created_at`.

Инжест, `ClarificationSession`, Telegram — **вне** BL1-0 при текущих решениях (см. п.6).

---

## 4. Auth (детализация рекомендации)

- **Supabase Auth (post-MVP):** при подключении auth в последующих версиях использовать клиент с **cookie/session** или **service role** только там, где нет пользовательского контекста (минимизировать). Политика `owner_id` от текущей сессии вводится после MVP.
- Для **одного глобального проекта** допустим упрощённый MVP: доступ к API без обязательного логина; ACL и user-scoped правила вводятся после пилота.

---

## 5. Риски и проверки

- **Доступность Supabase из РФ:** проверить с реальных сетей; иметь план B (self-host Postgres + Auth.js), если станет критично.
- **Лендинг + приложение в одном репо:** не смешивать статику лендинга с секретами приложения; API routes только в приложении Next, не в чистом static hosting без сервера.
- **Согласование с `ASSIGNMENTS_ADMIN_CURSOR_PLAN.md`:** тот документ ориентирован на Telegram, голос, публичный реестр — это **следующие** этапы после реестра в MVP; не тянуть все сущности в миграцию v1.

---

## 6. Критерий готовности BL1-0

- [x] Миграция накатывается на Supabase (или локальный Postgres с тем же SQL) — `supabase/migrations/20260524000000_bl1_v1.sql`.  
- [x] Seed создаёт глобальный проект — `supabase/seed.sql`.  
- [x] Zod-схемы согласованы с колонками БД — `app/src/lib/assignments/types.ts`.  
- [x] Скелет маршрутов `/api/projects/[projectId]/assignments` отвечает валидируемыми заглушками; обязательная auth не требуется в MVP.
- [x] В `README` / `docs/` перечислены env — `docs/plans/BL1-0_ENV.md`, `app/README.md`, `app/.env.example`.

**Приложение:** каталог `app/` (Next.js 15). Статус фазы: `ready_for_test` (ветка `cursor/bl1-0-kickoff-35d7`).
