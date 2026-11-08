# AI PMO — платформа РП и Пиэмка

Текущий production-контур AI PMO: лендинг, веб-реестр, серверное состояние проекта и Telegram-сценарий «сигнал → риск → предложение → решение → поручение → результат → оценка эффекта».

Компонент добавлен отдельно от исходного Next.js-приложения в `app/`: старые боты, спеки и Vercel-лендинг не заменяются.

## Production

- Лендинг: https://pmo.195.133.14.151.sslip.io/landing.html
- Воркспейс: https://pmo.195.133.14.151.sslip.io/workspace.html
- Telegram webhook: `POST /api/telegram/webhook`

Публикацией управляет владелец продукта. В репозитории нет production-секретов и зашифрованных production-конфигураций.

## Архитектура

- React 19 + TypeScript + Vite — shell для Kimi OAuth.
- `public/landing.html` — текущий лендинг.
- `public/workspace.html` — основной интерфейс реестров и решений.
- Hono + tRPC 11 — backend и API.
- Drizzle ORM + MySQL/TiDB — проектные сущности и аудит.
- `api/routes/telegram.ts` — webhook, решения и подтверждение выполнения РП.
- `api/telegram/completion-scheduler.ts` — единый scheduler tick для completion-check, L3 и SLA.
- `api/telegram/escalation-scheduler.ts` — напоминания и read-only эскалации решений и поручений только в личные чаты.
- `api/queries/completion.ts` и `api/queries/escalation.ts` — durable claims, транзакции результата и BL-40 audit.
- `deploy/telegram-gateway/server.mjs` — контролируемый исходящий шлюз к Telegram Bot API.

Production entry — `dist/boot.js`; порт по умолчанию — `3000`, на текущем VPS — `3001`.

## Локальный запуск

1. Скопируйте `.env.example` в `.env` и заполните значения своего окружения.
2. Установите зависимости и подготовьте базу:

```bash
npm install
npm run db:push
npm run dev
```

Для локальной разработки Telegram дополнительно допустим `.credentials/telegram.env`; этот каталог исключён из git. Не помещайте Telegram-значения в переменные `VITE_*`.

Бинарные эталонные иллюстрации хранятся в `assets/public/*.base64` и автоматически восстанавливаются в `public/` перед `dev` и `build`. Ручное восстановление:

```bash
npm run assets:restore
```

Содержимое PNG не изменяется. Не заменяйте эталонную иллюстрацию без отдельного продуктового решения.

## Проверки

```bash
npm run check
npm run test
npm run build
```

Контрактные и браузерные проверки Telegram находятся в `verifier/v17/`. Перед ними нужны подготовленная тестовая БД и тестовый сервер; см. `verifier/README.md`. Не запускайте очистку тестовых данных в production.

Для production применяются только версионируемые миграции:

```bash
npm run db:migrate
```

## Telegram и роли

- Webhook проверяет `x-telegram-bot-api-secret-token`.
- Обрабатываются только chat IDs из серверного allowlist.
- Рабочие чаты предназначены только для наблюдения: бот не отправляет и не редактирует там сообщения.
- Участники из `TELEGRAM_MEMBER_USER_IDS` могут отправлять сигналы.
- Только РП из `TELEGRAM_RP_USER_IDS` может принять или отклонить предложение и подтвердить выполнение поручения; действия выполняются в личном чате с ботом.
- Дедупликация выполняется по Telegram `updateId` и паре `chatId + messageId`.
- Решение и поручение создаются атомарно; у решения может быть только одно связанное поручение.

### Контроль выполнения и SLA BL-42

- В дату срока, начиная с 09:00 по `PROJECT_TIME_ZONE` (по умолчанию `Europe/Moscow`), scheduler отправляет РП вопрос «Поручение выполнено?» с автором исходного сигнала, ответственным, датой создания, текстом и сроком поручения.
- «Не выполнено» оставляет поручение открытым, фиксирует `task.completion_not_done` и добавляет в вопрос явное подтверждение сохранённого ответа; обе кнопки остаются доступны.
- «Выполнено» закрывает поручение, создаёт один `result.recorded` и запускает L3-уведомление об эффекте. Без фактических параметров проекта L3 обязан сообщать «Эффект пока не подтверждён фактическими данными».
- Pending-решение напоминается РП через 24 часа текущей версии, через 48 часов спонсор получает read-only эскалацию без действий утверждения.
- Просрочка поручения начинается в 00:00 следующего календарного дня по времени проекта. Напоминание получает только ответственный в личку; через 24 часа просрочки спонсор получает read-only эскалацию, а РП — копию.
- Личные получатели настраиваются через `TELEGRAM_RP_USER_IDS`, `TELEGRAM_SPONSOR_USER_IDS` и JSON `TELEGRAM_OWNER_USER_IDS_JSON` с точными именами ответственных. Рабочие групповые чаты не используются для исходящих сообщений.
- Completion-check использует уникальный `(taskId,dueVersion,userId)`. SLA-события из миграции `0003_bl42_sla_notifications.sql` используют устойчивый ключ `(objectType,objectId,objectVersion,step,recipientRole,userId)`. Durable claim предотвращает дубли после overlap/restart; закрытие объекта останавливает новые события.
- Отправка, явная ошибка и неизвестный результат различаются как `sent`, `failed`, `unknown` и попадают в BL-40 audit. Неизвестный результат не повторяется вслепую; отсутствие owner/sponsor/RP mapping является наблюдаемой `delivery.failed`, а не подменой получателя.
- Изолированная приёмка 7 ноября: 25/25 unit, прежние 18/18 contract и 6/6 restart/replay, новые 24/24 SLA checks; `0003` чисто применена к baseline 0000–0002. Evidence: `verifier/v17/sla-contract-summary.json` и файлы `sla-*-evidence.json`.
- Staged release `/opt/aipmo-platform/releases/bl42-sla-20261107` проверен, но не активирован: production содержит pending-решения старше 24 часов и просроченное открытое поручение, которые могут сразу вызвать реальные уведомления. Production `current`, `.env`, журнал миграций и БД не изменялись. Полный Outcome Loop BL-48 этим срезом не закрывается.

### BL-54 — First value за 24 часа

- Актуальная спецификация: `docs/specs/SPEC-BL-54-first-value.md` **v1.1**. Миграция `0005_bl54_first_value.sql` добавляет durable onboarding и digest deliveries; v1.1 новых миграций не потребовала.
- Первый дайджест планируется через час, ежедневный — с 09:00 по `PROJECT_TIME_ZONE`. Формат соответствует простому демо: `☀️ Дайджест проекта · ДД.ММ.ГГГГ`, затем **Факт — что сделано → План — что дальше → Риск — что мешает**.
- Каждый раздел — отдельный нумерованный список с 1. Период, покрытие, ISO datetime, буллеты и технические статусы не выводятся. Подтверждённые пункты вне реестров допускаются без кода.
- Все видимые коды имеют формат `<буква>-<порядковый номер>`: `P-1`, `P-12`, `R-4`. Алиасы последовательны по `createdAt` внутри типа сущности; primary IDs, связи и callback не перезаписываются. Кнопка — `Открыть риск P-N`.
- Дайджест накопительный. `audit_events.metadata.includedItems` сохраняет версии фактически показанных фактов и планов; неизменённые пункты не повторяются в следующих дайджестах. Изменение содержимого создаёт новую версию. Открытые или изменённые риски могут повторяться.
- Доставка только в личку РП; `sent/failed/unknown` и `delivery.failed` фиксируются в BL-40, unknown не повторяется вслепую. Источники остаются кликабельными.
- Изолированно **14/14 BL-54**, полный P0/BL-48 regression зелёный, unit **35/35**, typecheck/build успешны. Production preview **9/9**: 3 факта, 1 план, 6 открытых рисков, 1 508 символов.
- Production `/opt/aipmo-platform/releases/p0-bl54-cumulative-digest-v11-20261108`: сервис active, `NRestarts=0`, landing/workspace HTTP 200 и побайтно сохранены, журнал миграций 10.
- Контрольный реальный дайджест 08.11 в 23:37 мск: **12/12**, одна доставка и один audit с includedItems. После restart повтор не отправлен; факты и планы не повторяются, открытые риски остаются. Владелец визуально принял дайджест в **23:41 мск**; `ownerVisualAccepted=true`, `specP0Accepted=true`.
- Evidence: `verifier/v17/bl54-first-value-evidence.json`, `bl54-v11-preview-evidence.json`, `bl54-v11-acceptance-evidence.json`. **BL-54 и SPEC-P0 приняты**; Notion синхронизируется отдельно после восстановления OAuth.

### BL-41 — Telegram Edit → preview → Accept/cancel

- Миграция `0006_bl41_telegram_edits.sql` добавляет durable pending-edit для RP DM. «Изменить» переводит предложение в режим одной текстовой инструкции; Accept до preview блокируется. AI создаёт новый preview с title/owner/due и diff, не меняя исходный Proposal.
- Accept использует существующую атомарную `decideProposalRecord`: создаёт следующую proposal version, edit distance/diff, `proposal.edited`, решение и не более одного поручения. `expectedVersion` запрещает принятие stale preview после параллельной web-коррекции. Повторный Accept возвращает сохранённое состояние без дублей.
- Cancel возможен до принятия, включая preview: исходная версия, текст и proposal versions не меняются, Task не создаётся. Reject сохраняет решение без Task. Ошибка AI оставляет исходную версию и позволяет явный retry. Начальная и открытая карточки содержат не более трёх действий; все сообщения остаются в RP DM.
- `decideProposalRecord` больше не вызывает `ensureSeed`: при решении создаётся только отсутствующий Project, но не демонстрационные Risk/Decision/Task. Это устраняет появление R-101/R-102 в серверном реестре.
- Изолированная приёмка 7 ноября: **13/13 BL-41**, **14/14 BL-54**, 18/18 contract, 6/6 restart/replay, 8/8 chain, 7/7 correction, 24/24 SLA, 11/11 roles, 19/19 mobile и 28/28 unit; миграции 0003–0006 чисто применены к baseline 0000–0002. Typecheck и build успешны. Evidence: `verifier/v17/bl41-telegram-edit-evidence.json`.
- Это не реальная мобильная приёмка BL-41: RP DM Edit/preview/Accept/cancel и Reject проверены через реальные route handlers с mock AI/Telegram, но не на физическом Telegram-клиенте. Production, БД, `.env`, webhook, Telegram и Notion statuses не изменялись; deployment и commit/push не выполнялись.
- Непубличный release-пакет `_work/aipmo-p0-bl54-bl41-20261107.tar.gz` содержит текущий runtime BL-54/BL-41/BL-42/BL-35, миграции 0003–0006 и исходники controlled-time harness. Проверены 85 файлов, хэши и отсутствие `.env`, credentials, `.git`, логов и backups. Evidence: `verifier/v17/p0-release-package-evidence.json`. На VPS пакет не переносился и не активировался.

### Короткие ID поручений

- Миграция `0007_short_task_ids.sql` добавляет `project_counters`. Создание Task атомарно выделяет `P-01`, `P-02` и далее; существующие длинные ID не переписываются. Повторный Accept возвращает сохранённый Task и не увеличивает счётчик.
- Production counter равен 5, поэтому следующая новая задача получит `P-06`. Полный contract 18/18, BL-41 14/14, unit 35/35. Evidence: `verifier/v17/p0-short-task-ids-evidence.json`.

### Короткие ID решений

- Миграция `0008_short_decision_ids.sql` добавляет counter `decision`. Новые решения получают `R-01`, `R-02`; старые `D-*` сохраняются и принимаются web validation. Переход от риска к предложению выполняется по `riskId`.
- Production decision counter равен 3, следующая decision — `R-04`; task counter 5, следующая задача — `P-06`. Полный contract 18/18, BL-41 14/14, unit 35/35. Evidence: `verifier/v17/p0-short-decision-ids-evidence.json`.

### Первый read-only срез BL-35

- `pmo.state` больше не вызывает `ensureSeed` и не создаёт демонстрационные записи при чтении. API возвращает Signal, confidence, proposal version, результат и единый primary source для Task → Decision → Risk → Signal.
- Существующая композиция workspace сохранена: добавлены переходы Task ↔ Decision ↔ Risk, ссылки на исходное Telegram-сообщение, честное состояние недоступного источника и события BL-40/BL-42 в журнале. После загрузки серверного состояния демонстрационная Google Sheets синхронизация не перезаписывает BL-40 данные.
- Изолированная приёмка 7 ноября: 28/28 unit, 8/8 BL-35 chain checks, прежние 18/18 contract, 6/6 restart/replay и 24/24 SLA; typecheck, workspace JS syntax и build успешны. Evidence: `verifier/v17/bl35-chain-evidence.json`.

### Второй срез BL-35 — версии и исправление pending-предложения

- Экран решений показывает proposal versions, attribution, время, исходную версию и escaped diff. РП может сохранить исправление текста pending-предложения без принятия решения.
- `pmo.correct` доступен только admin/РП. Транзакция блокирует запись, разрешает правку только со статусом `wait`, создаёт следующую proposal version и `record.corrected`; повтор одинакового текста идемпотентен. Accepted/rejected записи и связанные поручения не изменяются: синхронизация исправленного accepted-решения с Task отдельно не специфицирована.
- Полная изолированная приёмка 7 ноября: 28/28 unit, 18/18 contract, 6/6 restart/replay, 8/8 BL-35 chain, 7/7 correction и 24/24 SLA; typecheck, workspace JS syntax и build успешны. Evidence: `verifier/v17/bl35-correction-evidence.json`.
- Это не полный BL-35: стартовый audit-обзор, PMO/аудитор и C-level с серверными негативными проверками, мобильная и полная SPEC-P0 приёмка остаются открытыми. Production этими срезами не изменялся.

### Третий срез BL-35 — проектные роли и стартовый audit-обзор

- Миграция `0004_bl35_project_roles.sql` добавляет `project_memberships` с проектными ролями `member`, `rp`, `pmo`, `auditor`, `c_level` и уникальностью `(projectId,userId)`. Явная membership авторитетнее платформенной роли: platform admin не даёт прав РП участнику с проектной read-only ролью; без membership прежнее поведение admin/РП сохранено.
- `pmo.correct` и `pmo.decide` используют серверную проверку проектной роли РП. PMO, аудитор, C-level и member получают `readOnly=true` и не могут исправлять или утверждать; анонимные вызовы отклоняются. `pmo.state` возвращает фактические `role` и `readOnly`.
- Стартовый экран workspace показывает реальный обзор: свежесть данных (порог 24 часа), доступные/недоступные/отсутствующие источники, последние цепочки Task → Decision → Risk → Signal, конфликты связей и объекты проверки. Для read-only ролей действия РП не показываются как доступные; C-level обозначен как read-only отчёт.
- Полная изолированная приёмка 7 ноября: 28/28 unit, 18/18 contract, 6/6 restart/replay, 8/8 BL-35 chain, 7/7 correction, 24/24 SLA и 11/11 project roles/overview/Telegram-status; миграции `0003` и `0004` чисто применены к baseline 0000–0002. Typecheck, workspace JS syntax/token check и build успешны. Evidence: `verifier/v17/bl35-roles-evidence.json` и остальные contract evidence.
- Telegram `status` и `configure` используют проектный `rpQuery`: проектный РП с platform role `user` допускается, C-level и anonymous отклоняются. Реальные configure/webhook-вызовы в изолированной проверке не выполнялись.

### Четвёртый срез BL-35 — изолированная мобильная приёмка

- Headless Chrome, viewport 390 × 844, локальная production-сборка и отдельная MySQL с synthetic users/fixtures: **19/19** checks, ноль JavaScript exceptions и ноль локальных HTTP errors. Навигация без мутаций; production и Telegram не использовались.
- Проверены РП и C-level: стартовый audit-обзор, переход обзор → поручение, результат, цепочки Task ↔ Decision ↔ Risk → Signal, confidence и доступность источника, решения и RP-действия, read-only C-level, отсутствие demo-предложений и мобильные карточки.
- По результатам приёмки длинные сквозные кнопки переведены на читаемый мобильный layout; `pendRowsHTML()` при `SERVER_READY` больше не подставляет демонстрационные P-06/P-07 и R-101/R-102; добавлен пустой favicon, исключающий автоматический `/favicon.ico` 404.
- Все восемь screenshots просмотрены визуально. Evidence: `verifier/v17/bl35-mobile/bl35-mobile-evidence.json` и восемь PNG в том же каталоге. Финальные общие проверки: 28/28 unit, 18/18 contract, 6/6 restart/replay, 8/8 chain, 7/7 correction, 24/24 SLA, 11/11 roles; typecheck и build успешны.
- Это по-прежнему не полный BL-35/SPEC-P0: реальные два клика в мобильном Telegram и все девять шагов раздела 10 SPEC-P0 остаются открытыми. Production, production БД, Telegram и Notion statuses не изменялись; deployment и commit/push не выполнялись.

Если используется controlled gateway, задайте `TELEGRAM_API_BASE_URL` и `TELEGRAM_GATEWAY_SECRET` только на backend. На самом шлюзе переменная называется `GATEWAY_SECRET`; он слушает `127.0.0.1:3101` и проксирует только allowlisted methods.

### BL-48 — первый срез Outcome Loop

- `docs/specs/SPEC-BL-48-outcome-loop.md` определяет отдельный контур: выполнение не является эффектом без фактических измерений и источника.
- Миграция `0009_bl48_outcome_measurements.sql` добавляет `outcome_measurements` с baseline/target/actual, source/sourceId/sourceUrl, версиями и RP attribution. `pmo.recordOutcome` доступен только проектному РП; PMO/аудитор/C-level read-only.
- `schedule_days` вычисляет `baseline − actual`, остальные метрики показывают фактические значения без выдуманной интерпретации. Повтор одинакового payload идемпотентен, исправление создаёт версию и `outcome.corrected` без перезаписи истории.
- L3 и `effect.reported` используют `assessTaskOutcome`: при валидном измерении возвращают подтверждённый эффект с основанием, иначе прежний честный `unconfirmed`. BL-35 возвращает измерения и assessment по Task.
- Изолированная приёмка **11/11**, unit **35/35**. Production `/opt/aipmo-platform/releases/p0-outcome-20261108`, журнал 10; на P-06 записано явно synthetic измерение, версия 2 даёт −3 дня, повторное L3 не отправляется. Evidence: `verifier/v17/bl48-outcome-evidence.json`, `bl48-p06-evidence.json`, `bl48-release-evidence.json`.

### BL-48 v1.1-draft — автоматический KPI и Learning Loop

- Миграция `0010_bl48_kpi_learning_loop.sql` добавляет read-only `outcome_sources`, версионные RP-approved `outcome_metric_bindings`, durable `outcome_observations` и `learning_context_usages`. Legacy-измерения сохраняются как `legacy/unknown` и не попадают в Learning Context.
- `registry_json` использует только HTTPS GET и server-side `connectionRef`; секреты не сохраняются в config, БД, audit или frontend. Collector ограничен 15-минутным интервалом и lease против overlap/restart.
- EffectAssessment разделяет достоверность `confirmed` и `targetStatus`: `met`, `not_met`, `not_set`. Поддержаны direction-aware формулы schedule/cost/quality/resources, primary-метрика и запрет произвольного выбора между разными KPI.
- Learning Context использует только real, confirmed, comparable и не superseded измерения; `learning.context.used` сохраняет версии и модель. AI получает явный запрет на причинность, перенос чисел без основания и повышение confidence по одному прецеденту.
- `pmo.configureOutcomeSource`, `pmo.approveOutcomeBinding`, `pmo.collectOutcome` доступны только РП. `pmo.state` и workspace показывают источники, наблюдения, origin, dataClass, сопоставимость и learning usage для read-only ролей.
- Изолированный contract **23/23**, дополнительные adapter/currency unit-проверки доводят общий unit-набор до **39/39**. Полный regression: Telegram **18/18**, restart/replay **6/6**, BL-54 **14/14**, SLA **24/24**, прежний BL-48 **11/11**, typecheck/build успешны. Evidence: `verifier/v17/bl48-kpi-learning-evidence.json`.
- Реальный источник и mapping не подключались; production, production БД, Telegram и Notion не изменялись. Production deployment и реальная приёмка требуют отдельного подтверждённого сценария.

## Правила безопасности

- `.env`, `.credentials/`, SSH-пароли, токены и webhook/gateway secrets не коммитить.
- Не выводить секреты в логи, frontend, тестовые fixtures или документацию.
- Существующие значения платформенного `.env` не перезаписывать и не регенерировать.
- `api/lib/` и `api/kimi/` — framework internals; не модифицировать без отдельной необходимости.
- REST routes регистрировать в `api/boot.ts` до `/api/*` catch-all.
- Не использовать raw SQL, `db:push --force` или удаление таблиц для исправления миграций.

Следующие этапы и порядок передачи работы — в `docs/plans/PMO_PLATFORM_NEXT_STEPS.md` корневого репозитория.
