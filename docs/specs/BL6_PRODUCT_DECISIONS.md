# BL-6 — зафиксированные продуктовые решения

**Дата:** 2026-05-24  
**Источник:** ответы Product на открытые вопросы Planner + спека v1.2  
**Применяется к:** `docs/specs/SPEC-BL-6-assignments-admin-v2.2.md`, `docs/plans/ASSIGNMENTS_ADMIN_CURSOR_PLAN.md`

---

## 1. Журнал изменений полей (BL1-1)

**Решение:** да — вести аудит изменений ключевых полей.

**Реализация:** расширить таблицу `assignment_status_events` (не отдельная `assignment_field_events`):

- колонка `event_type`: `status_change` | `field_change` | `created` | `cancelled`
- для `field_change`: `field_name` (`title` | `due_at` | `assignee_label`), опционально `old_value` / `new_value` (jsonb или text)

Смена `status` по-прежнему пишется с `event_type = status_change`.

---

## 2. Детекция US-C в Telegram (BL1-3)

**Решение:** определить в плане (Product: «определи сам»).

**Эвристика маршрута в `MediaIngestJob` (совещание) vs одиночное поручение (slot-filling):**

| Условие | Маршрут |
|---------|---------|
| В тексте/caption есть `/meeting` или ключевые слова: `летучка`, `совещание`, `созвон`, `митинг`, `standup`, `meeting` (без учёта регистра) | **US-C** |
| `voice` / `audio` / `video` / `video_note` / `document` (audio/*, video/*) и **длительность ≥ 90 с** (если Telegram отдаёт `duration`) | **US-C** |
| Тот же тип медиа и **размер файла ≥ 3 МБ** | **US-C** |
| Иначе короткое голос/видео/текст | **slot-filling** (одно поручение) |

После US-C бот отвечает в тред: «Черновики готовы — подтвердите в веб-интерфейсе» + ссылка на job (когда есть UI в BL1-5).

---

## 3. Значение `source`: `web_upload`

**Решение:** да — добавить в спеку и enum БД (миграция v2).

`assignment_source`: `manual` | `import` | `webhook` | `web_upload`.

---

## 4. Фильтр `assignee` в API

**Решение:** **точное совпадение** со строкой `assignee_label` (без подстроки, без `q` по исполнителю в BL1-1).

---

## 5. Согласование документации MVP

**Решение:** да — трек BL-6 описан только в `docs/specs/SPEC-BL-6-assignments-admin-v2.2.md` (полный объём v1.2, фазы BL1-3 … BL1-5 обязательны). Аудит плана — отдельно в `docs/specs/SPEC-PLAN-AUDIT.md` (ранее общий файл `MVP_SPEC_AND_PLAN.md`).

---

## 6. Открытые вопросы Planner (закрыты)

См. пункты 1–5 выше. Дополнительно для **старта BL1-1** не требуется отдельное решение по US-C (только BL1-3).

---

## 7. Авторизация Google Sheets API (BL2-0, v2.2)

**Решение (2026-05-29):** **Google OAuth 2.0** — доступ к таблицам от имени пользователя.

**Отклонено:** Service Account — таблицы оказались бы у сервисного аккаунта; для авто-создания реестра в Drive пользователя и «Подключить свой реестр» нужен consent пользователя.

**Scopes (ориентир для BL2-0):** `spreadsheets`, `drive.file` (уточнить при реализации).

**Env (сервер):** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. Access/refresh-токены — в сессии приложения, не в репозитории.

---

## 8. LLM для BL2-0 (slot-filling, v2.2)

**Решение (2026-05-31):** **Moonshot Kimi** через OpenAI-compatible API ([platform.moonshot.ai](https://platform.moonshot.ai/)).

| Параметр | Значение |
|----------|----------|
| `LLM_PROVIDER` | `kimi` |
| `LLM_API_BASE_URL` | `https://api.moonshot.ai/v1` |
| `LLM_MODEL_ID` (MVP BL2-0) | **`moonshot-v1-8k`** — smart-input, одно поручение |
| `LLM_API_KEY` | из [API Keys](https://platform.moonshot.ai/console/api-keys) |

**Длинные транскрипты** (инжест файла совещания): при нехватке контекста 8k — переключить в env или коде на `moonshot-v1-32k` / `moonshot-v1-128k` (доступны тому же ключу; список — `GET /v1/models`).

**Трансграница:** провайдер вне РФ; для prod в РФ — отдельное решение (YandexGPT и др., см. `ADR-BL-18-02-production-decisions.md` §3).

---

## 9. Остаётся открытым (не блокирует BL2-0)

| Вопрос | Когда |
|--------|--------|
| Сопоставление @username ↔ ФИО в одной команде | До **пилота** (спека §12.2) |

---

*Implementer: перед **BL2-0** — §7 (OAuth), §8 (LLM) вместе со спекой v2.2 §4, §13–§14.*
