# ADR-BL-18-02 — Решения для продуктивного развёртывания BL-18

**Статус:** принято  
**Дата:** 2026-05-24  
**Назначение:** закрыть открытые вопросы SPEC-BL-18 §12 и пробелы, необходимые для prod без отдельного implementation plan.  
**Связанные документы:** `docs/SPEC-BL-18-official-letter-generator.md` (v1.2), `docs/ADR-BL-18-01-tenant-model.md`.

---

## 1. Инфраструктура и размещение (§2 РФ)

| Компонент | Prod-решение |
|-----------|----------------|
| Приложение (Next.js) | **VPS или managed в РФ** (Selectel, Yandex Cloud Compute, Timeweb Cloud и т.п.) — не единственный вариант, но **primary** для prod с ПДн. |
| PostgreSQL + Auth | **Supabase project в регионе EU** допустим **только для dev**; **prod:** Postgres в РФ (Supabase self-host в РФ, Yandex Managed PostgreSQL, или Selectel) + **Auth.js / Supabase Auth на том же контуре**. |
| Object storage | S3-совместимое **в РФ** (Yandex Object Storage, Selectel S3, MinIO on-prem). Bucket private, presigned URLs для скачивания. |
| LLM | HTTP API из бэкенда в РФ; трансграница **разрешена** при чекбоксе (§6 спеки). |
| CI/CD | Сборка образа/деплой из репо; секреты только в env платформы. |

**Runbook:** в `docs/BL18-PROD-RUNBOOK.md` (чеклист env, миграции, health).

---

## 2. Режим развёртывания и тенант

| Переменная | Значение по умолчанию | Описание |
|------------|----------------------|----------|
| `DEPLOYMENT_MODE` | `multi_tenant` | `single_tenant` — см. ADR-BL-18-01 вариант B (dedicated инстанс). |
| `DEFAULT_TENANT_ID` | UUID из seed | Единственный тенант в single_tenant и default org в multi_tenant. |
| `TENANT_STORAGE_QUOTA_BYTES` | `1073741824` (1 GiB) | Переопределение квоты на стороне развёртывания (§2 спеки). |

Модель тенанта: **ADR-BL-18-01**, рекомендация **A₀** (таблицы tenants + один seed tenant).

---

## 3. LLM (закрытие §12)

| Параметр | Решение |
|----------|---------|
| Провайдер по умолчанию | **OpenAI-compatible API**; первый prod-провайдер: **Moonshot Kimi** (`base URL` + model id из env) **или** **YandexGPT** / **GigaChat** при отказе от трансграницы. |
| Env | `LLM_PROVIDER`, `LLM_API_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_ID`, `LLM_TIMEOUT_MS=60000`, `LLM_MAX_RETRIES=2` |
| Контракт | Строгий **JSON** (Zod) на выходе: `subject?`, `salutation`, `body`, `closing`, `attachments_block` |
| Идемпотентность | Заголовок / поле `X-Request-Id` (UUID); повтор при 5xx — тот же id, не дублировать списание квоты LLM в аудите (флаг `retry_count`) |
| Guard | Отдельный модуль `buildLlmPayload()`: **единственная** точка сборки тела запроса; unit-тест + интеграционный тест: payload **не содержит** подстрок из файла шаблона (hash compare) |
| Логирование | На границе провайдера: логировать **длину** и **hash** payload, не полный текст сути в prod по умолчанию |

**Трансграница:** UI-чекбокс обязателен при `LLM_API_BASE_URL` вне списка `RU_LLM_ALLOWLIST` (env, CSV доменов).

---

## 4. DOCX-сборка (§3.1 п.6)

| Параметр | Решение |
|----------|---------|
| Стек | **Node:** `docxtemplater` + `pizzip` (без Python-сервиса в MVP) |
| Причина | Один runtime с Next.js, проще деплой в РФ |
| Альтернатива | Python `docxtpl` — только если docxtemplater не проходит приёмочные шаблоны заказчика (отдельная фаза) |

---

## 5. Плейсхолдеры шаблона (§3.1, §10)

### 5.1 Обязательные (валидация при upload/update)

| Плейсхолдер | Назначение | Заполнение |
|-------------|------------|------------|
| `{{SIGNATORY_NAME}}` | ФИО подписанта | **Никогда** auto (LLM/бэкенд) |
| `{{SIGNATORY_TITLE}}` | Должность | **Никогда** auto |
| `{{LETTER_BODY}}` | Основной текст | LLM + post-rules |
| `{{LETTER_SUBJECT}}` | Тема (если блок есть в бланке) | LLM, может быть пустым |
| `{{LETTER_SALUTATION}}` | Обращение | LLM |
| `{{LETTER_CLOSING}}` | Заключительная фраза | LLM |
| `{{ATTACHMENTS_LIST}}` | Перечень приложений | Сервер из имён файлов |

Допустимы **алиасы** в одном шаблоне не нужны; админу выдаётся **чеклист** в ошибке `TEMPLATE_VALIDATION_FAILED`.

### 5.2 Версионирование шаблона

- Каждая загрузка нового файла → **новая строка** `letter_template_versions` с `version` monotonic.
- **Активная** версия — одна на `(tenant_id, template_id)`.
- В аудите: `template_id` + `template_version` (integer).

---

## 6. Вложения и LLM (§6)

| Параметр | Значение |
|----------|----------|
| `include_attachment_content_in_llm` default | `false` |
| Лимит символов plaintext на все вложения суммарно | **12_000** (`ATTACHMENT_LLM_CHAR_LIMIT`) |
| Извлечение текста | PDF: `pdf-parse`; DOCX: `mammoth` (text only); XLSX: первый лист, первые **200** строк, CSV-like text |
| Антивирус | **ClamAV** (`clamd`) sidecar; env `CLAMAV_HOST`. Если недоступен в dev — `ANTIVIRUS_MODE=skip` **запрещён в prod** (`required` в prod check) |
| Отказ AV | `422` `MALWARE_DETECTED` или `503` `ANTIVIRUS_UNAVAILABLE` |

---

## 7. ZIP и имена файлов (§12)

| Вопрос | Решение |
|--------|---------|
| Коллизия имён в ZIP | **Суффикс** при сборке: `report.pdf`, `report_2.pdf` (сохранить исходное имя в метаданных аудита `attachment_names`) |
| Дубликаты при upload | **Разрешены** (разные байты); коллизия только в ZIP |
| Имя архива | `letter-package.zip` |
| Внутри архива | `letter.docx` + оригиналы приложений |

---

## 8. Ретенция и TTL (§2.1, §12)

| Тип объекта | TTL / политика |
|-------------|----------------|
| Временные файлы (распаковка, AV scan) | **24 ч**, cron/worker удаляет |
| Сгенерированный DOCX/ZIP для повторного скачивания | **7 суток** (опционально хранить в storage); иначе только stream response без persist |
| Версии шаблонов | До ручного удаления admin; **неактивные** версии старше **365 дней** — job удаления файла (метаданные можно оставить) |
| Аудит `letter_audit_events` | **13 месяцев** минимум (регуляторная ориентировка РФ); без полного текста сути |

Учёт байтов в квоте: все объекты в bucket с префиксом tenant до удаления по TTL.

---

## 9. Валидация русского языка (§3.1 п.4)

- Длина `gist_text`: **30–50_000** символов.
- Эвристика: доля символов **кириллицы** ≥ **0.70** в значимых символах (буквы); иначе `400` `GIST_NOT_RUSSIAN`.
- Цифры, пунктуация, латиница в именах/аббревиатурах не штрафуются отдельно.

---

## 10. REST API (детализация §9)

Базовый префикс: `/api/tenants/:tenantId/...` (tenant из сессии должен совпадать).

| Метод | Путь | Назначение |
|-------|------|------------|
| `POST` | `/letter-templates` | multipart: `file`, `name`, `organization?`, `style_passport?` |
| `GET` | `/letter-templates` | список активных шаблонов тенанта |
| `GET` | `/letter-templates/:id` | метаданные + активная version |
| `POST` | `/letter-templates/:id/versions` | новая версия DOCX |
| `POST` | `/letters/generate` | multipart: `template_id`, `gist_text`, `attachments[]`, `include_attachment_content_in_llm`, `cross_border_consent` |
| `GET` | `/letters/generations/:id/docx` | скачать DOCX (если сохранён или regenerate forbidden) |
| `GET` | `/letters/generations/:id/zip` | скачать ZIP |

Ответ `POST /letters/generate` (sync MVP): JSON `{ generation_id, audit_id, download_docx_url, download_zip_url }` **или** `202` + polling — для файлов >5MB итогов использовать **202** (порог `ASYNC_GENERATE_THRESHOLD_BYTES=5242880`).

Коды ошибок: `FILE_TOO_LARGE`, `TENANT_STORAGE_QUOTA_EXCEEDED`, `TEMPLATE_VALIDATION_FAILED`, `GIST_NOT_RUSSIAN`, `LLM_FAILED`, `MALWARE_DETECTED`, `CROSS_BORDER_CONSENT_REQUIRED`.

---

## 11. UX и юридические тексты (§5–6)

| Элемент | Текст (RU, черновик для UI) |
|---------|------------------------------|
| Стиль | «Официально-деловой стиль, ориентир — российская служебная переписка. Соответствие ГОСТ не гарантируется.» |
| ПДн | «Не включайте лишние персональные данные. Обработка — по [политике конфиденциальности].» |
| Трансграница | «Текст сути и при включении — содержимое вложений передаются провайдеру ИИ ({provider_name}) за пределами РФ для генерации текста. Шаблон бланка не передаётся.» |
| Подписант | «ФИО и должность подписанта заполняются вручную в Word (поля шаблона).» |

Чекбокс `cross_border_consent` обязателен = true при внешнем LLM.

---

## 12. Роли (§2 «админ тенанта»)

| Роль | Права BL-18 |
|------|-------------|
| `tenant_admin` | CRUD шаблонов, просмотр квоты, удаление версий, просмотр аудита тенанта |
| `tenant_member` | Генерация писем, скачивание своих generation (или всех в тенанте — MVP: **все в тенанте**) |

Назначение: `tenant_members.role`; первый admin — seed или `TENANT_BOOTSTRAP_ADMIN_EMAILS`.

---

## 13. Cursor SDK (§7)

**Не используется в prod MVP.** Слот `TextGenerationProvider` в коде; реализация `HttpLlmProvider` только.

---

## 14. Критерии готовности prod (дополнение к §11 спеки)

- [ ] `DEPLOYMENT_MODE` и `DEFAULT_TENANT_ID` заданы; миграции применены.
- [ ] Postgres и object storage в РФ (или задокументированное исключение согласовано с ДПО).
- [ ] `ANTIVIRUS_MODE=required` в prod.
- [ ] Supabase/Auth: сессия обязательна; нет `todo-supabase-not-configured` в prod.
- [ ] Тест guard: template bytes ∉ LLM payload.
- [ ] Runbook и `.env.example` для BL-18 в `app/.env.example`.

---

## 15. Открытые вопросы после ADR

**Нет** — все пункты §12 SPEC-BL-18 перенесены в этот документ и ADR-BL-18-01. Изменения — только через новый ADR и bump версии спеки.
