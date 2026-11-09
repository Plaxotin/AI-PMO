# BL-48 · Реальный пилот P-03 — 10.11.2026

**Статус:** сценарий выполнен и проверен. Финальная приёмка полного BL-48 владельцем не заявляется.

## Production

- Release: `/opt/aipmo-platform/releases/bl48-kpi-learning-v11-20261110`.
- Миграция `0010_bl48_kpi_learning_loop` применена аддитивно через Drizzle; журнал увеличился с 10 до 11 записей.
- Сервис `active/running`, `NRestarts=0`, landing/workspace HTTP 200.
- Production `.env`, webhook/gateway и canonical PNG не изменены.
- Backup: `/opt/aipmo-platform/backups/aipmo-bl42-pre-20261109_211243.sql.gz`, 21 таблица, SHA-256 `5957a06644185c4db55058d49ddf4bf088e2200a9db56f5957bce56cb059e848`.
- Contact hotfix и его получатель сохранены.

## Пилотные записи

- Decision `R-06`: направить список тех.долга официальным письмом не позднее 19.08.2026.
- Task `P-07`: завершена 18.08.2026, связана с R-06.
- Source `SRC-BL6-REGISTRY`, `type=google_sheets`, `readOnly=true`.
- Binding `B-BL48-P03`, `externalKey=P-03`, `schedule_days`, `decrease_is_better`, primary.
- Telegram-сообщения, новые Telegram-сигналы и исходящие уведомления не создавались.

## Реальные измерения

Источник: существующая строка Google Sheets BL-6 «Направить список тех.долга официальным письмом».

| Параметр | Значение |
| --- | ---: |
| Baseline | 12 дней |
| Target | 12 дней |
| Actual | 11 дней |
| Направленный эффект | **+1 день** |
| `status` | `confirmed` |
| `targetStatus` | `met` |
| `origin` | `automatic` |
| `dataClass` | `real` |
| `comparabilityStatus` | `comparable` |

Все три Observations имеют `dataClass=real` и `validationStatus=validated`. Spreadsheet ID, credentials и реальные chat/user IDs в evidence не включены.

## Идемпотентность и Learning Loop

- Первый сбор: `collected`, `created=true`, Measurement v1.
- Немедленный повтор: `throttled`, дублей нет.
- Повтор после production restart: `throttled`; Source/Binding idempotent, Measurement v1 сохранена.
- BL-35 показывает Source, Binding, Observations, origin, dataClass, сопоставимость и assessment.
- Learning Context содержит P-07 и источник BL-6, но не содержит legacy synthetic P-06.
- Preview без AI-вызова: `learning.context.used` создан один раз; повторное создание `false`, `usageAuditCount=1`.
- `previewModelId=preview-no-ai-call`: AI-генерация и автоматическое принятие рекомендаций не выполнялись и не заявляются.

Machine evidence: `apps/pmo-platform/verifier/v17/bl48-real-pilot-evidence.json`.

Следующий статус BL-48 определяется отдельной приёмкой владельца. GitHub sync, Notion sync и production deployment уже выполнены как разные действия.
