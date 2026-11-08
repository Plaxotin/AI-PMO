import { and, asc, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { auditEvents, decisions, learningContextUsages, outcomeMeasurements, outcomeMetricBindings, outcomeObservations, outcomeSources, projectCounters, projects, proposalVersions, risks, signals, tasks, type User } from "@db/schema";
import { assessTaskOutcome } from "./outcome";
import { getDb } from "./connection";
import { buildProposalDiff, telegramSourceLink, type ProposalSnapshot } from "./proposal-audit";
import { buildProjectChain } from "./project-chain";
import { resolveProjectRole } from "./project-access";
import { buildAuditOverview } from "./audit-overview";

export const DEMO_PROJECT_ID = "PRJ-01";

const seedRisks = [
  { id: "R-101", title: "Отпуск ключевого разработчика в спринте 2", recordType: "manual", channel: null, impact: "остановка задач интеграции", probability: "средняя", measure: "дублирование знаний, план передачи до 25.09", source: "введено вручную · Давыдова Е. · 15.09" },
  { id: "R-102", title: "Задержка поставки лицензий 1С от вендора", recordType: "manual", channel: null, impact: "невозможность тестирования интеграции", probability: "активный", measure: "эскалация вендору · запрос подтверждения срока · резервный контур", source: "введено вручную · Плахотин К. · 14.09 · наступил 22.09" },
  { id: "R-106", title: "Конфликт требований: ТЗ v0.2 и бланк отчётности спонсора расходятся по составу KPI", recordType: "auto", channel: "tg", impact: "расхождение критериев приёмки со спонсором", probability: "активный", measure: "согласовать состав KPI со спонсором · поручение Плахотину К. до 19.09", source: "TG-надзор · чат команды · 19.09" },
  { id: "R-107", title: "Доступ к тестовому стенду не согласован 7 дней", recordType: "auto", channel: "reg", impact: "блокирует 3 задачи тестирования", probability: "активный", measure: "согласование доступов · эскалация просрочки поручения P-02", source: "реестр поручений · просрочка P-02 · 12.09" },
];

const seedDecisions = [
  { id: "D-01", riskId: "R-103", title: "Добавить связь «Интеграция 1С → НТ-2» и контрольную точку 30.09", rationale: "Автоанализ плана нашёл задачу «Интеграция 1С» без связи с работами тестирования (НТ-2). При сдвиге этой задачи на 1 неделю этап «Приёмка» сдвинется на 12 дней. Связь и контрольная точка сокращают срыв с 12 до 3 дней.", effect: "−9 дней к сроку «Приёмки»", status: "wait" as const, displayDate: "18.09", proposalOwner: "Бессонов К.", proposalDue: "30.09" },
  { id: "D-02", riskId: "R-102", title: "Перенести интервью с пользователями на неделю раньше, до заморозки ТЗ", rationale: "ТЗ v0.2 согласуется 20.09, а 2 из 5 интервью запланированы после этой даты. Требования без интервью — риск доработок на приёмке. Досрочное проведение закрывает требования до заморозки.", effect: "−1 итерация доработок на приёмке", status: "wait" as const, displayDate: "18.09", proposalOwner: "Давыдова Е.", proposalDue: "22.09" },
  { id: "D-03", riskId: null, title: "Снять с Плахотина К. согласование доступа к стенду — передать Давыдовой Е.", rationale: "Поручение «Согласовать доступ к тестовому стенду» просрочено уже 7 дней: у Плахотина К. 9 поручений в работе против 3 у Давыдовой Е. Ребалансировка снимает bottleneck.", effect: "разблокирует 3 задачи тестирования", status: "no" as const, displayDate: "17.09", proposalOwner: "Давыдова Е.", proposalDue: null },
];

const seedTasks = [
  { id: "P-01", decisionId: null, riskId: null, title: "Выгрузка справочников из 1С:УПП для интеграции", owner: "Бессонов К.", due: "10.09", status: "over", source: null },
  { id: "P-02", decisionId: null, riskId: null, title: "Согласовать доступ к тестовому стенду", owner: "Давыдова Е.", due: "12.09", status: "over", source: null },
  { id: "P-03", decisionId: null, riskId: null, title: "План коммуникаций v0.1 — на ревью РП", owner: "Плахотин К.", due: "15.09", status: "week", source: null },
  { id: "P-04", decisionId: null, riskId: null, title: "Интервью с ключевыми пользователями (3 из 5)", owner: "Давыдова Е.", due: "18.09", status: "ok", source: null },
  { id: "P-05", decisionId: null, riskId: null, title: "Подтвердить состав приёмочной комиссии", owner: "Плахотин К.", due: "—", status: "none", source: null },
];

export async function ensureSeed() {
  const db = getDb();
  await db.insert(projects).values({ id: DEMO_PROJECT_ID, name: "АСУП · внедрение" }).onDuplicateKeyUpdate({ set: { id: sql`id` } });
  await db.insert(risks).values(seedRisks.map((x) => ({ ...x, projectId: DEMO_PROJECT_ID }))).onDuplicateKeyUpdate({ set: { id: sql`id` } });
  await db.insert(decisions).values(seedDecisions.map((x) => ({ ...x, projectId: DEMO_PROJECT_ID }))).onDuplicateKeyUpdate({ set: { id: sql`id` } });
  await db.insert(proposalVersions).values(seedDecisions.map((x) => ({
    projectId: DEMO_PROJECT_ID,
    proposalId: x.id,
    version: 1,
    title: x.title,
    rationale: x.rationale,
    effect: x.effect,
    owner: x.proposalOwner || "Руководитель проекта",
    due: x.proposalDue || "—",
    actorName: "Пиэмка",
    actorRole: "system",
    attribution: "Пиэмка · автоматически",
  }))).onDuplicateKeyUpdate({ set: { id: sql`id` } });
  await db.insert(tasks).values(seedTasks.map((x) => ({ ...x, projectId: DEMO_PROJECT_ID }))).onDuplicateKeyUpdate({ set: { id: sql`id` } });
  await db.insert(auditEvents).values([
    { id: 1, projectId: DEMO_PROJECT_ID, entityType: "risk", entityId: "R-103", eventType: "risk.recorded", relatedId: null, actorName: "Пиэмка", actorRole: "system", attribution: "Пиэмка · автоматически", detail: "Риск зафиксирован из сигнала: bus factor 1 на интеграции" },
    { id: 2, projectId: DEMO_PROJECT_ID, entityType: "proposal", entityId: "D-01", eventType: "proposal.created", relatedId: "R-103", actorName: "Пиэмка", actorRole: "system", attribution: "Пиэмка · автоматически", detail: "Создано управленческое предложение D-01" },
    { id: 3, projectId: DEMO_PROJECT_ID, entityType: "risk", entityId: "R-102", eventType: "risk.recorded", relatedId: null, actorName: "Пиэмка", actorRole: "system", attribution: "Пиэмка · автоматически", detail: "Активный риск задержки лицензий сохранён в реестре рисков" },
    { id: 4, projectId: DEMO_PROJECT_ID, entityType: "proposal", entityId: "D-02", eventType: "proposal.created", relatedId: "R-102", actorName: "Пиэмка", actorRole: "system", attribution: "Пиэмка · автоматически", detail: "Создано управленческое предложение D-02" },
  ]).onDuplicateKeyUpdate({ set: { id: sql`id` } });
}

export async function getProjectState(user: User) {
  const db = getDb();
  const [role, riskRows, decisionRows, versionRows, taskRows, signalRows, eventRows, outcomeRows, sourceRows, bindingRows, observationRows, learningRows] = await Promise.all([
    resolveProjectRole(user),
    db.select().from(risks).where(eq(risks.projectId, DEMO_PROJECT_ID)).orderBy(asc(risks.id)),
    db.select().from(decisions).where(eq(decisions.projectId, DEMO_PROJECT_ID)).orderBy(asc(decisions.id)),
    db.select().from(proposalVersions).where(eq(proposalVersions.projectId, DEMO_PROJECT_ID)).orderBy(desc(proposalVersions.proposalId), desc(proposalVersions.version)).limit(100),
    db.select().from(tasks).where(eq(tasks.projectId, DEMO_PROJECT_ID)).orderBy(desc(tasks.createdAt), desc(tasks.id)),
    db.select().from(signals).where(eq(signals.projectId, DEMO_PROJECT_ID)).orderBy(desc(signals.createdAt), desc(signals.id)).limit(100),
    db.select().from(auditEvents).where(eq(auditEvents.projectId, DEMO_PROJECT_ID)).orderBy(desc(auditEvents.id)).limit(40),
    db.select().from(outcomeMeasurements).where(eq(outcomeMeasurements.projectId, DEMO_PROJECT_ID)).orderBy(desc(outcomeMeasurements.createdAt), desc(outcomeMeasurements.id)).limit(100),
    db.select().from(outcomeSources).where(eq(outcomeSources.projectId, DEMO_PROJECT_ID)).orderBy(asc(outcomeSources.id)),
    db.select().from(outcomeMetricBindings).where(eq(outcomeMetricBindings.projectId, DEMO_PROJECT_ID)).orderBy(desc(outcomeMetricBindings.createdAt), desc(outcomeMetricBindings.id)).limit(100),
    db.select().from(outcomeObservations).where(eq(outcomeObservations.projectId, DEMO_PROJECT_ID)).orderBy(desc(outcomeObservations.createdAt), desc(outcomeObservations.id)).limit(100),
    db.select().from(learningContextUsages).where(eq(learningContextUsages.projectId, DEMO_PROJECT_ID)).orderBy(desc(learningContextUsages.createdAt), desc(learningContextUsages.id)).limit(100),
  ]);
  const outcomeAssessments = new Map(await Promise.all(taskRows.map(async (task) => [task.id, await assessTaskOutcome(task.id)] as const)));
  const chain = buildProjectChain(signalRows, riskRows, decisionRows, taskRows);
  const overview = buildAuditOverview(
    { signals: signalRows, risks: riskRows, decisions: decisionRows, tasks: taskRows, events: eventRows },
    chain,
  );
  return {
    projectId: DEMO_PROJECT_ID,
    server: true,
    role,
    readOnly: role !== "rp",
    user: { id: user.id, name: user.name || "Пользователь", platformRole: user.role },
    overview,
    signals: chain.signals,
    risks: riskRows.map((x) => ({ id: x.id, t: x.title, type: x.recordType, ch: x.channel || undefined, impact: x.impact, prob: x.probability, confidence: x.confidence ?? undefined, measure: x.measure, src: x.source, signalId: chain.riskSources.get(x.id)?.signalId, sourceLink: chain.riskSources.get(x.id)?.sourceLink })),
    decisions: decisionRows.map((x) => ({ id: x.id, t: x.title, why: x.rationale, effect: x.effect, st: x.status, date: x.displayDate, risk: x.riskId || "—", attribution: x.attribution || undefined, proposalVersion: x.proposalVersion, signalId: chain.decisionSources.get(x.id)?.signalId, sourceLink: chain.decisionSources.get(x.id)?.sourceLink })),
    proposalVersions: versionRows.map((x) => ({ id: x.id, proposalId: x.proposalId, version: x.version, title: x.title, rationale: x.rationale, effect: x.effect, owner: x.owner, due: x.due, sourceVersionId: x.sourceVersionId, actorName: x.actorName, actorRole: x.actorRole, attribution: x.attribution, editDistance: x.editDistance, diff: x.diff, createdAt: x.createdAt })),
    tasks: taskRows.map((x) => ({ id: x.id, t: x.title, who: x.owner, due: x.due, st: x.status, decisionId: x.decisionId || undefined, riskId: x.riskId || undefined, src: x.source || undefined, result: x.result || undefined, completedByName: x.completedByName || undefined, completedAt: x.completedAt || undefined, signalId: chain.taskSources.get(x.id)?.signalId, sourceLink: chain.taskSources.get(x.id)?.sourceLink, effectAssessment: outcomeAssessments.get(x.id) || undefined })),
    outcomeMeasurements: outcomeRows.map((x) => ({ id: x.id, taskId: x.taskId, decisionId: x.decisionId, metric: x.metric, unit: x.unit, baselineValue: x.baselineValue, targetValue: x.targetValue, actualValue: x.actualValue, source: x.source, sourceId: x.sourceId, sourceUrl: x.sourceUrl, status: x.status, version: x.version, previousVersionId: x.previousVersionId, recordedByName: x.recordedByName, recordedByRole: x.recordedByRole, origin: x.origin, bindingId: x.bindingId, baselineObservationId: x.baselineObservationId, targetObservationId: x.targetObservationId, actualObservationId: x.actualObservationId, baselineObservedAt: x.baselineObservedAt, actualObservedAt: x.actualObservedAt, direction: x.direction, currencyCode: x.currencyCode, dataClass: x.dataClass, comparabilityStatus: x.comparabilityStatus, createdAt: x.createdAt })),
    outcomeSources: sourceRows.map((x) => ({ id: x.id, type: x.type, name: x.name, connectionRef: x.connectionRef, readOnly: x.readOnly, config: x.config, status: x.status, lastAttemptAt: x.lastAttemptAt, lastSuccessAt: x.lastSuccessAt, lastErrorCode: x.lastErrorCode })),
    outcomeBindings: bindingRows.map((x) => ({ id: x.id, key: x.key, sourceId: x.sourceId, decisionId: x.decisionId, taskId: x.taskId, metric: x.metric, unit: x.unit, direction: x.direction, currencyCode: x.currencyCode, externalKey: x.externalKey, selectorConfig: x.selectorConfig, isPrimary: x.isPrimary, status: x.status, version: x.version, approvedByName: x.approvedByName, approvedAt: x.approvedAt, collectingAt: x.collectingAt, lastAttemptAt: x.lastAttemptAt })),
    outcomeObservations: observationRows.map((x) => ({ id: x.id, sourceId: x.sourceId, bindingId: x.bindingId, externalObservationId: x.externalObservationId, payloadHash: x.payloadHash, role: x.role, value: x.value, unit: x.unit, currencyCode: x.currencyCode, observedAt: x.observedAt, collectedAt: x.collectedAt, dataClass: x.dataClass, validationStatus: x.validationStatus, validationErrors: x.validationErrors, sourceRecordUrl: x.sourceRecordUrl })),
    learningContextUsages: learningRows.map((x) => ({ id: x.id, proposalId: x.proposalId, proposalVersion: x.proposalVersion, contextHash: x.contextHash, modelId: x.modelId, measurementRefs: x.measurementRefs, createdAt: x.createdAt })),
    events: eventRows.map((x) => ({ id: x.id, entityType: x.entityType, entityId: x.entityId, eventType: x.eventType, relatedId: x.relatedId, actorName: x.actorName, actorRole: x.actorRole, attribution: x.attribution, channel: x.channel, version: x.version, sourceLinks: x.sourceLinks, diff: x.diff, metadata: x.metadata, detail: x.detail, createdAt: x.createdAt })),
  };
}

export type ManagementActor = { userId?: number; name: string; channel?: "telegram" | "web" };

export async function decideProposalRecord(
  input: { decisionId: string; action: "ok" | "no"; title?: string; owner?: string; due?: string; expectedVersion?: number },
  actor: ManagementActor,
) {
  await getDb().insert(projects).values({ id: DEMO_PROJECT_ID, name: "АСУП · внедрение" })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  const attribution = `Пиэмка от имени ${actor.name}`;
  const channel = actor.channel || "web";

  return getDb().transaction(async (tx) => {
    const [decision] = await tx.select().from(decisions)
      .where(and(eq(decisions.projectId, DEMO_PROJECT_ID), eq(decisions.id, input.decisionId)))
      .for("update");
    if (!decision) throw new TRPCError({ code: "NOT_FOUND", message: "Решение не найдено" });

    if (decision.status !== "wait") {
      const [existingTask] = await tx.select().from(tasks).where(eq(tasks.decisionId, decision.id)).limit(1);
      return {
        decisionId: decision.id,
        taskId: decision.status === "ok" ? existingTask?.id : undefined,
        status: decision.status,
        alreadyDecided: true,
      };
    }
    if (input.expectedVersion !== undefined && decision.proposalVersion !== input.expectedVersion) {
      throw new TRPCError({ code: "CONFLICT", message: "Предложение изменилось после формирования предпросмотра" });
    }

    const [signal] = decision.riskId
      ? await tx.select().from(signals).where(eq(signals.riskId, decision.riskId)).limit(1)
      : [];
    const sourceLinks = signal ? [telegramSourceLink(signal.chatId, signal.messageId)] : undefined;
    const before: ProposalSnapshot = {
      title: decision.title,
      rationale: decision.rationale,
      effect: decision.effect,
      owner: decision.proposalOwner || actor.name,
      due: decision.proposalDue || "—",
    };

    const [storedVersion] = await tx.select().from(proposalVersions)
      .where(and(eq(proposalVersions.proposalId, decision.id), eq(proposalVersions.version, decision.proposalVersion)))
      .limit(1);
    let sourceVersionId = storedVersion?.id;
    if (!storedVersion) {
      const [insertedVersion] = await tx.insert(proposalVersions).values({
        projectId: DEMO_PROJECT_ID,
        proposalId: decision.id,
        version: decision.proposalVersion,
        ...before,
        actorName: "Пиэмка",
        actorRole: "system",
        attribution: "Пиэмка · автоматически",
      }).$returningId();
      sourceVersionId = insertedVersion.id;
    }

    const after: ProposalSnapshot = {
      title: input.title?.trim() || decision.title,
      rationale: decision.rationale,
      effect: decision.effect,
      owner: input.owner?.trim() || decision.proposalOwner || actor.name,
      due: input.due?.trim() || decision.proposalDue || "—",
    };
    const change = buildProposalDiff(before, after);
    const nextVersion = decision.proposalVersion + (change.changed ? 1 : 0);
    if (change.changed) {
      await tx.insert(proposalVersions).values({
        projectId: DEMO_PROJECT_ID,
        proposalId: decision.id,
        version: nextVersion,
        ...after,
        sourceVersionId,
        actorUserId: actor.userId,
        actorName: actor.name,
        actorRole: "rp",
        attribution,
        editDistance: change.editDistance,
        diff: change.diff,
      });
      await tx.insert(auditEvents).values({
        projectId: DEMO_PROJECT_ID,
        entityType: "proposal",
        entityId: decision.id,
        eventType: "proposal.edited",
        relatedId: decision.riskId,
        actorUserId: actor.userId,
        actorName: actor.name,
        actorRole: "rp",
        attribution,
        channel,
        version: nextVersion,
        sourceLinks,
        diff: change.diff,
        metadata: {
          sourceVersion: decision.proposalVersion,
          changedFields: change.changedFields,
          editDistance: change.editDistance,
        },
        detail: `Изменено предложение ${decision.id}: версия ${decision.proposalVersion} → ${nextVersion}`,
      });
    }

    const now = new Date();
    await tx.update(decisions).set({
      title: after.title,
      proposalOwner: after.owner,
      proposalDue: after.due,
      proposalVersion: nextVersion,
      status: input.action,
      attribution,
      decidedByUserId: actor.userId,
      decidedAt: now,
      displayDate: now.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
    }).where(eq(decisions.id, decision.id));
    await tx.insert(auditEvents).values({
      projectId: DEMO_PROJECT_ID,
      entityType: "decision",
      entityId: decision.id,
      eventType: input.action === "ok" ? "decision.accepted" : "decision.rejected",
      relatedId: decision.riskId,
      actorUserId: actor.userId,
      actorName: actor.name,
      actorRole: "rp",
      attribution,
      channel,
      version: nextVersion,
      sourceLinks,
      metadata: { proposalVersion: nextVersion, signalId: signal?.id || null, channelId: signal?.channelId || null },
      detail: `${input.action === "ok" ? "Принято" : "Отклонено"} управленческое предложение ${decision.id}`,
    });

    let taskId: string | undefined;
    if (input.action === "ok") {
      const [existingTask] = await tx.select().from(tasks).where(eq(tasks.decisionId, decision.id)).limit(1);
      if (!existingTask) {
        await tx.insert(projectCounters).values({ projectId: DEMO_PROJECT_ID, counterName: "task", nextValue: 1 })
          .onDuplicateKeyUpdate({ set: { nextValue: sql`LAST_INSERT_ID(nextValue) + 1` } });
        const [counter] = await tx.select().from(projectCounters)
          .where(and(eq(projectCounters.projectId, DEMO_PROJECT_ID), eq(projectCounters.counterName, "task"))).limit(1);
        if (!counter) throw new Error("Не удалось получить следующий номер поручения");
        taskId = `P-${String(counter.nextValue).padStart(2, "0")}`;
      } else {
        taskId = existingTask.id;
      }
      if (!existingTask) {
        await tx.insert(tasks).values({
          id: taskId,
          projectId: DEMO_PROJECT_ID,
          decisionId: decision.id,
          riskId: decision.riskId,
          title: after.title,
          owner: after.owner,
          due: after.due,
          status: "new",
          source: `решение ${decision.id} · ${attribution}`,
        });
        await tx.insert(auditEvents).values({
          projectId: DEMO_PROJECT_ID,
          entityType: "task",
          entityId: taskId,
          eventType: "task.created",
          relatedId: decision.id,
          actorUserId: actor.userId,
          actorName: actor.name,
          actorRole: "rp",
          attribution,
          channel,
          version: nextVersion,
          sourceLinks,
          metadata: { proposalVersion: nextVersion, signalId: signal?.id || null, channelId: signal?.channelId || null },
          detail: `Поручение ${taskId} создано и связано с решением ${decision.id}`,
        });
      }
    }

    return { decisionId: decision.id, taskId, status: input.action, alreadyDecided: false };
  });
}

export async function decideProposal(input: { decisionId: string; action: "ok" | "no"; title?: string; owner?: string; due?: string }, user: User) {
  await decideProposalRecord(input, { userId: user.id, name: user.name || "Руководитель проекта" });
  return getProjectState(user);
}
