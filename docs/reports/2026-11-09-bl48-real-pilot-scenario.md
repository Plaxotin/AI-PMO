# BL-48 · Сценарий отдельного реального пилота — 09.11.2026

**Статус:** подготовлено read-only. Перед production deployment, миграцией, созданием Decision/Task, Source/Binding и измерений требуется отдельное подтверждение владельца.

## 1. Выбранные реальные данные

Read-only Source: существующий Google Sheets BL-6, вкладка **«Реестр поручений»**.

Выбрана строка `P-03`:

| Поле | Значение |
| --- | --- |
| Описание | Направить список тех.долга официальным письмом |
| Создано | 07.08.2026 |
| Срок | 19.08.2026 |
| Закрыто | 18.08.2026 |
| Статус | Выполнено |

Доступ к таблице подтверждён через существующий service account со scope `https://www.googleapis.com/auth/spreadsheets.readonly`. Идентификатор таблицы, credentials и персональные данные в сценарий не включаются.

## 2. Пилотные Decision и Task

Следующие свободные production-коды подтверждены read-only:

- Decision `R-06`;
- Task `P-07`.

Предлагаемые записи представляют уже выполненную реальную работу из строки `P-03`, а не synthetic эффект:

- **R-06:** «Направить список тех.долга официальным письмом не позднее 19.08.2026».
- **P-07:** то же поручение, `status=done`, срок `19.08.2026`, фактическое завершение `18.08.2026`, связь `P-07 → R-06`.
- Результат: список тех.долга направлен официальным письмом 18.08.2026.

Прежние `P-06` и synthetic измерения не изменяются и не используются в Learning Context.

## 3. Source и Binding

### OutcomeSource

- `id`: `SRC-BL6-REGISTRY`;
- `type`: `google_sheets`;
- `name`: `BL-6 · Реестр поручений · read-only`;
- `connectionRef`: `BL6_REGISTRY_READONLY`;
- `config.range`: `Реестр поручений!A:Z`;
- `readOnly=true`.

Server-side конфигурация формируется из существующего `/opt/plan-audit-bot/.credentials/bl6_registry.json` без вывода значений:

- `BL6_REGISTRY_READONLY_CREDS_PATH` — существующий `creds_path`;
- `BL6_REGISTRY_READONLY_SPREADSHEET_ID` — существующий `spreadsheet_id`.

Production `.env` не изменяется. Значения передаются только в защищённую конфигурацию release и не попадают в Git, frontend, evidence или Notion.

### OutcomeMetricBinding

| Поле | Значение |
| --- | --- |
| `key` | `B-BL48-P03` |
| `decisionId` | `R-06` |
| `taskId` | `P-07` |
| `externalKey` | `P-03` |
| `metric` | `schedule_days` |
| `unit` | `days` |
| `direction` | `decrease_is_better` |
| `isPrimary` | `true` |
| `status` | `active` после RP approval |

## 4. Ожидаемые наблюдения и эффект

Формулы:

- `baseline = Srok plan − Data sozdaniya = 19.08.2026 − 07.08.2026 = 12 дней`;
- `target = baseline = 12 дней`;
- `actual = Data zakrytiya − Data sozdaniya = 18.08.2026 − 07.08.2026 = 11 дней`;
- `actualEffectValue = baseline − actual = +1 день`;
- `targetStatus = met`, поскольку `actual <= target`.

Ожидаются три real Observations:

| Роль | Значение | `observedAt` |
| --- | ---: | --- |
| baseline | 12 days | 07.08.2026 |
| target | 12 days | 07.08.2026 |
| actual | 11 days | 18.08.2026 |

Ожидаемая OutcomeMeasurement v1:

- `origin=automatic`;
- `dataClass=real`;
- `comparabilityStatus=comparable`;
- `status=confirmed`;
- `targetStatus=met`;
- эффект: сокращение срока на 1 день относительно baseline;
- `actualObservedAt >= task.completedAt`, поскольку P-07 завершён 18.08.2026.

## 5. Обязательные этапы после отдельного подтверждения

### Этап A — release и миграция

1. Повторно подтвердить текущий release, `active/running`, landing/workspace HTTP 200 и сохранить canonical UI/avatar.
2. Создать production backup и проверить gzip, таблицы и SHA-256.
3. Разместить новый release из проверенного GitHub main с `0010_bl48_kpi_learning_loop` и `google_sheets` адаптером.
4. Применить только аддитивную миграцию `0010` через Drizzle. Production `.env`, webhook/gateway и существующие PNG не менять.
5. Выполнить один штатный restart и проверить service, NRestarts, landing/workspace и отсутствие незапланированных исходящих сообщений.

### Этап B — пилотные записи и один сбор

1. Создать R-06/P-07 с указанными выше связями и фактическими датами.
2. RP утверждает Source и Binding.
3. Выполнить один `pmo.collectOutcome` для `B-BL48-P03`.
4. Не создавать новые Telegram-сигналы, риски, уведомления или исходящие сообщения.

### Этап C — проверки

1. Сверить baseline/target/actual и `+1 day`, `met` с первоисточником read-only.
2. Немедленный повтор возвращает `throttled`: новых Observations, Measurement, audit и L3 нет.
3. После restart данные и связи сохраняются, повтор не создаёт дублей.
4. BL-35 показывает real origin, dataClass, сопоставимость, источник и targetStatus.
5. Learning Context допускает P-03, но исключает legacy/synthetic P-06.
6. Recommendation preview содержит проверяемый прецедент без причинности и переноса чисел; `learning.context.used` сохраняет measurement ID/version и модель. Preview не отправлять и не принимать автоматически.
7. Проверить ошибку источника на отдельном synthetic/mock сценарии, а не отключать реальный Source.

## 6. Evidence и ограничения

Сохранить sanitized evidence:

- release/migration/backup hashes;
- Source/Binding без secrets и spreadsheet ID;
- три Observations и одна Measurement;
- `+1 day`, `confirmed`, `met`;
- повтор/restart без дублей;
- BL-35 и Learning Context;
- `realChatOrUserIdsIncluded=false`, `spreadsheetIdIncluded=false`.

Пилотные записи не удалять и не очищать production БД. Полный BL-48 отмечается только после фактически пройденных проверок и отдельной приёмки владельца. GitHub sync, Notion sync и production deployment остаются разными действиями.

## 7. Подтверждение, требуемое перед выполнением

```text
Подтверждаю сценарий BL-48 от 09.11.2026:
P-03 → R-06/P-07, baseline 12, target 12, actual 11, ожидаемый эффект +1 день, targetStatus=met.
Разрешаю backup, аддитивную миграцию 0010, release с google_sheets read-only адаптером,
создание пилотных R-06/P-07, Source/Binding и один сбор KPI.
Telegram-сообщения не отправлять; production .env и canonical UI не менять.
```
