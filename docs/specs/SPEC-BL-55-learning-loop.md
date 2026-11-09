# BL-55 · Learning Loop — самоулучшение генерации поручений и решений по их исходам

**Статус:** v1.0-draft — подготовлено 10.11.2026 после BL-48 и подготовки BL-50.  
**Граница:** один проект. Автономно — только обратимые измеримые изменения. Логика меняется через утверждение человеком.

## 1. Цель

Оценивать качество автогенерации по исходам, а не по факту генерации: принятие, отклонение, правка, исполнение в срок, просрочка, игнорирование и подтверждённый эффект.

Цикл: `события → метрики → кластеры ошибок → предложение улучшения → утверждение человеком → golden regression → версия → возможность отката`.

Автоматического дообучения модели и автономной смены управленческой логики нет.

## 2. Данные

Используются только согласованные источники:

- BL-50: Candidate, rejectionReason, editDistance, merge, reschedule, CommitmentOutcome;
- BL-40: Proposal/Decision/Task/AuditEvent, proposal versions, modelId и attribution;
- BL-41: Accept/Reject/Edit/preview/cancel;
- BL-42: reminders/escalations/delivery outcomes;
- BL-48: confirmed EffectAssessment, real data, targetStatus и версии измерений.

Synthetic/unknown/rejected/superseded BL-48 данные не используются как подтверждённый эффект. Synthetic fixtures допускаются только в явно маркированном golden dataset.

## 3. Метрики качества

По ISO-неделям и типам поручений/рисков:

- `acceptanceRate = accepted / decided`;
- `rejectRate = rejected / decided`;
- `editRate = edited / accepted`;
- `mergeRate = merged / candidates`;
- `onTimeRate = on_time / (on_time + late)`;
- `ignoredRate = ignored / candidates`;
- `confirmedEffectRate = confirmed real measurements / completed Tasks`;
- среднее/median editDistance и доля решений без отката/переработки.

Нулевой знаменатель возвращает `null`, а не 0%. Числа алгоритмов объясняются составом выборки, без ложной точности при малом N.

## 4. Кластеризация ошибок

Детерминированные кластеры:

- не обязательство / ложный риск;
- неверная причина или срочность;
- неверный ответственный;
- уже решено / дубль;
- неверная дата или срок;
- отклонено `not_commitment`, `already_done`, `wont_do`;
- исполнено с просрочкой;
- ожидаемый эффект не подтверждён / не достигнут.

Каждый кластер содержит N, долю, примеры sanitized IDs, версии модели и конкретный классификационный вопрос.

## 5. Предложение улучшения и версия логики

### LogicChangeProposal

- `id`, `projectId`, `cluster`, `question`, `currentVersion`, `proposedVersion`.
- `changeType`: `prompt` | `threshold` | `rule` | `model`.
- `rationale`, `evidenceRefs`, `expectedMetric`, `baselineMetrics`.
- `status`: `proposed`, `approved`, `rejected`, `testing`, `applied`, `rolled_back`.
- RP approval, regression result, createdAt/appliedAt/rolledBackAt.

Применение только через BL-41. До регрессии применение запрещено.

### GoldenRegressionCase

- `id`, `question`, `input`, `expected`, `sourceCorrectionId`, `modelId`, `version`.
- Реальные поправки РП привязываются к конкретному классификационному вопросу и версии модели.

Regression сравнивает baseline/proposed по acceptance/edit/onTime/error clusters. Деградация блокирует применение.

## 6. Дашборд и еженедельный отчёт

- Метрики по неделям, типам и кластерам.
- Доля исправлений по классификационным вопросам и версиям модели.
- Предложения улучшений и их статус/регрессии/откат.
- Малые выборки и отсутствие подтверждённого эффекта отображаются честно.
- PMO/аудитор/C-level read-only; РП утверждает изменения логики.

## 7. Критерии приёмки

- [ ] Каждый авто-артефакт имеет событийный след с версией и причиной.
- [ ] Acceptance/edit/onTime/ignored/confirmedEffect rates корректны при нулевых и малых N.
- [ ] Еженедельные кластеры содержат причины и версии модели.
- [ ] Поправка привязана к конкретному вопросу и образует golden case.
- [ ] Предложение логики требует RP approval.
- [ ] Деградация golden regression блокирует применение.
- [ ] Применение версиируется и откатывается одной командой с audit.
- [ ] Нет автоматического дообучения или смены логики.
- [ ] BL-48/BL-50/BL-41/BL-42 regressions, unit, typecheck и build проходят.

## 8. Не входит

- Автономное обучение весов или fine-tuning.
- Межпроектное обучение и data sharing.
- Автоматическое применение prompt/model/threshold изменений.
- Скрытая оценка людей или персональный скоринг.
