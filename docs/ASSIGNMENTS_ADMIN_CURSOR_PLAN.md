# Администратор поручений — план реализации (фазы)

**Статус:** актуальный план (ревизия Planner 2026-05-24; синхронизирован со спекой v1.2)  
**Спека:** `docs/SPEC-BL-6-assignments-admin.md` — источник истины по требованиям и решениям  
**Связанные файлы:** `docs/BL6_PRODUCT_DECISIONS.md`, `docs/BL1-0_KICKOFF.md`, `docs/BL1-0_VERIFICATION.md`  
**Подход:** один разработчик, последовательные фазы; каждая фаза — отдельная ветка и PR.

---

## 1. Цель продукта (кратко)

Сервис принимает поручения из **Telegram** (текст, голос, видео) и через **веб-форму** в AI PMO, ведёт реестр с полями **описание · срок · ответственный**, задаёт уточняющие вопросы в **треде**, уведомляет в Telegram-канал, публикует реестр на **Yandex Object Storage**, поддерживает выгрузку и правки через **signed links**.

**Убийственный сценарий:** аудио/видео с летучки → боту или через веб → список поручений с экраном подтверждения.

### Зафиксированные решения

| Тема | Решение |
|------|---------|
| STT | **[SaluteSpeech (Сбер)](https://developers.sber.ru/docs/ru/salutespeech/overview)** — РФ-контур; fallback — Whisper-совместимый при недоступности |
| CDN реестра | **Yandex Object Storage** + Yandex CDN |
| Хранение медиа | **Не храним:** tmp → SaluteSpeech → удалить; оригинал остаётся в Telegram-канале |
| Уточнения | **Тред** под исходным сообщением |
| Авторизация правок | **Одноразовые signed links** |

---

## 2. Архитектура

```
Telegram (канал / личка)                Web-форма (AI PMO UI)
  │ текст / голос / видео                 │ аудио / видео (≤ 500 МБ)
  ▼                                       ▼
Bot Webhook ──────────────────► Media Ingest
                                  │ tmp → ffmpeg (видео) → SaluteSpeech STT → удалить файл
                                  ▼
                          LLM slot-filling / разбиение записи на черновики
                                  │
                  Тред-уточнения (Telegram)    Confirm UI (веб)
                                  │                   │
                                  └────────┬───────────┘
                                           ▼
                                     API + DB (Postgres)
                               ┌──────────────────────────┐
                               │                          │
                     Scheduler (cron/outbox)     Static generator
                     → напоминания в Telegram    → registry.json + index.html
                                                 → Yandex Object Storage CDN
                                                 ↑
                                     Import / Export / Signed-link edits
```

**БД (целевая):** `assignments`, `assignment_status_events` (v1; при необходимости расширить до полного аудита полей в BL1-1), `clarification_sessions`, `reminder_logs`, `media_ingest_jobs`, `publication_snapshots`.  
**Медиафайлы:** только в tmp/RAM, не сохраняются в БД и Object Storage.

---

## 3. Фазы реализации

---

### Фаза BL1-0 — Контракты и данные ✅

**phase_id:** BL1-0  
**status:** `verified` (см. `docs/BL1-0_VERIFICATION.md`)

**Результат:** Zod-типы, SQL-миграция v1, скелет API, seed.

**testing_scenario:** `not_required` — фаза завершена и верифицирована статически; повторная проверка по `docs/BL1-0_VERIFICATION.md`.

---

### Фаза BL1-1 — CRUD поручений и авторизация

**phase_id:** BL1-1  
**status:** `planned`  
**Зависит от:** BL1-0

**Результат:** рабочие API-эндпоинты реестра с проверкой прав и журналом истории.

**Scope:**

- Реализация эндпоинтов (контракт — `docs/SPEC-BL-6-assignments-admin.md` §9):
  ```
  GET    /api/projects/:projectId/assignments          — список с фильтрами
  POST   /api/projects/:projectId/assignments
  GET    /api/projects/:projectId/assignments/:id      — карточка + история событий
  PATCH  /api/projects/:projectId/assignments/:id
  DELETE /api/projects/:projectId/assignments/:id      — отмена (status → cancelled)
  ```
- Фильтры списка (привести к спеке; заменить черновик BL1-0 `due_from`/`due_to`/`limit`/`offset`/`q`):
  `status`, `due_before`, `due_after`, `assignee` — **точное совпадение** с `assignee_label` (см. `docs/BL6_PRODUCT_DECISIONS.md` §4), `source`, `page`, `per_page`.
- Ответ списка: `{ data: Assignment[], meta: { total, page, per_page } }`.
- Авторизация (согласовано с `docs/BL1-0_KICKOFF.md` §4): любой аутентифицированный пользователь видит и редактирует **все** поручения глобального проекта; изоляция — по `project_id` (чужой UUID → `403`/`404`).
- Журнал (`docs/BL6_PRODUCT_DECISIONS.md` §1): расширить `assignment_status_events` — `event_type` (`status_change` | `field_change` | `created` | `cancelled`); для `field_change` — `field_name`, `old_value`/`new_value`.
- Оптимистическая блокировка: поле `version`, конфликт → `409` с текущей версией.
- Миграция v2: `version` (int, default 1), расширить enum `assignment_source` значением `web_upload`, `media_ingest_job_id` (nullable uuid, FK добавить после таблицы `media_ingest_jobs` в BL1-3/BL1-5 — до FK допустим nullable без constraint).

**Env (дополнить `docs/BL1-0_ENV.md`):** `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

**Критерий готовности:** интеграционные тесты: создать / прочитать / изменить / отменить поручение; доступ к чужому `project_id` → `403`/`404`; `assignment_status_events` при смене статуса; `409` при конфликте `version`.

**testing_scenario:**

| Поле | Значение |
|------|----------|
| **setup** | `DATABASE_URL` + миграции v1 и v2; seed; Supabase Auth или тестовая сессия; `DEFAULT_PROJECT_ID`. |
| **actions** | 1) `POST` поручение с `title`. 2) `GET` список с `status=open`. 3) `PATCH` с `version`. 4) `DELETE`. 5) Запрос с другим `projectId`. 6) `PATCH` со stale `version`. |
| **expected** | `201`/`200` на CRUD; событие в `assignment_status_events`; `DELETE` → `cancelled`; чужой проект → `403`/`404`; stale version → `409`. |
| **evidence** | Вывод Vitest/integration; `curl` transcript; строки в `assignment_status_events`. |

---

### Фаза BL1-2 — UI реестра

**phase_id:** BL1-2  
**status:** `planned`  
**Зависит от:** BL1-1

**Результат:** полноценный интерфейс реестра в веб-приложении AI PMO.

**Scope:**

- Список поручений с фильтрами по статусу, сроку, ответственному; пагинация (`page`/`per_page`).
- Карточка поручения: все поля, история изменений (`assignment_status_events`).
- Форма создания и редактирования поручения вручную.
- Пустые состояния, скелетоны загрузки, сообщения об ошибках сети.
- Оптимистичное обновление UI; конфликт версии (`409`) → диалог merge.

**Критерий готовности:** создать, отредактировать, отфильтровать, отменить поручение вручную через UI; при недоступном API — понятная ошибка.

**testing_scenario:**

| Поле | Значение |
|------|----------|
| **setup** | `npm run dev` в `app/`; BL1-1 API на живой БД; тестовый пользователь с сессией. |
| **actions** | Создать поручение в форме; отфильтровать по статусу; открыть карточку; изменить срок; отменить; остановить API и повторить действие. |
| **expected** | Запись в списке; фильтр сужает выборку; история на карточке; `409` при параллельном редактировании; offline — сообщение об ошибке. |
| **evidence** | Скриншот/запись UI; Network tab (статусы API). |

---

### Фаза BL1-3 — Telegram-инжест: текст, голос, видео, US-C + уточнения

**phase_id:** BL1-3  
**status:** `planned`  
**Зависит от:** BL1-1 (черновики, `ClarificationSession`, задел под `media_ingest_jobs`)

**Результат:** Telegram-бот принимает все типы сообщений; одиночные поручения — slot-filling с уточнениями в треде; **US-C (Telegram)** — запись мероприятия → `MediaIngestJob` с черновиками (подтверждение в UI — BL1-5).

**Scope:**

**Webhook и инжест:**

- `POST /api/telegram/webhook`; верификация `X-Telegram-Bot-Api-Secret-Token`; ответ 200 немедленно, обработка асинхронно.
- Идемпотентный ключ: `chat_id + message_id` — повторная доставка не создаёт дубль.
- **Текст** → LLM slot-filling (одно поручение).
- **Короткое голос/аудио** (`voice`, `audio`): tmp → **SaluteSpeech** STT → удалить → slot-filling.
- **Короткое видео** (`video`, `video_note`): tmp → **ffmpeg** → SaluteSpeech → удалить → slot-filling.
- **US-C (запись мероприятия в Telegram):** маршрут по эвристике `docs/BL6_PRODUCT_DECISIONS.md` §2 (`/meeting`, ключевые слова, duration ≥ 90 с, файл ≥ 3 МБ) → STT → LLM-разбиение → `MediaIngestJob` + `drafts`; в тред — «подтвердите в веб-UI».
- Файл из Telegram **> 25 МБ** (спека §10): ответ в тред с подсказкой веб-загрузки (US-C2).
- Команды: `/help`; при необходимости `/link_project`.
- Миграции: `clarification_sessions`, `media_ingest_jobs` (минимум для US-C).

**LLM slot-filling (одиночное поручение):**

- Извлечь: `title`/`description`, `due_at`, `assignee` → `assignee_label`.
- В LLM — только нормализованный транскрипт + текущий черновик; без полного лога канала.

**Уточняющие вопросы (тред):**

- Поле не извлечено или confidence < порога → вопрос в тред.
- Максимум 3 раунда; ≤ 3 вопросов за раунд.
- Таймаут черновика 24 ч → `cancelled`, уведомление в тред.
- После трёх обязательных полей → `open`, подтверждение в тред.
- Состояние: `ClarificationSession`.

**Env-переменные:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `SALUTESPEECH_CLIENT_ID`, `SALUTESPEECH_SECRET`.

**Критерий готовности:**

- Текст / короткий голос / видео (≤ 25 МБ) → черновик или `open`.
- Неполное сообщение → вопрос в тред → ответ → `open`.
- Черновик 24 ч без ответа → `cancelled`.
- US-C: файл совещания в Telegram → `MediaIngestJob` со списком `drafts` (API `GET .../ingest/:jobId/drafts`).
- Повторный `message_id` → без дублей; tmp пуст через 60 с.

**testing_scenario:**

| Поле | Значение |
|------|----------|
| **setup** | Тестовый Telegram-бот; webhook URL; SaluteSpeech sandbox; фикстуры: текст, короткий voice, mp4 ≤ 25 МБ, mock совещание для US-C. |
| **actions** | Отправить текст; voice; video; неполный текст + ответ в тред; US-C файл; повтор webhook; файл > 25 МБ. |
| **expected** | Корректные статусы `draft`/`open`/`cancelled`; `ClarificationSession` обновляется; US-C → job + drafts; идемпотентность; отказ > 25 МБ. |
| **evidence** | Логи webhook; строки в БД; `ls` tmp через 60 с; ответ `GET .../ingest/:jobId/drafts`. |

---

### Фаза BL1-4 — Напоминания · публичный реестр · импорт/экспорт

**phase_id:** BL1-4  
**status:** `planned`  
**Зависит от:** BL1-3 (нужны финальные записи `open` для напоминаний и публикации)

**Результат:** автоматические напоминания в Telegram, публичный реестр на YOS, выгрузка и ручные правки.

**Scope:**

**Напоминания:**

- Cron-задание: выборка `Assignment` с `due_at` в настроенных окнах (за N дней/часов, в день дедлайна).
- Антидубли: `ReminderLog` по `(assignment_id, reminder_type)`.
- Шаблон (RU): описание · срок · ответственный · ссылка `<YOS_URL>/index.html#<id>`.
- Конфиг на уровне проекта: интервалы, часовой пояс, флаг выключения.

**Публичный реестр (Yandex Object Storage):**

- Генерация `registry.json` (согласованные колонки, без лишнего PII) + `index.html` (таблица, клиентский поиск, без зарубежных runtime-зависимостей).
- Версионирование: `updated_at`, ETag.
- Деплой: YC CLI / rclone / `aws s3 cp` → bucket + CDN invalidation. URL: `https://<bucket>.storage.yandexcloud.net/`.
- Триггер публикации: после подтверждения черновиков или ручной правки; вручную — `POST /api/projects/:projectId/publish`.
- `GET /api/projects/:projectId/registry` — статус (URL, `updated_at`, ETag).

**Импорт / экспорт / signed links:**

- `GET .../assignments/export?format=csv|xlsx` — полный срез с `updated_at`.
- `POST .../assignments/import` (multipart) — валидация, сопоставление по `id`, отчёт `{ accepted, skipped, conflicts }`, опционально diff-превью.
- Signed links: генерация одноразовой ссылки для редактирования конкретной записи; невалидна после использования или по TTL (15 мин). После правки → публикация снапшота.

**Env-переменные:** `YOS_ACCESS_KEY_ID`, `YOS_SECRET_ACCESS_KEY`, `YOS_BUCKET`, `YOS_CDN_BASE_URL`.

**Критерий готовности:**

- Поручение с `due_at` через 1 ч → ровно одно сообщение в канал; повторный запуск cron → без дублей.
- `registry.json` и `index.html` задеплоены; URL открывается из РФ; обновление ≤ 2 мин.
- Round-trip: экспорт → правка в Excel → импорт → снапшот обновлён.
- Signed link работает ровно один раз.

**testing_scenario:**

| Поле | Значение |
|------|----------|
| **setup** | Поручения `open` с `due_at`; YOS bucket (или mock); cron trigger; Telegram test channel. |
| **actions** | Запустить cron дважды для одного дедлайна; `POST /publish`; открыть публичный URL; export → правка xlsx → import; сгенерировать signed link и отредактировать. |
| **expected** | Одно напоминание на интервал; `registry.json`/`index.html` доступны; round-trip импорта; signed link одноразовый. |
| **evidence** | `ReminderLog` rows; HTTP HEAD ETag; import report JSON; повтор signed link → 403/410. |

---

### Фаза BL1-5 — US-C2 веб-загрузка · экран подтверждения (US-C/US-C2) · наблюдаемость · пилот

**phase_id:** BL1-5  
**status:** `planned`  
**Зависит от:** BL1-2 (навигация в реестр), BL1-3 (SaluteSpeech/ffmpeg, `media_ingest_jobs`, US-C drafts из Telegram), BL1-4 (публичный URL для ссылок в напоминаниях)

**Результат:** веб-форма **US-C2**; **общий экран подтверждения** черновиков для US-C (Telegram) и US-C2 (Web); финальный аудит безопасности и пилот.

**Scope:**

**Веб-загрузка (US-C2) — API:**

```
POST /api/projects/:projectId/media/ingest
     multipart/form-data:
       file          — аудио (.mp3 .m4a .ogg .wav .opus)
                       или видео (.mp4 .mov .webm .mkv), ≤ 500 МБ
       meeting_title — (опц.) название мероприятия
       meeting_date  — (опц.) ISO-8601
       participants  — (опц.) JSON-массив @username / имён участников

GET  /api/projects/:projectId/media/ingest/:jobId
     → { status: pending|processing|done|failed, progress_pct, error? }

GET  /api/projects/:projectId/media/ingest/:jobId/drafts
     → { drafts: [{ id, title, due_at?, assignee?, confidence }] }

POST /api/projects/:projectId/media/ingest/:jobId/confirm
     { accepted: [id,...], rejected: [id,...], overrides: { id: { ... } } }
     — принятые черновики → Assignment.status = 'open'
```

**Веб-загрузка — pipeline:**

- Принять файл, сохранить в tmp/RAM.
- Видео → ffmpeg → аудиодорожка; аудио — напрямую.
- SaluteSpeech STT → транскрипт.
- Удалить медиафайл немедленно после транскрипции.
- LLM: разбить транскрипт на отдельные поручения; для каждого — `title`, `due_at`, `assignee` (по `participants` или эвристике).
- Сохранить черновики в `MediaIngestJob.drafts` (jsonb).
- Файлы > 25 МБ: асинхронная обработка; статус через polling `GET .../ingest/:jobId` или SSE.

**Веб-загрузка — UI (страница проекта):**

- Форма: поле файла, `meeting_title`, `meeting_date`, `participants`.
- Прогресс-бар / spinner (polling/SSE).
- Экран подтверждения: список черновиков, редактирование каждого, «принять» / «отклонить».
- После confirm → редирект на реестр с новыми записями.

**Обработка ошибок:**

- Файл > 500 МБ → `413`; неподдерживаемый формат → `415`.
- SaluteSpeech недоступен → `503` с retry-подсказкой; `job.status` остаётся `pending` для повтора (спека §10).

**Наблюдаемость (финальный проход; базовые логи webhook — с BL1-3):**

- Структурированные JSON-логи: STT, LLM, ingest confirm, публикация, напоминания.
- Rate limit `/media/ingest`: 10 запросов/ч на `project_id` (доп. к webhook limit из BL1-3).
- Секреты только в env; маскирование в логах.
- Интеграционный тест no-storage: через 60 с после STT медиафайл не найден в tmp.

**Критерий готовности:**

- **US-C2:** mp3/mp4 через веб-форму → черновики → confirm → `open` в реестре.
- **US-C (E2E):** черновики из Telegram job (BL1-3) подтверждаются тем же UI → `open`.
- Файл удалён с сервера до ответа `/confirm`.
- Файл > 500 МБ → `413`; STT down → `pending` + `503`.
- Секреты не в логах; нет медиафайлов в tmp.

**testing_scenario:**

| Поле | Значение |
|------|----------|
| **setup** | BL1-3 job с drafts (US-C) и чистая веб-сессия; тестовые mp3/mp4; mock SaluteSpeech failure. |
| **actions** | Web upload mp3 → poll → confirm; upload mp4 > 25 МБ (async); open confirm UI для Telegram job; upload > 500 МБ; STT 503; grep логов на токены. |
| **expected** | US-C2 и US-C E2E → `open`; async polling; `413`/`415`/`503`; `pending` при STT outage; tmp clean. |
| **evidence** | API responses; реестр после confirm; логи без секретов; tmp listing. |

---

## 4. Последовательность и зависимости

```
BL1-0 ✅
  └─► BL1-1 (CRUD + authz)
        └─► BL1-2 (UI реестра)
        └─► BL1-3 (Telegram + SaluteSpeech + уточнения)
              └─► BL1-4 (напоминания + YOS + импорт/экспорт)
              └─► BL1-5 (веб-загрузка + наблюдаемость + пилот)
                    └── зависит также от BL1-4 (нужен публичный URL реестра)
```

По `docs/SUBAGENTS_WORKFLOW.md` в один момент активна **одна** фаза (`Implementer` / `Verifier`). Рекомендуемый порядок после BL1-1: **BL1-2 → BL1-3 → BL1-4 → BL1-5** (UI реестра до Telegram и экрана подтверждения US-C/US-C2). Параллель BL1-2 и BL1-3 допустима только при явном исключении пользователя и раздельных ветках — по умолчанию **не** планировать.

---

## 5. Рекомендуемые LLM в Cursor по фазам

| Фаза | Режим Cursor | Модели |
|------|-------------|--------|
| BL1-0 (выполнено) | Agent / Composer | Claude Sonnet, GPT-4.1 |
| BL1-1 CRUD + authz | Agent | Sonnet, GPT-4o |
| BL1-2 UI реестра | Agent / Composer | Sonnet, GPT-4o |
| BL1-3 Telegram + STT + LLM + тред | Agent + Chat | GPT-4.1 / Sonnet; промпты — Opus точечно |
| BL1-4 Напоминания + YOS + signed links | Agent | Sonnet, GPT-4o |
| BL1-5 Веб-загрузка + наблюдаемость | Agent + Chat | Sonnet; диагностика STT — Opus |

---

## 6. Чеклист приёмки пилота

- [ ] Текст в канале → поручение (или цикл уточнений в треде).
- [ ] Голосовое → SaluteSpeech → то же.
- [ ] Видео из Telegram → ffmpeg → SaluteSpeech → то же.
- [ ] Неполное сообщение → вопрос в тред → ответ → `open`; 24 ч без ответа → `cancelled`.
- [ ] **US-C (Telegram):** аудио/видео файл → боту → черновики в UI → подтверждение → `open`.
- [ ] **US-C2 (Web):** тот же файл через веб-форму → экран подтверждения → `open`.
- [ ] Медиафайл удалён с сервера после STT (нет в tmp через 60 с).
- [ ] За N до `due_at` — ровно одно уведомление в канал; повторный запуск не дублирует.
- [ ] Публичный URL (YOS) открывается из РФ; обновляется ≤ 2 мин после публикации.
- [ ] Выгрузка → правка → импорт → снапшот обновлён.
- [ ] Signed link работает ровно один раз; после использования — невалиден.
- [ ] Повторная доставка webhook с тем же `message_id` → без дублей.
- [ ] Секреты не попадают в логи.

---

## 7. Вне скоупа первой итерации (бэклог)

- Диалог уточнений в личке с ботом (только тред в MVP).
- Несколько каналов и матрица ролей; SSO / LDAP.
- Интеграции кроме Telegram (Slack, e-mail).
- Автоматическое определение ответственного из LDAP/HR по @username.
- Хранение и архив медиафайлов.
- LLM-дедупликация поручений по семантике.
- Мобильное приложение / PWA.
