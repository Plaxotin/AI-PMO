import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { auditEvents, decisions, outcomeMeasurements, signals, tasks } from "@db/schema";
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
};

function numeric(value: string | null | undefined) {
  if (value === null || value === undefined || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function samePayload(row: typeof outcomeMeasurements.$inferSelect, input: OutcomeInput) {
  return row.metric === input.metric
    && row.unit === input.unit
    && row.baselineValue === (input.baselineValue || null)
    && row.targetValue === (input.targetValue || null)
    && row.actualValue === input.actualValue
    && row.source === input.source
    && row.sourceId === input.sourceId
    && row.sourceUrl === (input.sourceUrl || null);
}

function assessmentForMeasurement(measurement: typeof outcomeMeasurements.$inferSelect, expectedEffect: string) {
  const baseline = numeric(measurement.baselineValue);
  const actual = numeric(measurement.actualValue);
  if (baseline === null || actual === null || !measurement.sourceId.trim() || !measurement.source.trim()) {
    return {
      expectedEffect,
      status: "unconfirmed" as const,
      text: "Эффект пока не подтверждён фактическими данными.",
      basis: "Недостаточно сопоставимых baseline/actual или источника.",
    };
  }
  const target = numeric(measurement.targetValue);
  const targetText = target === null ? "цель не задана" : `цель ${target}`;
  const basis = `${measurement.metric} · baseline ${baseline} → actual ${actual} ${measurement.unit} · ${targetText} · ${measurement.source} · sourceId ${measurement.sourceId} · версия ${measurement.version}`;
  if (measurement.metric === "schedule_days") {
    const effect = baseline - actual;
    return {
      expectedEffect,
      status: "confirmed" as const,
      text: `Изменение срока: ${effect > 0 ? "−" : effect < 0 ? "+" : ""}${effect} дн. (baseline ${baseline} → actual ${actual} ${measurement.unit})`,
      basis,
    };
  }
  return {
    expectedEffect,
    status: "confirmed" as const,
    text: `Фактические данные: ${measurement.metric} baseline ${baseline} → actual ${actual} ${measurement.unit}`,
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
  const [measurement] = await db.select().from(outcomeMeasurements)
    .where(and(eq(outcomeMeasurements.projectId, DEMO_PROJECT_ID), eq(outcomeMeasurements.taskId, taskId), eq(outcomeMeasurements.status, "confirmed")))
    .orderBy(desc(outcomeMeasurements.version)).limit(1);
  if (!measurement) return null;
  return { ...assessmentForMeasurement(measurement, decision.effect), measurementId: measurement.id, measurementVersion: measurement.version };
}

export async function recordOutcome(input: OutcomeInput, actor: { userId: number; name: string }) {
  const metric = input.metric.trim();
  const unit = input.unit.trim();
  const source = input.source.trim();
  const sourceId = input.sourceId.trim();
  const actual = input.actualValue.trim();
  if (!metric || !unit || !actual || !source || !sourceId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Метрика, единица, actual и источник обязательны" });
  }
  if (numeric(actual) === null || (input.baselineValue !== undefined && numeric(input.baselineValue) === null) || (input.targetValue !== undefined && numeric(input.targetValue) === null)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Значения метрики должны быть числами" });
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
    if (latest && samePayload(latest, { ...input, metric: input.metric, unit: input.unit, source, sourceId, actualValue: actual })) {
      const assessment = assessmentForMeasurement(latest, decision.effect);
      return { measurement: latest, assessment, idempotent: true };
    }

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
        baselineValue: measurement.baselineValue,
        targetValue: measurement.targetValue,
        actualValue: measurement.actualValue,
        sourceId,
        sourceUrl: measurement.sourceUrl,
        effectStatus: assessment.status,
        effect: assessment.text,
        effectBasis: assessment.basis,
      },
      detail: latest ? `Измерение эффекта исправлено версией ${version}` : "Измерение эффекта зарегистрировано версией 1",
    });
    return { measurement, assessment, idempotent: false };
  });
}
