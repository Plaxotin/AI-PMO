# Администратор поручений — план реализации (фазы)

**Статус:** актуальный план (ревизия Planner 2026-05-31; синхронизирован со спекой v2.2)  
**Спека:** `docs/specs/SPEC-BL-6-assignments-admin-v2.2.md` — источник истины по требованиям и решениям  
**Связанные файлы:** `docs/specs/BL6_PRODUCT_DECISIONS.md`, `docs/plans/BL1-0_KICKOFF.md`, `docs/plans/BL1-0_VERIFICATION.md`, `docs/plans/BL2-0_SECRETS_SETUP.md`  
**Подход:** один разработчик, последовательные фазы; каждая фаза — отдельная ветка и PR.

**Среда приёмки (Verifier):** [https://ai-pmo-tawny.vercel.app/](https://ai-pmo-tawny.vercel.app/) — production Vercel; не ограничиваться localhost. Секреты — по `docs/plans/BL2-0_SECRETS_SETUP.md` (Vercel env для `app/`).

---

## 1. Цель продукта (кратко)

Инструмент BL-6 **заполняет реестр поручений** в Google Sheets по шаблону [PMI Action Item Tracker](https://docs.google.com/spreadsheets/d/1BVD8pfu6avCFkpf1gR71cZkbHOH0V_bsNHkEa5hm998/edit?usp=sharing) с минимальным усилием пользователя.

**Один экран. Ноль промежуточных шагов.** Smart-input (текст / 🎤 / 📎) → AI раскладывает по колонкам → строки **сразу в таблице** в edit-mode (✓ / ✗). Редактирование существующих записей — в Google Sheets (ссылка в сайдбаре).

**Убийственный сценарий:** запись летучки через 📎 → STT + LLM → N строк в edit-mode → ✓ на каждой → строки в Google Sheet.

### Зафиксированные решения (v2.2)

| Тема | Решение |
|------|---------|
| Хранилище реестра | **Google Sheets API** (OAuth 2.0 от имени пользователя; Service Account не используется) |
| STT | **[SaluteSpeech (Сбер)](https://developers.sber.ru/docs/ru/salutespeech/overview)** — РФ-контур |
| LLM | **Moonshot Kimi** (`moonshot-v1-8k`); см. `docs/specs/BL6_PRODUCT_DECISIONS.md` §8 |
| Медиафайлы | **Не храним:** tmp → STT → удалить |
| Подтверждение | **Direct-to-table:** edit-mode строки (✓ / ✗), без отдельных экранов превью |
| Telegram / напоминания | **Фаза BL2-1** — вне скоупа BL2-0 |

---

## 2. Архитектура (v2.2)

```
                        ┌────────────────────────┐
                        │   Google Sheets (PMI     │
                        │   Action Item Tracker)   │
                        │  ← Sheets API (write)    │
                        │  → Sheets API (read)     │
                        └──────────▲─────▲─────────┘
                            write  │     │ read
    ┌──────────────────────────────┴─────┴────────────────────────┐
    │              AI PMO — единый экран (BL2-0)                   │
    │  Smart-input (текст 🎤 📎 ➤) → LLM / STT → edit-mode строки │
    │  Таблица реестра (read-only + Excel-стиль ▾)                 │
    └──────────────────────────────────────────────────────────────┘

    Telegram Bot + напоминания (BL2-1, опционально)
```

Код BL1-0 (Zod, SQL-миграции) **сохранён как справочный материал**; фазы BL1-1…BL1-5 **отменены** (см. спека §17).

---

## 3. Фазы реализации

---

### Фаза BL1-0 — Контракты и данные (историческая справка)

**phase_id:** BL1-0  
**title:** Контракты и данные (v1.3, отменена)  
**status:** `verified` — **только историческая справка**; новые фазы v2.0+ **не зависят** от BL1-0.

**Результат (архив):** Zod-типы, SQL-миграция v1, скелет API, seed.

**testing_scenario:** `not_required` — фаза завершена и верифицирована статически; повторная проверка по `docs/plans/BL1-0_VERIFICATION.md`.

---

### Фаза BL2-0 — Единый экран + Google Sheets + smart-input + AI-инжест файлов

**phase_id:** BL2-0  
**title:** Единый экран + Google Sheets + smart-input + AI-инжест файлов  
**status:** `in_progress` (реализация утверждена пользователем)  
**Зависит от:** —

**goal:** полностью рабочий инструмент на одном экране: авто-создание таблицы, smart-input с LLM, загрузка файлов с STT+LLM, direct-to-table.

**scope:**

- Google Sheets API: авторизация, создание таблицы по шаблону, чтение, запись, batch-запись.
- Endpoints: `/sheets/init`, `/sheets/connect`, `/sheets/status`, `/assignments` (GET/POST), `/assignments/parse`, `/assignments/batch`, `/ingest` (POST/GET).
- Web UI — единый экран (спека §6.2):
  - Сайдбар (навигация, «Открыть в Google Sheets ↗», «Подключить свой реестр»).
  - Smart-input (текстовое поле + 🎤 + 📎 + ➤).
  - Таблица реестра (Excel-стиль фильтры ▾ в заголовках).
  - Edit-mode строки (подсветка, editable fields, ✓ / ✗).
  - Прогресс-бар для обработки файлов.
- LLM slot-filling: промпт для разбора свободного текста и транскриптов.
- STT pipeline: SaluteSpeech + ffmpeg для видео.
- Диктовка: Web Speech API (клиентская).

**out_of_scope:**

- **Telegram-инжест** (webhook, бот, приём сообщений из Telegram) — **только BL2-1**.
- **Напоминания** по `Target Date` в Telegram — **только BL2-1**.
- Любые env `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` — до BL2-1.

**dependencies:** —

**files_or_areas:** `app/` (Next.js App Router): API routes, UI единого экрана BL-6, интеграции Google Sheets / SaluteSpeech / LLM.

**Env:** см. `docs/plans/BL2-0_SECRETS_SETUP.md` и `docs/specs/BL6_PRODUCT_DECISIONS.md` §8 — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`; `LLM_PROVIDER=kimi`, `LLM_API_BASE_URL=https://api.moonshot.ai/v1`, `LLM_MODEL_ID=moonshot-v1-8k`, `LLM_API_KEY`; `SALUTESPEECH_CLIENT_ID`, `SALUTESPEECH_SECRET`. Access/refresh-токены Google — только в сессии приложения, не в env.

**acceptance_criteria:**

- При первом запуске — авто-создание таблицы, сразу на рабочем экране.
- Текстовый ввод → LLM → строка в edit-mode → ✓ → строка в Google Sheet.
- Минимальный ввод («обновить документацию») → Brief Name заполнен, остальное пусто → ✓ → запись.
- 📎 mp3 → STT → LLM → N строк в edit-mode → ✓ на каждой → N строк в Sheet.
- 📎 mp4 → ffmpeg → тот же pipeline.
- ✗ → строка исчезает, в Sheet ничего.
- Файл > 500 МБ → отказ.
- Excel-фильтры ▾ работают.
- «Открыть в Google Sheets ↗» в сайдбаре → корректная ссылка.
- «Подключить свой реестр» → автосозданная таблица заменяется.

**testing_scenario:**

| Поле | Значение |
|------|----------|
| **setup** | OAuth 2.0 Client (Google Cloud); тестовый Google-аккаунт с пройденным consent; SaluteSpeech credentials; LLM API key; тестовые mp3/mp4; `npm run dev`. |
| **actions** | 1) Открыть BL-6 → проверить авто-создание Sheet. 2) Smart-input «Петров — ТЗ к 3 июня, важно, с летучки» → проверить edit-mode строку → ✓. 3) Smart-input «обновить документацию» → ✓. 4) 📎 mp3 совещания → дождаться строк → ✓ на 2, ✗ на 1. 5) 📎 mp4 → тот же flow. 6) Файл > 500 МБ. 7) Открыть Google Sheet — проверить строки. 8) Изменить строку в Google Sheets → refresh → проверить. 9) Фильтр ▾ по статусу. 10) «Подключить свой реестр» → проверить замену. |
| **expected** | Авто-таблица создана; текст → корректный LLM-разбор; файл → STT → N строк; ✓ → в Sheet, ✗ → нет; > 500 МБ → отказ; фильтры работают; замена реестра работает. |
| **evidence** | Скриншот/видео UI; Google Sheet до и после; tmp пуст через 60 с. |

**acceptance_environment:** [https://ai-pmo-tawny.vercel.app/](https://ai-pmo-tawny.vercel.app/) (production Vercel; секреты на Vercel по `docs/plans/BL2-0_SECRETS_SETUP.md`).

---

### Фаза BL2-1 — Telegram-инжест + напоминания (опциональная)

**phase_id:** BL2-1  
**title:** Telegram-инжест + напоминания  
**status:** `planned`  
**Зависит от:** BL2-0

**goal:** альтернативный канал ввода через Telegram; базовые напоминания.

**scope:**

- Telegram Bot webhook: приём текста, голоса, аудио, видео.
- Pipeline: STT → LLM → drafts → ответ в тред со ссылкой на веб-UI.
- При переходе по ссылке — строки в edit-mode на едином экране.
- Напоминания: cron читает `Target Date` из Sheet → Telegram.
- Антидубли напоминаний.

**out_of_scope:** — (вся ценность Telegram и напоминаний сосредоточена в BL2-1; в BL2-0 этого нет).

**dependencies:** BL2-0 (`verified` или явное исключение пользователя).

**files_or_areas:** `app/` — `POST /api/telegram/webhook`, cron/напоминания, интеграция с edit-mode UI BL2-0.

**Env (дополнительно):** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (см. спека §14 п.4).

**acceptance_criteria:**

- Текст боту → поручение в edit-mode → ✓ → Google Sheet.
- Аудио/видео → STT → N строк в edit-mode.
- Файл > 25 МБ → подсказка веб-загрузки.
- Напоминание за N дней до дедлайна.

**testing_scenario:**

| Поле | Значение |
|------|----------|
| **setup** | Telegram test bot; BL2-0 работает; Google Sheet. |
| **actions** | Текст; voice; видео; файл > 25 МБ; повтор webhook; поручение с Target Date через 1 ч. |
| **expected** | Drafts → edit-mode → ✓ → Sheet; > 25 МБ → подсказка; идемпотентность; напоминание. |
| **evidence** | Telegram-сообщения; Google Sheet; веб-UI с edit-mode строками. |

**acceptance_environment:** [https://ai-pmo-tawny.vercel.app/](https://ai-pmo-tawny.vercel.app/) (production Vercel).

---

## 4. Последовательность и зависимости

```
BL1-0 ✅ (историческая справка, не блокирует v2.2)

BL2-0 (единый экран + Sheets + smart-input + AI-инжест файлов) ← in_progress, ВСЯ ЦЕННОСТЬ MVP
  └─► BL2-1 (Telegram + напоминания) — опциональное расширение
```

По `docs/SUBAGENTS_WORKFLOW.md` в один момент активна **одна** фаза (`Implementer` / `Verifier`). **BL2-0** включает текстовый ввод с LLM и загрузку файлов с STT на одном экране. **Telegram и напоминания — только BL2-1**, не входят в BL2-0.

Отменённые фазы (не планировать): **BL1-1 … BL1-5** (custom Postgres CRUD, YOS CDN, отдельные экраны подтверждения).

---

## 5. Рекомендуемые LLM в Cursor по фазам

| Фаза | Режим Cursor | Модели |
|------|-------------|--------|
| BL1-0 (архив) | — | — |
| BL2-0 Единый экран + Sheets + STT + LLM | Agent / Composer | Sonnet, GPT-4o |
| BL2-1 Telegram + напоминания | Agent + Chat | Sonnet; диагностика webhook/STT — Opus точечно |

---

## 6. Чеклист приёмки пилота (BL2-0)

- [ ] Первый запуск → авто-создание Google Sheet → рабочий экран.
- [ ] Текст в smart-input → LLM → edit-mode → ✓ → строка в Sheet.
- [ ] Минимальный текст («обновить документацию») → Brief Name → ✓.
- [ ] 🎤 диктовка → текст в поле → Enter → строка в таблице.
- [ ] **Убийственный сценарий:** 📎 mp3/mp4 совещания → STT + LLM → N строк edit-mode → ✓/✗ → Sheet.
- [ ] Файл > 500 МБ → отказ до загрузки.
- [ ] Медиафайл удалён после STT (tmp пуст через 60 с).
- [ ] Фильтр ▾ по статусу в заголовке таблицы.
- [ ] «Открыть в Google Sheets ↗» → правка в Sheet → refresh → изменения видны.
- [ ] «Подключить свой реестр» → замена автосозданной таблицы.

**BL2-1 (после BL2-0):**

- [ ] Текст / голос / видео боту → edit-mode в веб-UI → ✓ → Sheet.
- [ ] Файл > 25 МБ в Telegram → подсказка веб-загрузки.
- [ ] Напоминание за N до `Target Date`; без дублей при повторном cron.

---

## 7. Вне скоупа MVP v2.2 (бэклог)

- Напоминания и Telegram-инжест до завершения BL2-0 (см. BL2-1).
- PostgreSQL, Supabase Auth, YOS CDN, signed links (отменено в v2.0).
- Отдельные экраны превью / подтверждения (отменено в v2.2).
- Интеграции Notion, Jira, Trello; мультитаблица; PWA.
- Автоматический мониторинг просроченных поручений.
- Код и фазы BL1-1…BL1-5 (отменены, см. спека §17).

---

## 8. Отменённые фазы v1.3 (справка)

Фазы **BL1-1** (CRUD + authz), **BL1-2** (UI реестра), **BL1-3** (Telegram + STT), **BL1-4** (напоминания + YOS), **BL1-5** (веб-загрузка + пилот) **заменены** фазами **BL2-0** и **BL2-1**. Детали архива — в git history и спека §17.
