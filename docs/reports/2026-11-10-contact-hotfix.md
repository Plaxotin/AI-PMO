# Contact-only hotfix — 10.11.2026

## Результат

Форма контакта лендинга и дизайнерские изменения опубликованы отдельным release:

`/opt/aipmo-platform/releases/contact-hotfix-d85f494-20261110`

Контрольная отправка выполнена один раз: **HTTP 200, `outcome=sent`**, в журнале зафиксировано `contact delivered`. Повторная отправка не выполнялась.

## Источник и проверки

- Исходный commit другой сессии: `d85f494574d3e6e26f4fc14ebc468d467e5df119`.
- Contact-only hotfix собран отдельно от принятого P0 baseline, без BL-48 и миграции `0010`.
- Объединённый main: **47/47 unit**, typecheck и production build успешны.
- Contact-only сборка: **41/41 unit**, typecheck и production build успешны.

## Production

- Сервис `active/running`, `NRestarts=0`.
- Landing и workspace: внешние HTTP 200.
- Production `.env` сохранён: SHA-256 `1b93c5c881f1451f6081c48d5ceefad4e62531f90d585082f9a1fac390176715`.
- Workspace сохранён: SHA-256 `6690d803ab444e22717c934a7981ff9b1f1d8ab5f6d01c6f615c3978b469c2e0`.
- Canonical PNG, credentials и controlled gateway сохранены.
- Получатель контакта настроен на личный чат основателя с ботом; реальный ID в evidence не включён.
- Backup: `/opt/aipmo-platform/backups/aipmo-bl42-pre-20261109_210307.sql.gz`, 21 таблица, SHA-256 `7a4d7cb3f2859edc84f4f4b69a020da293b3f755c7e9bf888ff7a14521f8a89d`.

Machine evidence: `apps/pmo-platform/verifier/v17/contact-hotfix-d85f494-evidence.json`.

BL-48, его миграция и пилот этим release не выполнялись.
