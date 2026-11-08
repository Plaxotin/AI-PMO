# BL-48 · Project Impact / Outcome Loop

**Статус:** v1.1-draft — подготовлено 09.11.2026. Первый срез v1.0 принят; следующий срез требует подтверждения владельца до изменения продуктового кода.  
**Основания:** Product Contract v1 (результат ≠ эффект), SPEC-P0 v1.0 §§1, 4, 8, 11.  
**Граница:** один проект. BL-48 не заменяет P0 и не объявляет эффект по факту выполнения поручения без фактических данных.

## 1. Цель

Достроить цепочку:

`сигнал → риск → предложение → решение → поручение → результат → подтверждённый эффект → более обоснованная рекомендация`.

BL-48 отвечает не только «что исполнено», но и «что изменилось в ключевых параметрах проекта» и «какой проверяемый опыт можно использовать в следующих рекомендациях». Ожидаемый эффект формируется при решении, фактический эффект подтверждается только сопоставимыми измерениями и источниками.

## 2. Принятый первый срез v1.0

Реализовано и принято 08.11.2026:

- `outcome_measurements` с baseline/target/actual, source/sourceId/sourceUrl, версиями и RP attribution;
- RP-only `pmo.recordOutcome`, read-only доступ PMO/аудитора/C-level;
- идемпотентный повтор, исправление новой версией и сохранение `superseded`;
- `assessTaskOutcome`, measured L3 и отображение в BL-35;
- изолированная приёмка **11/11**, unit **35/35**, production migration `0009`;
- на P-06 записано **явно synthetic** измерение; оно не является реальным эффектом проекта.

Полный Learning Loop, автоматический сбор KPI и реальные производственные измерения первым срезом не закрыты.

## 3. Инварианты

1. Выполнение Task само по себе не доказывает эффект.
2. Нельзя выдумывать baseline, target, actual, единицы измерения, валюту, источник, период или численное значение эффекта.
3. Каждое измерение имеет проект, Task/Decision, metric, unit, baseline/target/actual, источник, атрибуцию и время наблюдения.
4. `confirmed` означает достоверность и сопоставимость данных, а не успех решения. Достижение цели определяется отдельным `targetStatus`.
5. Недостаточность или несопоставимость данных даёт `unconfirmed`, а не нулевой эффект.
6. Только РП утверждает управленческие предложения и правила сопоставления KPI. PMO/аудитор/C-level — read-only. Права проверяются на сервере.
7. Автоматический сбор выполняется только из разрешённого read-only источника по активной, утверждённой РП привязке метрики. Отдельное ручное подтверждение каждого валидного автоматического наблюдения не требуется.
8. Исправление создаёт новую версию измерения, не переписывает прошлое. Повтор неизменного payload идемпотентен.
9. L3 содержит результат, ожидаемый эффект, фактический эффект и его основание либо честный `unconfirmed`.
10. Рабочие Telegram-чаты остаются read-only. Персональные уведомления — только в RP DM и только по отдельно согласованному сценарию.
11. Synthetic, legacy `unknown`, rejected, superseded и несопоставимые данные не участвуют в Learning Loop.
12. Learning Loop не принимает решения, не меняет права, не обучает модель на production-данных и не выполняет автоматическую оптимизацию весов.

## 4. Термины и разделение статусов

### KPI Observation

Фактическое наблюдение значения из внешнего источника до интерпретации эффекта. Одно наблюдение не обязано быть измерением эффекта: оно может относиться к baseline, target или actual.

### OutcomeMeasurement

Сопоставленные baseline/target/actual одной метрики, связанные с выполненным Task и его Decision. Источником может быть ручной ввод РП или валидированная автоматическая коллекция.

### EffectAssessment

Производное значение, а не отдельная ручная оценка РП:

- `status`: `confirmed` | `unconfirmed`;
- `expectedEffect`: исходный текст Decision;
- `actualEffect`: вычисленный эффект либо причина недостаточности данных;
- `targetStatus`: `met` | `not_met` | `not_set`;
- `basis`: метрика, направление, baseline/target/actual, единицы, периоды, источник, observation IDs и версия;
- `measurementId`, `createdAt`.

### Learning Context

Проверяемый набор подтверждённых EffectAssessment, который разрешено передать генератору рекомендаций. Не является самостоятельным фактом о новом проекте и не доказывает причинно-следственную связь.

## 5. Объектная модель следующего среза

Все изменения схемы — только аддитивные миграции и Drizzle. Существующие записи не перезаписываются и не получают задним числом статус `real`.

### 5.1. OutcomeSource

- `id`, `projectId`, `type`, `name`;
- `connectionRef`: ссылка на защищённую server-side конфигурацию, не секрет и не токен;
- `status`: `active` | `paused` | `error` | `disabled`;
- `readOnly=true` как неизменяемое требование адаптера;
- sanitized `config`: идентификаторы документа/диапазона/объекта без credentials;
- `lastAttemptAt`, `lastSuccessAt`, `lastErrorCode`;
- `createdAt`, `updatedAt`.

Первый конкретный адаптер — read-only реестр проекта. Google Sheets допускается как первый кандидат, но его подключение, реальный документ и mapping требуют отдельного подтверждения владельца. Спецификация не утверждает, что доступ уже есть.

### 5.2. OutcomeMetricBinding

- `id`, `projectId`, `sourceId`, `decisionId`, `taskId`;
- `metric`, `unit`, `direction`: `decrease_is_better` | `increase_is_better`;
- `currencyCode`: обязателен для денежных значений, иначе `null`;
- внешние selector/reference для baseline, target и actual;
- `baselineObservedAt`, `actualObservedAt` либо правила их получения из источника;
- `isPrimary`: только одна primary-метрика Decision для основного L3;
- `status`: `draft` | `active` | `paused` | `superseded`;
- `version`, `approvedByUserId`, `approvedByName`, `approvedAt`;
- `createdAt`, `updatedAt`.

Binding утверждает РП. Изменение selector, metric, unit, direction, currency или связи Task/Decision создаёт новую версию и требует повторного утверждения.

### 5.3. OutcomeObservation

- `id`, `projectId`, `sourceId`, `bindingId`;
- `externalObservationId`, `payloadHash`;
- `role`: `baseline` | `target` | `actual`;
- `value`, `unit`, `currencyCode`, `observedAt`, `collectedAt`;
- `dataClass`: `real` | `synthetic` | `unknown`;
- `validationStatus`: `validated` | `rejected`;
- `validationErrors`: sanitized список кодов без исходного чувствительного payload;
- `sourceRecordUrl` либо честный `unavailable`;
- `createdAt`.

Уникальность неизменного наблюдения — `(sourceId, externalObservationId, role, payloadHash)`. Изменённое содержимое создаёт новое наблюдение; история не затирается.

### 5.4. Расширение OutcomeMeasurement

Добавляются nullable/совместимые поля:

- `origin`: `manual` | `automatic` | `legacy`;
- `bindingId`, `baselineObservationId`, `targetObservationId`, `actualObservationId`;
- `baselineObservedAt`, `actualObservedAt`;
- `direction`, `currencyCode`;
- `dataClass`: `real` | `synthetic` | `unknown`;
- `comparabilityStatus`: `comparable` | `incomparable` | `unknown`.

Существующие строки получают `origin=legacy`, `dataClass=unknown`, `comparabilityStatus=unknown`. Известные synthetic fixtures не превращаются в real и не используются в обучении/recommendation context.

### 5.5. LearningContextUsage

- `id`, `projectId`, `proposalId`, `proposalVersion`;
- `contextHash`, `modelId`;
- список `measurementId + measurementVersion` и EffectAssessment versions;
- `createdAt`.

В audit сохраняются ссылки и ограниченный sanitized context, но не секреты и не полный чувствительный prompt.

## 6. Автоматический сбор фактических KPI

1. Collector запускается только для active Source и active Binding одного проекта.
2. Допускаются read-only вызовы источника. Запись, удаление и изменение внешних данных запрещены.
3. Для каждого Binding действует не более одного активного сбора; overlap не создаёт параллельных задач.
4. Интервал по умолчанию — не чаще одного сбора за 15 минут на Binding. Ручной запуск подчиняется тому же ограничению.
5. Повтор неизменного external observation не создаёт новую Observation, OutcomeMeasurement, L3 или audit event.
6. Изменённое наблюдение создаёт новую версию по правилам коррекции. Нельзя молча заменить historical actual.
7. Сетевой сбой фиксируется как `kpi.collection.failed` с sanitized error code. Допускается безопасный retry read-only вызова с backoff; слепой retry неизвестного результата записи в продукт запрещён.
8. Отсутствие credentials, недоступность источника, неизвестная схема и неподтверждённый mapping останавливают только соответствующий Binding, а не весь scheduler.
9. Secrets передаются только через защищённую server-side конфигурацию. В БД, audit, evidence, frontend и Git сохраняются только connectionRef и sanitized identifiers.
10. Автоматический сбор не создаёт Telegram-сигналы, Risk, Decision или Task.

## 7. Валидация и сопоставимость

Observation отклоняется или Measurement получает `unconfirmed`, если выполняется хотя бы одно условие:

- значение не является конечным числом либо отсутствует;
- metric/unit/currency не совпадают с Binding;
- отсутствует source, externalObservationId или observedAt;
- проект, Task, Decision или их связь не совпадают;
- Task не выполнен или Decision отсутствует;
- `dataClass != real` для production Learning Loop;
- baseline относится к периоду после фактического результата, а его временная корректность не доказана;
- actual предшествует `task.completedAt`;
- значение устарело относительно активного Binding или относится к другому периоду/scope;
- primary Binding не задан, а выбор произвольной «последней метрики» смешал бы разные KPI.

Baseline и actual должны иметь одинаковые metric, unit, currency и scope. Время хранится в UTC; часовой пояс проекта используется только для интерпретации календарных периодов.

`assessTaskOutcome` использует primary Binding Decision. Дополнительные метрики показываются отдельно и не заменяют primary по принципу «самая свежая запись».

## 8. Формулы и достижение цели

Для всех метрик сначала вычисляется направленный эффект:

- `decrease_is_better`: `actualEffectValue = baselineValue − actualValue`;
- `increase_is_better`: `actualEffectValue = actualValue − baselineValue`.

Положительное значение означает улучшение относительно baseline, отрицательное — ухудшение. Единица результата совпадает с единицей метрики; для ratio/percent правило интерпретации должно быть явно задано Binding.

Стандартные начальные mapping:

| Метрика | Направление | Единица |
| --- | --- | --- |
| `schedule_days` | decrease_is_better | days |
| `cost_amount` | decrease_is_better | currency + currencyCode |
| `quality_defects` | decrease_is_better | count |
| `resource_days` | decrease_is_better | days |

При наличии target:

- `decrease_is_better`: `met` при `actualValue <= targetValue`;
- `increase_is_better`: `met` при `actualValue >= targetValue`;
- иначе `not_met`.

Без target — `not_set`; это не отменяет подтверждённый baseline → actual, но запрещает заявлять достижение цели. Текст Decision остаётся человекочитаемым ожидаемым эффектом; автоматическое численное сравнение требует numeric target.

## 9. Learning Loop и обратная связь в рекомендации

1. При формировании нового Proposal система может добавить в AI-контекст только EffectAssessment, удовлетворяющие всем требованиям:
   - `status=confirmed`;
   - `origin=manual|automatic`, `dataClass=real`, `comparabilityStatus=comparable`;
   - текущая, не superseded версия;
   - тот же проект;
   - проверяемый источник и версии observations;
   - понятные metric, direction, unit/currency и период.
2. Приоритет контекста: та же metric → сопоставимый тип риска → наиболее свежие подтверждённые наблюдения. Количество ограничено детерминированным лимитом; нельзя передавать всю БД.
3. Контекст содержит ожидаемый и фактический эффект, targetStatus, источник и ограничение: «историческая ассоциация, не доказательство причинности».
4. Генератор обязан использовать такие данные только как проверяемый прецедент. Он не может:
   - переносить численный эффект на новый Task без основания;
   - заявлять причинность;
   - выдумывать baseline/target/actual;
   - повышать confidence только из-за одного успешного прецедента;
   - автоматически принимать или изменять Decision.
5. Если подходящего контекста нет, генерация продолжается по прежним правилам без утверждения «обучено на проекте».
6. После создания Proposal сохраняется `learning.context.used` со списком версий использованных измерений. Повтор генерации с тем же input/context не создаёт дополнительные usage-записи.
7. Изменение измерения не переписывает уже созданные Proposal. Новая версия учитывается только в последующих рекомендациях.
8. Полноценное улучшение стратегии, scoring и использование причин reject/edit относятся к BL-55 и не имитируются в BL-48.

## 10. Атрибуция и audit

Добавляются события:

- `kpi.source.activated`, `kpi.source.paused`, `kpi.source.failed`;
- `kpi.binding.approved`, `kpi.binding.superseded`;
- `kpi.collection.succeeded`, `kpi.collection.failed`;
- `kpi.observation.rejected`;
- существующие `outcome.recorded`, `outcome.corrected`, `effect.reported`;
- `learning.context.used`.

Автоматическая атрибуция: `Пиэмка · автоматический сбор из <source name>` с actorRole `system`. Утверждение Binding — отдельная RP attribution. Audit не содержит credentials, полный чувствительный payload или реальные chat/user IDs.

Старые `result.recorded` и ранее отправленные L3 не перезаписываются и не отправляются повторно. Новые Telegram-уведомления не являются обязательной частью этого среза.

## 11. Read-only exposure и роли

- РП: утверждает Source/Binding, запускает ручной сбор, исправляет измерения.
- PMO/аудитор/C-level: read-only доступ к источникам, качеству данных, измерениям, assessment и learning attribution.
- System/collector: только чтение внешнего источника и запись технических наблюдений/измерений по active Binding; никаких управленческих решений.
- Anonymous и чужой project: запрет на чтение чувствительной конфигурации и любые действия.
- BL-35 показывает происхождение значения, dataClass, сопоставимость, targetStatus, observation versions и причину `unconfirmed`.

## 12. Критерии приёмки изолированного contract

Все проверки выполняются на отдельной тестовой БД, synthetic Source и mock AI/Telegram:

- [ ] Нет Source/Binding — автоматический сбор не выполняется и эффект остаётся `unconfirmed`.
- [ ] Read-only адаптер не содержит вызовов записи во внешний источник.
- [ ] Валидное real baseline/target/actual создаёт одно подтверждённое измерение с корректной формулой.
- [ ] Четыре стандартные метрики и обе direction-проверки вычисляются корректно.
- [ ] `met`, `not_met`, `not_set` не смешиваются с достоверностью `confirmed`.
- [ ] Несовпадение unit/currency/scope/project/Task ↔ Decision запрещает подтверждение.
- [ ] Actual раньше `task.completedAt` и некорректный baseline не подтверждаются.
- [ ] Synthetic/unknown/rejected/superseded исключены из Learning Context.
- [ ] Повтор observation не дублирует Observation, Measurement, audit, L3 или learning usage.
- [ ] Изменение observation создаёт новую версию и сохраняет исходную.
- [ ] Overlap/restart не создаёт параллельный сбор и дубли.
- [ ] Ошибка источника видна, sanitized и не останавливает остальные Binding/scheduler.
- [ ] Без primary Binding разные метрики не выбираются произвольно для одного L3.
- [ ] PMO/аудитор/C-level/member/anonymous/чужой проект не могут менять Source/Binding/Measurement.
- [ ] Learning Context содержит только допустимые версии и ссылки на источник.
- [ ] AI не получает synthetic/unknown данные и не может заявить причинность по инструкции контракта.
- [ ] `learning.context.used` восстанавливается после restart и не дублируется.
- [ ] Прежние P0/BL-54/BL-41/BL-42/BL-35 regressions, unit, typecheck и build проходят.
- [ ] Production `.env`, webhook/gateway, рабочие чаты и canonical PNG не изменяются.

## 13. Реальная приёмка

Реальная приёмка начинается только после отдельного подтверждения владельцем сценария, источника и mapping.

1. Зафиксировать реальный read-only Source, разрешённый объём данных и защищённый connectionRef без раскрытия секретов.
2. РП утверждает конкретный Binding существующего проекта: metric/unit/direction/currency, selectors, baseline/target/actual, периоды и primary-метрику.
3. Выполнить один сбор без новых Telegram-сигналов, тестовых Risk/Decision/Task и без очистки БД.
4. Сопоставить полученные значения с первоисточником вручную/read-only. Evidence содержит только sanitized references, значения разрешённых KPI, hashes и результаты проверок.
5. Проверить повтор, restart, изменение источника и отсутствие дублей/L3 для старых событий.
6. Проверить ожидаемый и фактический эффект, targetStatus и BL-35 на реальных параметрах.
7. Сформировать recommendation preview с Learning Context без автоматической отправки/принятия. Проверить attribution и отсутствие переноса чужого эффекта или причинности.
8. Отдельно зафиксировать, что production synthetic P-06 не участвует в Learning Context и не выдаётся за реальный эффект.

Если реальный источник или mapping недоступны, реализованный адаптер и isolated contract можно принять отдельно, но автоматический реальный KPI и полный BL-48 остаются незакрытыми.

## 14. Не входит в следующий срез

- Портфельная аналитика и межпроектное обучение.
- Автоматическое принятие решений и автоматическая оптимизация модели/весов.
- Запись во внешние системы.
- Новые каналы, редизайн workspace и новые Telegram-уведомления без отдельного сценария.
- Полный BL-55: scoring рекомендаций, причины reject/edit и стратегическое обучение.
- Persisted outgoing queue, safe retry исходящих сообщений, dead-letter и monitoring — требуют отдельной спецификации.

## 15. Порядок реализации после подтверждения

1. Подтвердить BL-48 и эту спецификацию, реальный источник и первый Binding.
2. Аддитивная миграция и read-only объектная модель.
3. Source/Binding/Collector + isolated contract.
4. EffectAssessment и Learning Context + mock AI contract.
5. BL-35 exposure, regressions и sanitized local evidence.
6. Согласованная реальная приёмка без незапланированных исходящих сообщений.
7. Только после фактически закрытых AC обновить production/Notion статусы; GitHub sync и deployment остаются отдельными действиями.
