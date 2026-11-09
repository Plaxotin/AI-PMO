# BL-43 · Канал доставки: MAX

**Статус:** v1.0-draft — 10.11.2026. Возможности API сверены с официальной документацией; код, бот и реальное подключение не выполнялись.

**Граница:** один проект и один бот. Сначала личные предложения/напоминания РП; рабочие группы остаются read-only.

## 1. Цель

Добавить MAX как отдельный канал доставки и входящих действий поверх существующего доменного контура, не копируя бизнес-логику Telegram:

`Signal/Proposal/Reminder → канонический OutboundAction → MAX adapter → delivery outcome → audit`,

`MAX Update → verified/deduplicated InboundAction → существующий RP-only handler → Decision/Task/Outcome`.

MAX не является новым источником истины и не меняет правила BL-35/36/40/41/42/48/50/55.

## 2. Подтверждённые возможности официального API

На 10.11.2026 официальная документация MAX подтверждает:

- базовый URL `https://platform-api2.max.ru/`; токен передаётся в `Authorization`, не в query;
- отправку сообщений `POST /messages`, inline keyboard и callback-события `message_callback`;
- события `message_created`, `message_edited`, `message_removed`, `bot_started`, `bot_added`, `bot_removed` и другие Update;
- Webhook через `POST /subscriptions`; для production рекомендуется Webhook, Long Polling не предназначен для production;
- секрет Webhook в заголовке `X-Max-Bot-Api-Secret`, HTTPS и ответ HTTP 200 в течение 30 секунд;
- повторную доставку Webhook до 10 попыток и автоматическую отписку после 8 часов неуспешных ответов;
- загрузку вложений через `POST /uploads`;
- ограничение 30 rps к API и не более двух исходящих сообщений в секунду в один диалог/чат/канал;
- добавление бота в группы по умолчанию запрещено; включение приватности и необходимые права настраиваются отдельно.

Источники приведены в разделе 13. Наличие API не означает наличие реального бота, токена, модерации или доступа у AI PMO.

## 3. Инварианты

1. Telegram и MAX — равноправные adapters над каноническими действиями; ни один не вызывается из AI напрямую.
2. По умолчанию включён только RP DM для предложений и напоминаний. Групповые исходящие запрещены отдельным feature flag.
3. Accept/Reject/Edit/merge/update/LogicChange approval выполняет только РП после проверки project/role/session/action version.
4. Каждый inbound Update и callback дедуплицируется persisted-ключом до побочных эффектов; Webhook retry не создаёт новый Candidate/Decision/Task/audit.
5. Неизвестный результат исходящей отправки не считается failed/delivered и не повторяется вслепую.
6. Повтор callback после restart возвращает прежний результат; устаревшая версия action отклоняется без изменения бизнес-состояния.
7. Токен, Webhook secret, chat/user IDs и payload не попадают в Git, frontend, Notion и sanitized evidence.
8. Отсутствие реального MAX credentials — честный `not_configured`, а не mock success.
9. Подключение MAX не меняет Telegram webhook/gateway, production `.env`, canonical UI или существующие PNG без отдельного решения.

## 4. Каноническая модель адаптера

### ChannelEndpoint

- `id`, `projectId`, `channel`: `max`, `kind`: `rp_dm` | `project_group`.
- `externalRef` — защищённая ссылка на chat/user identity, не публичный ID.
- `status`: `pending`, `active`, `disabled`, `revoked`, `error`.
- `capabilities`: inbound messages, callbacks, outbound messages, attachments.
- `consentVersion`, `createdByRole`, `createdAt`, `disabledAt`.

### InboundAction

- `channel`, `updateType`, `providerUpdateId`, `providerMessageId`, `callbackId`.
- `endpointId`, `actorRef`, `actionType`, `actionPayload`, `actionVersion`.
- `receivedAt`, `evidenceHash`, `processingStatus`, `processingResultRef`.

Первичный dedupe key выбирается по фактически доступному stable provider ID: `channel + botId + providerUpdateId`; при его отсутствии используется documented fallback из immutable event fields и hash, а не только timestamp/text.

### OutboundAction

- `id`, `projectId`, `endpointId`, `kind`, `periodKey`, `payloadVersion`.
- `text`, normalized buttons, `sourceEntityIds`, `dedupeKey`.
- `status`: `pending`, `sent`, `failed`, `unknown`, `cancelled`.
- `providerMessageId`, `attemptCount`, `lastErrorCode`, `createdAt`, `resolvedAt`.

Первый срез использует существующий durable dedupe, но не объявляет полноценную outgoing queue/retry/dead-letter систему: это отдельный reliability contour.

## 5. Webhook и безопасность

1. Endpoint принимает только HTTPS POST и проверяет `X-Max-Bot-Api-Secret` с constant-time comparison.
2. Проверяются Content-Type, размер body, JSON schema Update, bot identity, timestamp/replay policy и allowlisted update types.
3. Секрет задаётся только server-side; значение не возвращается API и не пишется в логи.
4. Первичная запись Update/dedupe выполняется до AI и бизнес-операций. После persisted acknowledgement endpoint отвечает HTTP 200 в пределах 30 секунд; тяжёлая обработка не должна удерживать запрос.
5. До появления отдельного persisted inbound worker нельзя отвечать 200 до фактически завершённой критической записи; иначе событие теряется при restart.
6. При 4xx/5xx/timeout MAX может повторять доставку; повтор безопасен благодаря dedupe. Долгая недоступность может отписать Webhook, поэтому требуются health check и controlled resubscription runbook.
7. Production использует доверенный TLS certificate и требования официальной документации, включая актуальные требования к сертификату Минцифры.
8. Long Polling допускается только для локальной разработки; одновременно с Webhook его не включать.

## 6. Отправка сообщений и кнопки

- Канонический renderer формирует plain text/Markdown только в поддерживаемом MAX subset; user/source text экранируется.
- Callback payload содержит signed/opaque action reference и version, а не секреты, персональные данные или произвольную управленческую команду.
- Кнопки первого среза: Accept, Reject, Edit preview, Done/Not done, Open workspace. Фактический набор зависит от включённых BL-50/BL-55.
- `message_callback` связывается с исходным OutboundAction, RP identity, project и актуальной версией предложения.
- Ответ на callback не выдаётся за бизнес-accept: сначала атомарная доменная операция и audit.
- Rate limiter разделяет глобальный 30 rps и per-chat 2 msg/s, учитывает близкие периоды и не запускает параллельные дубли дайджестов.
- Текст и кнопки при превышении лимитов не обрезаются молча; формируется безопасный preview и ссылка в workspace.
- Вложения не входят в первый срез; `/uploads` остаётся следующим отдельным расширением.

## 7. Жизненный цикл доставки

| Ситуация | Канонический outcome | Действие |
|---|---|---|
| HTTP success + валидный provider response | `sent` | Сохранить providerMessageId и audit |
| Явный отказ API | `failed` | Сохранить sanitized code; не повторять автоматически |
| Timeout/разрыв после отправки | `unknown` | Reconciliation; не повторять вслепую |
| Rate limit до вызова | `pending` | Отложить по limiter, без нового бизнес-объекта |
| Ошибка до сетевого вызова | `failed` | Исправить конфигурацию/payload |
| Повтор того же dedupeKey | прежний outcome | Не отправлять повторно |

Read/delivery receipts не объявляются, пока отдельный provider contract и реальные наблюдения не подтверждены. `sent` означает принятие API, не прочтение РП.

## 8. Группы и приватность

1. Первый production slice — только личный RP endpoint после явного `bot_started`/consent и RP approval.
2. Добавление в группу требует отдельного согласования, настройки приватности бота и минимально необходимых прав; административные права не запрашиваются «на всякий случай».
3. В группе первый срез read-only: входящая фактура обрабатывается по правилам BL-36/BL-50, исходящие предложения отправляются только RP DM.
4. События добавления/удаления бота меняют endpoint status, но не права доменных пользователей автоматически.
5. Удаление бота/отзыв токена блокирует новые отправки и оставляет историю/audit без cleanup.

## 9. Наблюдаемость и восстановление

- Метрики по `sent/failed/unknown`, latency, dedupe hits, callback rejects, webhook age, rate-limit waits и disabled endpoints без external IDs в labels.
- Alarm при отсутствии успешного Webhook, росте `unknown`, повторных 401/403 и автоматической отписке.
- Runbook: disable MAX flag → проверить subscription/secret/TLS → reconciliation → controlled resubscribe → один согласованный test action.
- Никаких массовых повторов накопленных сообщений после восстановления. Каждый неизвестный outcome сначала сверяется с provider/audit.

## 10. Объём первого среза

Входит:

- один MAX bot, один проект, один RP DM;
- production Webhook с secret, schema validation и dedupe;
- outbound proposal/reminder и ограниченный набор RP callbacks;
- RBAC, versioning, restart/replay tests и sanitized audit;
- feature flag `MAX_CHANNEL_ENABLED`, отдельный adapter и rate limiter;
- явный not_configured/disabled режим без влияния на Telegram.

Не входит:

- групповые исходящие и каналы;
- вложения, mini apps, deeplinks и массовые рассылки;
- автоматическая модерация/добавление участников;
- полноценная persisted outgoing queue, safe retry и dead-letter;
- миграция пользователей Telegram → MAX или cross-channel identity matching по телефону;
- автономное принятие решений и применение изменений Learning Loop.

## 11. Изолированная приёмка

- [ ] Валидный Webhook проходит secret/schema checks; неверный/replayed secret отклоняется без side effects.
- [ ] `message_created` и `message_callback` нормализуются в существующие действия без MAX-логики в domain layer.
- [ ] Повтор одного Update до/после restart не создаёт дубли Candidate/Decision/Task/audit.
- [ ] Чужой RP, другой проект и старая action version отклоняются.
- [ ] Success/failed/unknown различаются; `unknown` не запускает слепой retry.
- [ ] Rate limiter соблюдает global/per-chat ограничения на mock clock.
- [ ] Webhook acknowledgement укладывается в provider contract; ошибки не приводят к потере persisted event.
- [ ] Disabled/not_configured MAX не влияет на Telegram и не выдаёт mock за реальную доставку.
- [ ] Групповые исходящие заблокированы; RP DM требует consent/allowlist.
- [ ] Secrets и реальные chat/user IDs отсутствуют в public evidence.
- [ ] Прежние P0/BL-48/BL-50/BL-55 regressions, unit, typecheck и build проходят.

## 12. Реальный пилот и решения владельца

До кода адаптера владелец подтверждает:

1. Создание бота на платформе MAX для партнёров, владельца бота и безопасную передачу token/server secret без публикации в чате/Git.
2. Один проект и один RP личный диалог, consent и допустимое одно контрольное предложение.
3. HTTPS endpoint и соответствие TLS/сертификатным требованиям.
4. Отдельный release, backup и feature flag; Telegram webhook/gateway и production `.env` не перезаписываются.
5. Не включать группы и исходящие вложения в первом пилоте.

Пилот после отдельного разрешения: `GET /me` → установка одной Webhook subscription → `bot_started`/RP binding → одно preview → один физический RP callback → replay/restart → проверка audit и отсутствия дублей → disable flag без cleanup. Неизвестная отправка не повторяется автоматически.

## 13. Официальные источники

- [MAX Bot API — обзор и базовый URL](https://dev.max.ru/docs-api/)
- [Настройка сценариев бота: токен, Webhook, сообщения, чаты и права](https://dev.max.ru/docs/chatbots/bots-coding/prepare/)
- [POST /messages — отправка сообщений и кнопок](https://dev.max.ru/docs-api/methods/POST/messages/)
- [POST /subscriptions — Webhook, secret, retries и таймауты](https://dev.max.ru/docs-api/methods/POST/subscriptions/)
- [POST /uploads — загрузка медиафайлов](https://dev.max.ru/docs-api/methods/POST/uploads/)
- [JavaScript SDK — Update и callback events](https://dev.max.ru/docs/chatbots/bots-coding/js/)
