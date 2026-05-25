# BL-18 — чеклист продуктивного развёртывания

Краткий runbook; решения — `docs/ADR-BL-18-02-production-decisions.md`, тенант — `docs/ADR-BL-18-01-tenant-model.md`.

## 1. Перед деплоем

- [ ] Выбран `DEPLOYMENT_MODE` (`multi_tenant` | `single_tenant`)
- [ ] Postgres и S3 в РФ (или согласование с ДПО задокументировано)
- [ ] `ANTIVIRUS_MODE=required`, ClamAV доступен приложению
- [ ] LLM: ключи, `RU_LLM_ALLOWLIST` или чекбокс трансграницы в UI
- [ ] Auth: не dev-режим без сессии

## 2. Миграции

```bash
psql "$DATABASE_URL" -f supabase/migrations/<bl18_tenants>.sql
psql "$DATABASE_URL" -f supabase/migrations/<bl18_letters>.sql
# при необходимости seed default tenant
psql "$DATABASE_URL" -f supabase/seed_bl18.sql
```

## 3. Переменные (минимум)

См. `app/.env.example` — секция BL-18.

## 4. После деплоя

- [ ] Health: `GET /api/health` (если добавлен) или smoke `POST` template с тестовым DOCX
- [ ] Проверка квоты: upload > лимита → `TENANT_STORAGE_QUOTA_EXCEEDED`
- [ ] Smoke generate: DOCX + ZIP, плейсхолдеры подписанта не заполнены
- [ ] Лог LLM: нет hash/template file в payload (автотест CI)

## 5. Откат

- Отключить маршруты `/api/tenants/*/letters*` feature flag `BL18_ENABLED=false`
- Данные в bucket и таблицах letter_* не удалять до решения DPO
