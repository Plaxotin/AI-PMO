# BL18-R1 — План устранения блокеров сценария тестирования

**Дата:** 2026-06-04  
**Фаза:** `BL18-R1` (миграции, upload шаблона, валидация плейсхолдеров)  
**Связанные документы:**
- [`BL18_REMEDIATION_PLAN.md`](BL18_REMEDIATION_PLAN.md) — фаза R1, критерии и сценарий
- [`BL18-PROD-RUNBOOK.md`](BL18-PROD-RUNBOOK.md) — деплой и env
- PR реализации: [#45](https://github.com/Plaxotin/AI-PMO/pull/45)

**Контекст:** в Cloud Agent E2E не выполнялся из‑за отсутствия PostgreSQL. Unit-тесты и сборка прошли; 4 integration-теста пропущены (`describe.skip` без `DATABASE_URL`).

---

## Цель

Закрыть все шаги сценария R1 со статусом **verified**: T1, T4, T6, AC1, AC4 + integration tests без skip.

---

## Сводка блокеров

| ID шага | Блокер | Кто снимает |
|---------|--------|-------------|
| S3 | Нет PostgreSQL / `DATABASE_URL` | **Вы** (инфра) |
| S3 | Миграции и seed не применены | **Вы** (один раз) |
| T1, AC1 | Нет успешного `POST` upload | **Вы** (curl или UI позже) |
| T4, AC4 | Нет `template_id` после T1 | **Вы** (после T1) |
| T6 | Не вызывали `GET` list | **Вы** (после T1) |
| Auth | `401` при настроенном Supabase без входа | **Вы** (вход или dev-режим) |
| Env | `BL18_ENABLED=false` → `503` | **Вы** (`.env`) |
| Env | Неверный `tenantId` в URL → `404` | **Вы** (UUID из seed) |
| Verifier | Статус фазы `inconclusive` | **Вы** + при необходимости агент |

---

## Фаза B0 — Инфраструктура PostgreSQL (блокер S3)

### Цель

Рабочий `DATABASE_URL`, к которому есть доступ с машины, где запускаете `app/`.

### Ваши действия

1. **Выберите вариант** (один достаточно):
   - **A.** Локальный Postgres (`brew install postgresql@16` / Docker `postgres:16-alpine` / установщик Windows).
   - **B.** Supabase project (для dev допустим облачный регион; для prod — см. ADR, РФ).
   - **C.** Managed Postgres (Yandex Cloud, Selectel и т.п.).

2. **Создайте базу** и пользователя с правами на DDL/DML.

3. **Скопируйте connection string** в `app/.env`:
   ```bash
   DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
   ```

4. **Проверьте подключение:**
   ```bash
   psql "$DATABASE_URL" -c "SELECT 1"
   ```
   Если `psql` нет — установите клиент PostgreSQL или используйте GUI (DBeaver, TablePlus).

### Критерий готовности B0

- `psql "$DATABASE_URL" -c "SELECT 1"` возвращает `1`.
- Файл `app/.env` существует и не коммитится (уже в `.gitignore`).

### Риски

| Риск | Действие |
|------|----------|
| SSL required | Добавьте `?sslmode=require` в URL (Supabase) |
| Firewall | Откройте порт 5432 или используйте VPN/allowlist IP |

---

## Фаза B1 — Миграции и seed (блокер S3, TENANT_NOT_FOUND)

### Цель

Таблицы BL-18 и строка default tenant в БД.

### Ваши действия

1. **Из корня репозитория** `AI-PMO` (не из `app/`):

   ```bash
   export DATABASE_URL=postgresql://...   # тот же, что в app/.env

   psql "$DATABASE_URL" -f supabase/migrations/20260524000000_bl1_v1.sql
   psql "$DATABASE_URL" -f supabase/migrations/20260604000000_bl18_tenants.sql
   psql "$DATABASE_URL" -f supabase/migrations/20260604000001_bl18_letters.sql
   psql "$DATABASE_URL" -f supabase/seed_bl18.sql
   ```

2. **Повторный запуск:** ошибки вида `already exists` для типов/таблиц — нормальны, если миграции уже применялись. Критично отсутствие ошибок на `seed_bl18.sql`.

3. **Проверьте tenant:**
   ```bash
   psql "$DATABASE_URL" -c "SELECT id, name FROM tenants;"
   ```
   Ожидается строка с id `00000000-0000-4000-8000-000000000002` (если не меняли seed).

### Критерий готовности B1

```sql
SELECT COUNT(*) FROM tenants;          -- >= 1
SELECT COUNT(*) FROM letter_templates; -- может быть 0 до upload
```

### Действия агента (опционально)

После вашего B0–B1 можно попросить агента: «прогони `cd app && npm test`» — integration-тесты должны перестать быть `skipped`.

---

## Фаза B2 — Переменные окружения приложения

### Цель

API BL-18 отвечает, а не `503 BL18_DISABLED` / `404 TENANT_MISMATCH`.

### Ваши действия

1. В **`app/.env`** (рядом с `DATABASE_URL`):

   ```bash
   BL18_ENABLED=true
   DEFAULT_TENANT_ID=00000000-0000-4000-8000-000000000002
   # опционально:
   # LETTER_STORAGE_PATH=/абсолютный/путь/.data/letters
   # TENANT_STORAGE_QUOTA_BYTES=1073741824
   ```

2. Убедитесь, что **`DEFAULT_TENANT_ID`** совпадает с id из `seed_bl18.sql` и с UUID в URL curl.

3. **Перезапустите** dev-сервер после правок `.env`:
   ```bash
   cd app && npm run dev
   ```

### Критерий готовности B2

```bash
cd app && npm test
# Ожидание: Test Files ... 4 passed (0 skipped)
# Tests ... 13 passed (0 skipped)
```

---

## Фаза B3 — Аутентификация (блокер 401)

### Цель

`POST`/`GET` letter-templates не возвращают `401 UNAUTHORIZED`.

### Ваши действия — выберите режим

#### Вариант A — Local dev без Supabase (проще для R1)

1. **Не задавайте** `NEXT_PUBLIC_SUPABASE_URL` / ключи **или** оставьте пустыми.
2. Тогда `getAuthResult().mode === 'disabled'` — маршруты BL-18 пропускают запрос (как в BL1-0 для assignments).
3. В ответах будет заголовок `X-Auth-Status: todo-supabase-not-configured`.

**Ваше решение зафиксируйте:** для проверки R1 достаточно варианта A; для prod позже — вариант B.

#### Вариант B — С Supabase (ближе к prod)

1. Заполните `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` по [`BL1-0_ENV.md`](BL1-0_ENV.md).
2. **Войдите** в приложение под пользователем.
3. Для curl передайте cookie сессии или используйте REST с service role только на staging (осторожно с секретами).

### Критерий готовности B3

Любой запрос к API не даёт `401` в выбранном режиме.

---

## Фаза B4 — Сценарий T1 / AC1 (upload валидного шаблона)

### Цель

`201`, тело с `template_id`, `version: 1`, `storage_key`; файл на диске.

### Ваши действия

1. Убедитесь: B0–B3 выполнены, `npm run dev` запущен.

2. **Upload** (из корня репо, где лежит `fixtures/`):

   ```bash
   export DEFAULT_TENANT_ID=00000000-0000-4000-8000-000000000002

   curl -s -w "\nHTTP %{http_code}\n" -X POST \
     "http://localhost:3000/api/tenants/$DEFAULT_TENANT_ID/letter-templates" \
     -F "file=@fixtures/bl18/template-valid.docx" \
     -F "name=Основной бланк" \
     -F "organization=Общий"
   ```

3. **Сохраните** из ответа JSON:
   - `template_id`
   - `storage_key`

4. **Проверьте файл:**
   ```bash
   file app/.data/letters/$DEFAULT_TENANT_ID/letters/templates/*/v1.docx
   # или путь из storage_key относительно LETTER_STORAGE_PATH
   unzip -l <путь-к-v1.docx> | head
   ```

5. **Проверьте БД:**
   ```bash
   psql "$DATABASE_URL" -c "
     SELECT t.name, v.version, o.storage_key, o.byte_size
     FROM letter_templates t
     JOIN letter_template_versions v ON v.id = t.active_version_id
     JOIN letter_storage_objects o ON o.id = v.storage_object_id;
   "
   ```

### Ожидаемый результат

| Поле | Значение |
|------|----------|
| HTTP | `201` |
| `version` | `1` |
| Ошибки | нет `TEMPLATE_VALIDATION_FAILED` |

### Если ошибка

| Код | Ваше действие |
|-----|----------------|
| `422 TEMPLATE_VALIDATION_FAILED` | Откройте `details.checklist`; добавьте недостающие `{{…}}` в DOCX или используйте `fixtures/bl18/template-valid.docx` |
| `422 FILE_TOO_LARGE` | Файл ≤ 10 МБ |
| `422 TENANT_STORAGE_QUOTA_EXCEEDED` | Освободите место или увеличьте `TENANT_STORAGE_QUOTA_BYTES` |
| `503 BL18_DISABLED` | `BL18_ENABLED=true`, перезапуск dev |
| `404 TENANT_NOT_FOUND` | Повторите B1 (seed) |
| `404 TENANT_MISMATCH` | UUID в URL = `DEFAULT_TENANT_ID` |

---

## Фаза B5 — Сценарий T4 / AC4 (вторая версия шаблона)

### Цель

`POST …/versions` → `version: 2`, активная версия в БД = 2.

### Ваши действия

1. Подставьте **`TEMPLATE_ID`** из ответа T1:

   ```bash
   curl -s -w "\nHTTP %{http_code}\n" -X POST \
     "http://localhost:3000/api/tenants/$DEFAULT_TENANT_ID/letter-templates/$TEMPLATE_ID/versions" \
     -F "file=@fixtures/bl18/template-valid.docx"
   ```

2. Проверьте:
   ```bash
   psql "$DATABASE_URL" -c "
     SELECT version FROM letter_template_versions
     WHERE template_id = '$TEMPLATE_ID' ORDER BY version;
   "
   ```
   Ожидание: строки `1` и `2`; у шаблона `active_version` = 2.

---

## Фаза B6 — Сценарий T6 (`GET` список)

### Цель

`200`, массив `data` с загруженным шаблоном.

### Ваши действия

```bash
curl -s "http://localhost:3000/api/tenants/$DEFAULT_TENANT_ID/letter-templates" | jq .
```

Ожидание: в `data[]` есть элемент с `name: "Основной бланк"` (или как назвали в T1), `active_version` ≥ 1.

Дополнительно — деталь:

```bash
curl -s "http://localhost:3000/api/tenants/$DEFAULT_TENANT_ID/letter-templates/$TEMPLATE_ID" | jq .
```

---

## Фаза B7 — Негативные проверки (T2, T3) — подтверждение E2E

Уже покрыты unit-тестами; **ваши действия** (по желанию, для полного журнала):

### T2 — invalid template

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST \
  "http://localhost:3000/api/tenants/$DEFAULT_TENANT_ID/letter-templates" \
  -F "file=@fixtures/bl18/template-invalid.docx" \
  -F "name=Без плейсхолдеров"
```

Ожидание: `422`, `error.code` = `TEMPLATE_VALIDATION_FAILED`, в `details.missing` есть `LETTER_BODY`.

### T3 — файл > 10 МБ

Создайте большой файл (на вашей машине):

```bash
dd if=/dev/zero of=/tmp/huge.docx bs=1M count=11
curl -s -w "\nHTTP %{http_code}\n" -X POST \
  "http://localhost:3000/api/tenants/$DEFAULT_TENANT_ID/letter-templates" \
  -F "file=@/tmp/huge.docx" \
  -F "name=huge"
```

Ожидание: `422`, `FILE_TOO_LARGE`.

---

## Фаза B8 — Закрытие фазы R1 (Verifier)

### Ваши действия

1. Выполните чеклист:

   | Шаг | Статус (отметьте) |
   |-----|-------------------|
   | B0 Postgres | ☐ |
   | B1 Миграции + seed | ☐ |
   | B2 `.env` + `npm test` 13/13 | ☐ |
   | B3 Auth (A или B) | ☐ |
   | B4 T1 / AC1 | ☐ |
   | B5 T4 / AC4 | ☐ |
   | B6 T6 | ☐ |
   | B7 T2/T3 (опционально curl) | ☐ |

2. **Сохраните артефакты** (для себя или PR):
   - вывод `npm test`;
   - JSON ответ T1;
   - вывод `psql` с версиями;
   - при необходимости скрин DBeaver / лог dev-сервера.

3. **Сообщите агенту** (если нужно обновить репозиторий):
   > «R1 verified: приложи логи» — агент может обновить статус фазы в `BL18_REMEDIATION_PLAN.md` на `verified` и PR #45.

4. **Разрешите следующую фазу**, когда готовы:
   > «Разрешите начать фазу BL18-R2: docxtemplater merge»

### Критерий `verified` для BL18-R1

- Все пункты B4–B6 пройдены на вашей машине.
- `cd app && npm test` — 0 skipped integration tests.

---

## Порядок и зависимости

```mermaid
flowchart TD
  B0[B0: Postgres + DATABASE_URL]
  B1[B1: Миграции + seed]
  B2[B2: BL18_ENABLED + npm test]
  B3[B3: Auth режим]
  B4[B4: T1 POST valid]
  B5[B5: T4 POST version]
  B6[B6: T6 GET list]
  B8[B8: verified]

  B0 --> B1 --> B2
  B2 --> B3
  B3 --> B4 --> B5 --> B6 --> B8
  B2 --> B7[B7: T2/T3 опционально]
```

**Оценка вашего времени:** B0–B3 — одноразовая настройка (15–60 мин в зависимости от опыта с Postgres); B4–B6 — около 10 минут при готовой инфраструктуре.

---

## Что делает агент / CI (не ваши обязательные шаги)

| Задача | Когда |
|--------|--------|
| Unit-тесты в PR | Уже в [#45](https://github.com/Plaxotin/AI-PMO/pull/45) |
| Обновление статуса R1 в remediation plan | После вашего подтверждения B8 |
| Реализация BL18-R2 | После вашего разрешения на фазу R2 |
| GitHub Actions с Postgres service | Можно добавить отдельной задачей, чтобы integration не skip в CI |

---

## Open questions (для вас)

1. **Где будет dev Postgres** — локально или Supabase? (влияет только на B0 и B3-B.)
2. **Нужен ли CI с Postgres** в репозитории, чтобы блокер S3 не повторялся в Cloud Agent? (да/нет — сообщите агенту.)
3. **Корпоративный бланк** для финальной приёмки — замените `fixtures/bl18/template-valid.docx` своим файлом с теми же плейсхолдерами ADR §5.1.

---

*Документ создан по результатам прогона BL18-R1 в Cloud Agent (2026-06-04).*
