# BL1-1 — kickoff (CRUD + журнал, MVP без auth)

**Фаза:** BL1-1  
**Дата фиксации:** 2026-05-25  
**Связанные документы:** `docs/specs/SPEC-BL-6-assignments-admin.md`, `docs/specs/BL6_PRODUCT_DECISIONS.md`, `docs/plans/ASSIGNMENTS_ADMIN_CURSOR_PLAN.md`

---

## 1. Границы BL1-1

- Реализуем CRUD по `assignments` в рамках одного глобального `project_id`.
- Реализуем журнал `assignment_status_events` для `created`, `status_change`, `field_change`, `cancelled`.
- Добавляем optimistic locking (`version`, конфликт `409`).
- Авторизация пользователя в MVP **не обязательна**; auth-сессии и ACL — post-MVP.

---

## 2. API-поведение (зафиксировано)

### 2.1 Project boundary

- `projectId = DEFAULT_PROJECT_ID` → обработка запроса по контракту.
- Любой другой UUID `projectId` → `404 PROJECT_MISMATCH`.
- Невалидный UUID → `400 VALIDATION_ERROR`.

### 2.2 Version conflict (`PATCH`)

- Если `version` в запросе не совпадает с текущей записью:
  - статус: `409 CONFLICT`,
  - код ошибки: `VERSION_CONFLICT`,
  - в payload вернуть `current_version` и актуальный объект `assignment`.

### 2.3 `assignee` filter

- В `GET /assignments` фильтр `assignee` работает как **точное совпадение** с `assignee_label` (без `LIKE` и без full-text поиска).

---

## 3. SQL-дельта v2 (минимум для BL1-1)

1. `assignments.version int NOT NULL DEFAULT 1`
2. `assignment_source` расширить значением `web_upload`
3. `assignments.media_ingest_job_id uuid NULL` (FK добавляется в фазе с `media_ingest_jobs`)
4. `assignment_status_events` расширить:
   - `event_type` (`created` | `status_change` | `field_change` | `cancelled`)
   - `field_name` (`title` | `due_at` | `assignee_label`, nullable)
   - `old_value`, `new_value` (jsonb/text, nullable)

---

## 4. Definition of done для BL1-1

- CRUD-интеграционные тесты проходят на живой БД.
- Смена статуса и ключевых полей пишет корректные события в `assignment_status_events`.
- `PATCH` со stale `version` стабильно возвращает `409 VERSION_CONFLICT`.
- В MVP нет обязательной проверки пользовательской сессии.
