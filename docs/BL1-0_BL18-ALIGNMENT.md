# Согласование BL1-0 и BL-18

**Дата:** 2026-05-24  
**ADR:** `docs/ADR-BL-18-01-tenant-model.md` (рекомендация **A₀**).

---

## Конфликт

| BL1-0 kickoff | BL-18 spec |
|---------------|------------|
| Один глобальный `project`, без мультитенанта | `tenant_id`, квота 1 ГБ **на тенант**, аудит по тенанту |

## Решение (A₀)

1. **BL-18 вводит** `tenants` и `tenant_members` в своей миграции; не ждёт «мультитенант BL-1».
2. **Seed:** один тенант `Default Organization` (`DEFAULT_TENANT_ID` в env = id из seed).
3. **BL-1:** в миграции **BL1-1** (или совместной) добавить `projects.tenant_id` NOT NULL, backfill = `DEFAULT_TENANT_ID`. До этого BL-18 может использовать только `tenant_id`; `project_id` в письмах — **nullable**.
4. **`DEFAULT_PROJECT_ID`** остаётся для API поручений; логическая связь: `project.tenant_id = DEFAULT_TENANT_ID` после backfill.
5. Kickoff BL1-0 п.2 читается как: *нет UI нескольких организаций в реестре поручений на старте*, а не «запрет tenant в платформе».

## Порядок миграций (prod)

1. `supabase/migrations/..._bl18_tenants.sql`
2. `supabase/migrations/..._bl18_letters.sql` (templates, storage metadata, audit)
3. (позже BL1-1) `..._projects_add_tenant_id.sql`

## Auth

BL-18 **требует** рабочую сессию в prod. Режим `X-Auth-Status: todo-supabase-not-configured` — только **local dev**.
