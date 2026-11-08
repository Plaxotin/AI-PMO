import { and, desc, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { auditEvents, decisions, outcomeMetricBindings, outcomeMeasurements, signals, tasks } from "@db/schema";
import { getDb } from "./connection";
import { DEMO_PROJECT_ID } from "./pmo";
import { telegramSourceLink } from "./proposal-audit";

export type OutcomeInput = {
  taskId: string;
  metric: "schedule_days" | "cost_amount" | "quality_defects" | "resource_days";
  unit: "days" | "hours" | "currency" | "count" | "percent" | "ratio";
  baselineValue?: string;
  targetValue?: string;
  actualValue: string;
  source: string;
  sourceId: string;
  sourceUrl?: string | null;
  measurementId?: number;
  direction?: "decrease_is_better" | "increase_is_better";
  currencyCode?: string | null;
  baselineObservedAt?: Date;
  actualObservedAt?: Date;
  dataClass?: "real" | "synthetic" | "unknown";
};

function numeric(value: string | null | undefined) {
  if (value === null || value === undefined || !String(value).trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function defaultDirection(metric: string): "decrease_is_better" | "increase_is_better" {
  void metric;
  return "decrease_is_better";
}

function targetStatus(measurement: typeof outcomeMeasurements.$inferSelect) {
  const target = numeric(measurement.targetValue);
  const actual = numeric(measurement.actualValue);
  if (target === null || actual === null) return "not_set" as const;
  const direction = measurement.direction || defaultDirection(measurement.metric);
  const met = direction === "decrease_is_better" ? actual <= target : actual >= target;
  return met ? "met" as const : "not_met" as const;
}

function samePayload(row: typeof outcomeMeasurements.$inferSelect, input: OutcomeInput) {
  return row.metric === input.metric
    && row.unit === input.unit
    && row.baselineValue === (input.baselineValue || null)
    && row.targetValue === (input.targetValue || null)
    && row.actualValue === input.actualValue
    && row.source === input.source
    && row.sourceId === input.sourceId
    && row.sourceUrl === (input.sourceUrl || null)
    && row.direction === (input.direction || defaultDirection(input.metric))
    && row.currencyCode === (input.currencyCode || null)
    && row.baselineObservedAt?.getTime() === input.baselineObservedAt?.getTime()
    && row.actualObservedAt?.getTime() === input.actualObservedAt?.getTime()
    && row.dataClass === (input.dataClass || "real");
}

export function assessmentForMeasurement(measurement: typeof outcomeMeasurements.$inferSelect, expectedEffect: string) {
  const baseline = numeric(measurement.baselineValue);
  const actual = numeric(measurement.actualValue);
  const status = targetStatus(measurement);
  if (baseline === null || actual === null || !measurement.sourceId.trim() || !measurement.source.trim()
    || (measurement.origin === "automatic" && measurement.comparabilityStatus !== "comparable")) {
    return {
      expectedEffect,
      status: "unconfirmed" as const,
      targetStatus: status,
      text: "Эффект пока не подтверждён фактическими данными.",
      basis: "Недостаточно сопоставимых baseline/actual или источника.",
    };
  }
  const target = numeric(measurement.targetValue);
  const targetText = target === null ? "цель не задана" : `цель ${target}`;
  const direction = measurement.direction || defaultDirection(measurement.metric);
  const effect = direction === "decrease_is_better" ? baseline - actual : actual - baseline;
  const basis = `${measurement.metric} · ${direction} · baseline ${baseline} → actual ${actual} ${measurement.unit} · ${targetText} · ${measurement.source} · sourceId ${measurement.sourceId} · версия ${measurement.version}`;
  if (measurement.metric === "schedule_days") {
    return {
      expectedEffect,
      status: "confirmed" as const,
      targetStatus: status,
      actualEffectValue: String(effect),
      text: `Изменение срока: ${effect > 0 ? "−" : effect < 0 ? "+" : ""}${effect} дн. (baseline ${baseline} → actual ${actual} ${measurement.unit})`,
      basis,
    };
  }
  return {
    expectedEffect,
    status: "confirmed" as const,
    targetStatus: status,
    actualEffectValue: String(effect),
    text: `Эффект: ${effect > 0 ? "+" : ""}${effect} ${measurement.unit} (baseline ${baseline} → actual ${actual} ${measurement.unit})`,
    basis,
  };
}

export async function assessTaskOutcome(taskId: string) {
  const db = getDb();
  const [task] = await db.select().from(tasks)
    .where(and(eq(tasks.projectId, DEMO_PROJECT_ID), eq(tasks.id, taskId))).limit(1);
  if (!task?.decisionId) return null;
  const [decision] = await db.select().from(decisions)
    .where(and(eq(decisions.projectId, DEMO_PROJECT_ID), eq(decisions.id, task.decisionId))).limit(1);
  if (!decision) return null;
  const [primary] = await db.select().from(outcomeMetricBindings)
    .where(and(
      eq(outcomeMetricBindings.projectId, DEMO_PROJECT_ID),
      eq(outcomeMetricBindings.taskId, taskId),
      eq(outcomeMetricBindings.isPrimary, true),
      eq(outcomeMetricBindings.status, "active"),
    )).orderBy(desc(outcomeMetricBindings.version)).limit(1);
  if (primary) {
    const [measurement] = await db.select().from(outcomeMeasurements)
      .where(and(eq(outcomeMeasurements.projectId, DEMO_PROJECT_ID), eq(outcomeMeasurements.bindingId, primary.id)))
      .orderBy(desc(outcomeMeasurements.version)).limit(1);
    if (!measurement) return null;
    return {
      ...assessmentForMeasurement(measurement, decision.effect),
      measurementId: measurement.id,
      measurementVersion: measurement.version,
      bindingId: primary.id,
    };
  }

  // Legacy/manual compatibility: never choose arbitrarily between different metrics.
  const legacy = await db.select().from(outcomeMeasurements)
    .where(and(
      eq(outcomeMeasurements.projectId, DEMO_PROJECT_ID),
      eq(outcomeMeasurements.taskId, taskId),
      eq(outcomeMeasurements.status, "confirmed"),
      isNull(outcomeMeasurements.bindingId),
    )).orderBy(desc(outcomeMeasurements.version));
  const latestByMetric = new Map<string, typeof outcomeMeasurements.$inferSelect>();
  for (const row of legacy) if (!latestByMetric.has(row.metric)) latestByMetric.set(row.metric, row);
  if (latestByMetric.size !== 1) return null;
  const measurement = latestByMetric.values().next().value!;
  return { ...assessmentForMeasurement(measurement, decision.effect), measurementId: measurement.id, measurementVersion: measurement.version };
}

export async function recordOutcome(input: OutcomeInput, actor: { userId: number; name: string }) {
  const metric = input.metric;
  const unit = input.unit;
  const source = input.source.trim();
  const sourceId = input.sourceId.trim();
  const actual = input.actualValue.trim();
  const direction = input.direction || defaultDirection(metric);
  if (!metric || !unit || !actual || !source || !sourceId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Метрика, единица, actual и источник обязательны" });
  }
  if (numeric(actual) === null || (input.baselineValue !== undefined && numeric(input.baselineValue) === null) || (input.targetValue !== undefined && numeric(input.targetValue) === null)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Значения метрики должны быть числами" });
  }
  if (unit === "currency" && !/^[A-Z]{3}$/.test(input.currencyCode || "")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Для денежной метрики нужен currencyCode ISO 4217" });
  }
  if (input.sourceUrl && !/^https?:\/\//.test(input.sourceUrl)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "sourceUrl должен быть HTTP(S) URL" });
  }

  return getDb().transaction(async (tx) => {
    const [task] = await tx.select().from(tasks)
      .where(and(eq(tasks.projectId, DEMO_PROJECT_ID), eq(tasks.id, input.taskId))).for("update").limit(1);
    if (!task || task.status !== "done" || !task.decisionId) {
      throw new TRPCError({ code: "CONFLICT", message: "Измерение эффекта требует выполненное поручение со связанным решением" });
    }
    const [decision] = await tx.select().from(decisions)
      .where(and(eq(decisions.projectId, DEMO_PROJECT_ID), eq(decisions.id, task.decisionId))).limit(1);
    if (!decision) throw new TRPCError({ code: "NOT_FOUND", message: "Связанное решение не найдено" });

    const [latest] = await tx.select().from(outcomeMeasurements)
      .where(and(eq(outcomeMeasurements.projectId, DEMO_PROJECT_ID), eq(outcomeMeasurements.taskId, task.id), eq(outcomeMeasurements.metric, metric)))
      .orderBy(desc(outcomeMeasurements.version)).for("update").limit(1);
    if (latest && samePayload(latest, { ...input, metric, unit, source, sourceId, actualValue: actual })) {
      const assessment = assessmentForMeasurement(latest, decision.effect);
      return { measurement: latest, assessment, idempotent: true };
    }

    const comparable = Boolean(input.baselineObservedAt && input.actualObservedAt && task.completedAt
      && input.actualObservedAt >= task.completedAt && input.baselineObservedAt <= input.actualObservedAt);
    const version = (latest?.version || 0) + 1;
    const eventType = latest ? "outcome.corrected" : "outcome.recorded";
    if (latest) {
      await tx.update(outcomeMeasurements).set({ status: "superseded" }).where(eq(outcomeMeasurements.id, latest.id));
    }
    const attribution = `Пиэмка от имени ${actor.name}`;
    const [inserted] = await tx.insert(outcomeMeasurements).values({
      projectId: DEMO_PROJECT_ID,
      taskId: task.id,
      decisionId: decision.id,
      metric,
      unit,
      baselineValue: input.baselineValue || null,
      targetValue: input.targetValue || null,
      actualValue: actual,
      source,
      sourceId,
      sourceUrl: input.sourceUrl || null,
      status: "confirmed",
      version,
      previousVersionId: latest?.id,
      recordedByUserId: actor.userId,
      recordedByName: actor.name,
      recordedByRole: "rp",
      origin: "manual",
      baselineObservedAt: input.baselineObservedAt || null,
      actualObservedAt: input.actualObservedAt || null,
      direction,
      currencyCode: input.currencyCode || null,
      dataClass: input.dataClass || "real",
      comparabilityStatus: comparable ? "comparable" : "unknown",
    }).$returningId();
    const [measurement] = await tx.select().from(outcomeMeasurements).where(eq(outcomeMeasurements.id, inserted.id)).limit(1);
    const assessment = assessmentForMeasurement(measurement, decision.effect);
    const [sourceSignal] = decision.riskId
      ? await tx.select().from(signals).where(eq(signals.riskId, decision.riskId)).limit(1)
      : [];
    await tx.insert(auditEvents).values({
      projectId: DEMO_PROJECT_ID,
      entityType: "outcome",
      entityId: task.id,
      eventType,
      relatedId: decision.id,
      actorUserId: actor.userId,
      actorName: actor.name,
      actorRole: "rp",
      attribution,
      channel: "web",
      version,
      sourceLinks: sourceSignal ? [telegramSourceLink(sourceSignal.chatId, sourceSignal.messageId)] : undefined,
      metadata: {
        measurementId: measurement.id,
        previousVersionId: latest?.id || null,
        metric,
        unit,
        direction,
        baselineValue: measurement.baselineValue,
        targetValue: measurement.targetValue,
        actualValue: measurement.actualValue,
        sourceId,
        sourceUrl: measurement.sourceUrl,
        dataClass: measurement.dataClass,
        comparabilityStatus: measurement.comparabilityStatus,
        effectStatus: assessment.status,
        targetStatus: assessment.targetStatus,
        effect: assessment.text,
        effectBasis: assessment.basis,
      },
      detail: latest ? `Измерение эффекта исправлено версией ${version}` : "Измерение эффекта зарегистрировано версией 1",
    });
    return { measurement, assessment, idempotent: false };
  });
}
