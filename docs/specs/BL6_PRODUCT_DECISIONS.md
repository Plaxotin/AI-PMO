# BL-6 — зафиксированные продуктовые решения

**Дата:** 2026-05-24  
**Источник:** ответы Product на открытые вопросы Planner + спека v1.2  
**Применяется к:** `docs/specs/SPEC-BL-6-assignments-admin.md`, `docs/plans/ASSIGNMENTS_ADMIN_CURSOR_PLAN.md`

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

**Решение:** да — трек BL-6 описан только в `docs/specs/SPEC-BL-6-assignments-admin.md` (полный объём v1.2, фазы BL1-3 … BL1-5 обязательны). Аудит плана — отдельно в `docs/specs/SPEC-PLAN-AUDIT.md` (ранее общий файл `MVP_SPEC_AND_PLAN.md`).

---

## 6. Открытые вопросы Planner (закрыты)

См. пункты 1–5 выше. Дополнительно для **старта BL1-1** не требуется отдельное решение по US-C (только BL1-3).

---

## 7. Остаётся открытым (не блокирует BL1-1)

| Вопрос | Когда |
|--------|--------|
| Сопоставление @username ↔ ФИО в одной команде | До **пилота** (спека §12.2) |

---

*Implementer: перед BL1-1 читать этот файл вместе с `docs/plans/BL1-0_KICKOFF.md` и фазой BL1-1 в `docs/plans/ASSIGNMENTS_ADMIN_CURSOR_PLAN.md`.*
