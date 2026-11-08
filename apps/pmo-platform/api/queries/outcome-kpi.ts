import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditEvents,
  decisions,
  outcomeMetricBindings,
  outcomeObservations,
  outcomeMeasurements,
  outcomeSources,
  tasks,
} from "@db/schema";
import { getDb } from "./connection";
import { DEMO_PROJECT_ID } from "./pmo";
import { assessmentForMeasurement } from "./outcome";

const COLLECTION_INTERVAL_MS = 15 * 60 * 1000;
const COLLECTION_LEASE_MS = 15 * 60 * 1000;

export type OutcomeActor = { userId: number; name: string };

export type OutcomeSourceInput = {
  id: string;
  type: string;
  name: string;
  connectionRef: string;
  config?: Record<string, unknown>;
  status?: "active" | "paused" | "disabled";
};

export type OutcomeBindingInput = {
  key: string;
  sourceId: string;
  decisionId: string;
  taskId: string;
  metric: "schedule_days" | "cost_amount" | "quality_defects" | "resource_days";
  unit: "days" | "hours" | "currency" | "count" | "percent" | "ratio";
  direction: "decrease_is_better" | "increase_is_better";
  currencyCode?: string | null;
  externalKey: string;
  selectorConfig?: Record<string, unknown>;
  isPrimary?: boolean;
};

export type OutcomeObservationInput = {
  externalObservationId: string;
  role: "baseline" | "target" | "actual";
  value: string;
  unit: string;
  currencyCode?: string | null;
  observedAt: string | Date;
  dataClass?: "real" | "synthetic" | "unknown";
  sourceRecordUrl?: string | null;
};

export type OutcomeSourceAdapter = {
  read(input: {
    source: typeof outcomeSources.$inferSelect;
    binding: typeof outcomeMetricBindings.$inferSelect;
  }): Promise<OutcomeObservationInput[]>;
};

const adapters = new Map<string, OutcomeSourceAdapter>();

export function registerOutcomeSourceAdapter(type: string, adapter: OutcomeSourceAdapter) {
  adapters.set(type, adapter);
}

function numeric(value: string | null | undefined) {
  if (value === null || value === undefined || !String(value).trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hashObservation(input: OutcomeObservationInput) {
  const observedAt = input.observedAt instanceof Date ? input.observedAt.toISOString() : input.observedAt;
  return createHash("sha256").update(JSON.stringify({ ...input, observedAt })).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sanitizedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/\S+/g, "[url]").slice(0, 120);
}

export async function registryJsonRead({ source, binding }: {
  source: typeof outcomeSources.$inferSelect;
  binding: typeof outcomeMetricBindings.$inferSelect;
}): Promise<OutcomeObservationInput[]> {
  const endpoint = process.env[`${source.connectionRef}_URL`];
  if (!endpoint) throw new Error("OUTCOME_SOURCE_CONFIG_MISSING");
  const url = new URL(endpoint);
  const localTest = process.env.NODE_ENV !== "production" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !localTest) throw new Error("OUTCOME_SOURCE_HTTPS_REQUIRED");
  url.searchParams.set("binding", binding.externalKey);
  const token = process.env[`${source.connectionRef}_TOKEN`];
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`OUTCOME_SOURCE_HTTP_${response.status}`);
  const body = await response.json() as { observations?: OutcomeObservationInput[] };
  if (!Array.isArray(body.observations)) throw new Error("OUTCOME_SOURCE_SCHEMA_INVALID");
  return body.observations;
}

async function readSource(source: typeof outcomeSources.$inferSelect, binding: typeof outcomeMetricBindings.$inferSelect) {
  if (!source.readOnly) throw new Error("OUTCOME_SOURCE_NOT_READ_ONLY");
  const adapter = adapters.get(source.type);
  if (adapter) return adapter.read({ source, binding });
  if (source.type === "registry_json") return registryJsonRead({ source, binding });
  throw new Error("OUTCOME_SOURCE_ADAPTER_UNAVAILABLE");
}

export async function configureOutcomeSource(input: OutcomeSourceInput, actor: OutcomeActor) {
  if (!/^[A-Z0-9_]{3,128}$/.test(input.connectionRef)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "connectionRef должен быть именем server-side конфигурации" });
  }
  const config = input.config || {};
  if (/(?:token|secret|password|credential|api[_-]?key)/i.test(JSON.stringify(config))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "config должен содержать только sanitized параметры без секретов" });
  }
  const status = input.status || "active";
  return getDb().transaction(async (tx) => {
    const [existing] = await tx.select().from(outcomeSources)
      .where(and(eq(outcomeSources.projectId, DEMO_PROJECT_ID), eq(outcomeSources.id, input.id))).for("update").limit(1);
    if (existing && existing.type === input.type && existing.name === input.name
      && existing.connectionRef === input.connectionRef && existing.status === status
      && canonicalJson(existing.config) === canonicalJson(config)) {
      return { source: existing, idempotent: true };
    }
    if (existing) {
      await tx.update(outcomeSources).set({
        type: input.type,
        name: input.name,
        connectionRef: input.connectionRef,
        config,
        status,
        lastErrorCode: null,
      }).where(eq(outcomeSources.id, existing.id));
    } else {
      await tx.insert(outcomeSources).values({
        id: input.id,
        projectId: DEMO_PROJECT_ID,
        type: input.type,
        name: input.name,
        connectionRef: input.connectionRef,
        readOnly: true,
        config,
        status,
      });
    }
    const [source] = await tx.select().from(outcomeSources).where(eq(outcomeSources.id, input.id)).limit(1);
    await tx.insert(auditEvents).values({
      projectId: DEMO_PROJECT_ID,
      entityType: "kpi_source",
      entityId: source.id,
      eventType: status === "active" ? "kpi.source.activated" : "kpi.source.paused",
      actorUserId: actor.userId,
      actorName: actor.name,
      actorRole: "rp",
      attribution: `Пиэмка от имени ${actor.name}`,
      channel: "web",
      metadata: { type: source.type, connectionRef: source.connectionRef, readOnly: true },
      detail: `Источник KPI ${source.name}: ${status}`,
    });
    return { source, idempotent: false };
  });
}

function sameBinding(row: typeof outcomeMetricBindings.$inferSelect, input: OutcomeBindingInput) {
  return row.sourceId === input.sourceId && row.decisionId === input.decisionId && row.taskId === input.taskId
    && row.metric === input.metric && row.unit === input.unit && row.direction === input.direction
    && row.currencyCode === (input.currencyCode || null) && row.externalKey === input.externalKey
    && canonicalJson(row.selectorConfig) === canonicalJson(input.selectorConfig || {})
    && Boolean(row.isPrimary) === (input.isPrimary ?? true) && row.status === "active";
}

export async function approveOutcomeMetricBinding(input: OutcomeBindingInput, actor: OutcomeActor) {
  if (input.unit === "currency" && !/^[A-Z]{3}$/.test(input.currencyCode || "")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Для денежной метрики нужен currencyCode ISO 4217" });
  }
  return getDb().transaction(async (tx) => {
    const [task] = await tx.select().from(tasks)
      .where(and(eq(tasks.projectId, DEMO_PROJECT_ID), eq(tasks.id, input.taskId))).for("update").limit(1);
    if (!task || task.status !== "done" || task.decisionId !== input.decisionId) {
      throw new TRPCError({ code: "CONFLICT", message: "Binding требует выполненное поручение со связанным решением" });
    }
    const [decision] = await tx.select().from(decisions)
      .where(and(eq(decisions.projectId, DEMO_PROJECT_ID), eq(decisions.id, input.decisionId))).limit(1);
    if (!decision) throw new TRPCError({ code: "NOT_FOUND", message: "Решение не найдено" });
    const [source] = await tx.select().from(outcomeSources)
      .where(and(eq(outcomeSources.projectId, DEMO_PROJECT_ID), eq(outcomeSources.id, input.sourceId))).limit(1);
    if (!source || !["active", "error"].includes(source.status) || !source.readOnly) {
      throw new TRPCError({ code: "CONFLICT", message: "Нужен активный read-only источник" });
    }
    const [latest] = await tx.select().from(outcomeMetricBindings)
      .where(and(eq(outcomeMetricBindings.projectId, DEMO_PROJECT_ID), eq(outcomeMetricBindings.key, input.key)))
      .orderBy(desc(outcomeMetricBindings.version)).for("update").limit(1);
    if (latest && sameBinding(latest, input)) return { binding: latest, idempotent: true };
    if (latest) {
      await tx.update(outcomeMetricBindings).set({ status: "superseded", collectingAt: null })
        .where(eq(outcomeMetricBindings.id, latest.id));
    }
    const version = (latest?.version || 0) + 1;
    const [inserted] = await tx.insert(outcomeMetricBindings).values({
      key: input.key,
      projectId: DEMO_PROJECT_ID,
      sourceId: input.sourceId,
      decisionId: input.decisionId,
      taskId: input.taskId,
      metric: input.metric,
      unit: input.unit,
      direction: input.direction,
      currencyCode: input.currencyCode || null,
      externalKey: input.externalKey,
      selectorConfig: input.selectorConfig || {},
      isPrimary: input.isPrimary ?? true,
      status: "active",
      version,
      approvedByUserId: actor.userId,
      approvedByName: actor.name,
      approvedAt: new Date(),
    }).$returningId();
    const [binding] = await tx.select().from(outcomeMetricBindings).where(eq(outcomeMetricBindings.id, inserted.id)).limit(1);
    await tx.insert(auditEvents).values({
      projectId: DEMO_PROJECT_ID,
      entityType: "kpi_binding",
      entityId: binding.key,
      eventType: latest ? "kpi.binding.superseded" : "kpi.binding.approved",
      relatedId: binding.taskId,
      actorUserId: actor.userId,
      actorName: actor.name,
      actorRole: "rp",
      attribution: `Пиэмка от имени ${actor.name}`,
      channel: "web",
      version,
      metadata: {
        bindingId: binding.id,
        sourceId: binding.sourceId,
        metric: binding.metric,
        unit: binding.unit,
        direction: binding.direction,
        currencyCode: binding.currencyCode,
        externalKey: binding.externalKey,
        isPrimary: binding.isPrimary,
      },
      detail: `Привязка KPI ${binding.key} утверждена версией ${version}`,
    });
    return { binding, idempotent: false };
  });
}

export function observationErrors(input: OutcomeObservationInput, binding: typeof outcomeMetricBindings.$inferSelect) {
  const errors: string[] = [];
  if (!input.externalObservationId.trim()) errors.push("OBSERVATION_ID_MISSING");
  if (numeric(input.value) === null) errors.push("VALUE_NOT_NUMERIC");
  if (input.unit !== binding.unit) errors.push("UNIT_MISMATCH");
  if ((input.currencyCode || null) !== binding.currencyCode) errors.push("CURRENCY_MISMATCH");
  const observedAt = new Date(input.observedAt);
  if (Number.isNaN(observedAt.getTime())) errors.push("OBSERVED_AT_INVALID");
  if (input.sourceRecordUrl && !/^https?:\/\//.test(input.sourceRecordUrl)) errors.push("SOURCE_URL_INVALID");
  return errors;
}

async function claimBinding(key: string, now: Date) {
  return getDb().transaction(async (tx) => {
    const [binding] = await tx.select().from(outcomeMetricBindings)
      .where(and(eq(outcomeMetricBindings.projectId, DEMO_PROJECT_ID), eq(outcomeMetricBindings.key, key)))
      .orderBy(desc(outcomeMetricBindings.version)).for("update").limit(1);
    if (!binding || binding.status !== "active") return { status: "inactive" as const };
    const leaseExpired = !binding.collectingAt || now.getTime() - binding.collectingAt.getTime() >= COLLECTION_LEASE_MS;
    if (!leaseExpired) return { status: "overlap" as const, binding };
    if (binding.lastAttemptAt && now.getTime() - binding.lastAttemptAt.getTime() < COLLECTION_INTERVAL_MS) {
      return { status: "throttled" as const, binding };
    }
    const [source] = await tx.select().from(outcomeSources).where(eq(outcomeSources.id, binding.sourceId)).for("update").limit(1);
    if (!source || !["active", "error"].includes(source.status) || !source.readOnly) {
      return { status: "source_unavailable" as const, binding };
    }
    await tx.update(outcomeMetricBindings).set({ collectingAt: now, lastAttemptAt: now })
      .where(eq(outcomeMetricBindings.id, binding.id));
    await tx.update(outcomeSources).set({ lastAttemptAt: now }).where(eq(outcomeSources.id, source.id));
    return { status: "claimed" as const, binding: { ...binding, collectingAt: now, lastAttemptAt: now }, source };
  });
}

async function finishCollectionError(bindingId: number, sourceId: string, now: Date, error: unknown) {
  const code = sanitizedError(error);
  await getDb().transaction(async (tx) => {
    await tx.update(outcomeMetricBindings).set({ collectingAt: null }).where(eq(outcomeMetricBindings.id, bindingId));
    await tx.update(outcomeSources).set({ status: "error", lastErrorCode: code }).where(eq(outcomeSources.id, sourceId));
    await tx.insert(auditEvents).values({
      projectId: DEMO_PROJECT_ID,
      entityType: "kpi_collection",
      entityId: String(bindingId),
      eventType: "kpi.collection.failed",
      actorName: "Пиэмка",
      actorRole: "system",
      attribution: "Пиэмка · автоматический сбор KPI",
      channel: "system",
      metadata: { sourceId, errorCode: code, attemptedAt: now.toISOString() },
      detail: "Сбор KPI завершился ошибкой",
    });
  });
  return { status: "failed" as const, errorCode: code };
}

async function storeObservation(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  binding: typeof outcomeMetricBindings.$inferSelect,
  input: OutcomeObservationInput,
  now: Date,
) {
  const payloadHash = hashObservation(input);
  const [existing] = await tx.select().from(outcomeObservations).where(and(
    eq(outcomeObservations.sourceId, binding.sourceId),
    eq(outcomeObservations.externalObservationId, input.externalObservationId),
    eq(outcomeObservations.role, input.role),
    eq(outcomeObservations.payloadHash, payloadHash),
  )).limit(1);
  if (existing) return { observation: existing, created: false };
  const errors = observationErrors(input, binding);
  const [inserted] = await tx.insert(outcomeObservations).values({
    projectId: DEMO_PROJECT_ID,
    sourceId: binding.sourceId,
    bindingId: binding.id,
    externalObservationId: input.externalObservationId,
    payloadHash,
    role: input.role,
    value: input.value,
    unit: input.unit,
    currencyCode: input.currencyCode || null,
    observedAt: errors.includes("OBSERVED_AT_INVALID") ? null : new Date(input.observedAt),
    collectedAt: now,
    dataClass: input.dataClass || "unknown",
    validationStatus: errors.length ? "rejected" : "validated",
    validationErrors: errors,
    sourceRecordUrl: input.sourceRecordUrl || null,
  }).$returningId();
  const [observation] = await tx.select().from(outcomeObservations).where(eq(outcomeObservations.id, inserted.id)).limit(1);
  if (errors.length) {
    await tx.insert(auditEvents).values({
      projectId: DEMO_PROJECT_ID,
      entityType: "kpi_observation",
      entityId: String(observation.id),
      eventType: "kpi.observation.rejected",
      relatedId: binding.key,
      actorName: "Пиэмка",
      actorRole: "system",
      attribution: "Пиэмка · автоматический сбор KPI",
      channel: "system",
      metadata: { bindingId: binding.id, role: observation.role, validationErrors: errors, payloadHash },
      detail: "Наблюдение KPI отклонено правилами валидации",
    });
  }
  return { observation, created: true };
}

async function createAutomaticMeasurement(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  binding: typeof outcomeMetricBindings.$inferSelect,
  source: typeof outcomeSources.$inferSelect,
  observations: (typeof outcomeObservations.$inferSelect)[],
) {
  const valid = observations.filter((item) => item.validationStatus === "validated");
  const latest = (role: "baseline" | "target" | "actual") => valid.filter((item) => item.role === role)
    .sort((a, b) => (b.observedAt?.getTime() || 0) - (a.observedAt?.getTime() || 0) || b.id - a.id)[0];
  const baseline = latest("baseline");
  const target = latest("target");
  const actual = latest("actual");
  if (!baseline || !actual) return { created: false, reason: "BASELINE_OR_ACTUAL_MISSING" as const };
  const [task] = await tx.select().from(tasks).where(eq(tasks.id, binding.taskId)).for("update").limit(1);
  const [decision] = await tx.select().from(decisions).where(eq(decisions.id, binding.decisionId)).limit(1);
  const classes = [baseline, target, actual].filter(Boolean).map((item) => item!.dataClass);
  const dataClass = classes.every((item) => item === "real") ? "real" : classes.includes("synthetic") ? "synthetic" : "unknown";
  const comparable = Boolean(task && decision && task.status === "done" && task.decisionId === decision.id
    && baseline.observedAt && actual.observedAt && task.completedAt
    && actual.observedAt >= task.completedAt && baseline.observedAt <= actual.observedAt
    && dataClass === "real");
  const [previous] = await tx.select().from(outcomeMeasurements)
    .where(and(eq(outcomeMeasurements.projectId, DEMO_PROJECT_ID), eq(outcomeMeasurements.taskId, binding.taskId), eq(outcomeMeasurements.metric, binding.metric)))
    .orderBy(desc(outcomeMeasurements.version)).for("update").limit(1);
  if (previous && previous.bindingId === binding.id && previous.baselineObservationId === baseline.id && previous.targetObservationId === (target?.id || null)
    && previous.actualObservationId === actual.id && previous.comparabilityStatus === (comparable ? "comparable" : "incomparable")) {
    return { created: false, reason: "IDEMPOTENT" as const, measurement: previous };
  }
  const version = (previous?.version || 0) + 1;
  if (previous) await tx.update(outcomeMeasurements).set({ status: "superseded" }).where(eq(outcomeMeasurements.id, previous.id));
  const [inserted] = await tx.insert(outcomeMeasurements).values({
    projectId: DEMO_PROJECT_ID,
    taskId: binding.taskId,
    decisionId: binding.decisionId,
    metric: binding.metric,
    unit: binding.unit,
    baselineValue: baseline.value,
    targetValue: target?.value || null,
    actualValue: actual.value,
    source: source.name,
    sourceId: source.id,
    sourceUrl: actual.sourceRecordUrl,
    status: comparable ? "confirmed" : "draft",
    version,
    previousVersionId: previous?.id || null,
    recordedByUserId: 0,
    recordedByName: "Пиэмка",
    recordedByRole: "system",
    origin: "automatic",
    bindingId: binding.id,
    baselineObservationId: baseline.id,
    targetObservationId: target?.id || null,
    actualObservationId: actual.id,
    baselineObservedAt: baseline.observedAt,
    actualObservedAt: actual.observedAt,
    direction: binding.direction,
    currencyCode: binding.currencyCode,
    dataClass,
    comparabilityStatus: comparable ? "comparable" : "incomparable",
  }).$returningId();
  const [measurement] = await tx.select().from(outcomeMeasurements).where(eq(outcomeMeasurements.id, inserted.id)).limit(1);
  const assessment = assessmentForMeasurement(measurement, decision?.effect || "");
  await tx.insert(auditEvents).values({
    projectId: DEMO_PROJECT_ID,
    entityType: "outcome",
    entityId: binding.taskId,
    eventType: previous ? "outcome.corrected" : "outcome.recorded",
    relatedId: binding.decisionId,
    actorName: "Пиэмка",
    actorRole: "system",
    attribution: `Пиэмка · автоматический сбор из ${source.name}`,
    channel: "system",
    version,
    metadata: {
      measurementId: measurement.id,
      previousVersionId: previous?.id || null,
      bindingId: binding.id,
      observationIds: [baseline.id, target?.id || null, actual.id],
      metric: binding.metric,
      direction: binding.direction,
      dataClass,
      comparabilityStatus: measurement.comparabilityStatus,
      effectStatus: assessment.status,
      targetStatus: assessment.targetStatus,
      effect: assessment.text,
    },
    detail: previous ? `Автоматическое измерение исправлено версией ${version}` : "Автоматическое измерение зарегистрировано версией 1",
  });
  return { created: true, measurement, assessment };
}

export async function collectOutcomeMetricBinding(key: string, now = new Date()) {
  const claim = await claimBinding(key, now);
  if (claim.status !== "claimed") return claim;
  const { binding, source } = claim;
  try {
    const inputs = await readSource(source, binding);
    return await getDb().transaction(async (tx) => {
      const stored = [];
      for (const input of inputs) stored.push(await storeObservation(tx, binding, input, now));
      const result = await createAutomaticMeasurement(tx, binding, source, stored.map((item) => item.observation));
      await tx.update(outcomeMetricBindings).set({ collectingAt: null }).where(eq(outcomeMetricBindings.id, binding.id));
      await tx.update(outcomeSources).set({ status: "active", lastSuccessAt: now, lastErrorCode: null })
        .where(eq(outcomeSources.id, source.id));
      await tx.insert(auditEvents).values({
        projectId: DEMO_PROJECT_ID,
        entityType: "kpi_collection",
        entityId: String(binding.id),
        eventType: "kpi.collection.succeeded",
        relatedId: binding.taskId,
        actorName: "Пиэмка",
        actorRole: "system",
        attribution: `Пиэмка · автоматический сбор из ${source.name}`,
        channel: "system",
        metadata: {
          sourceId: source.id,
          bindingId: binding.id,
          received: inputs.length,
          newObservations: stored.filter((item) => item.created).length,
          measurementId: "measurement" in result ? result.measurement?.id || null : null,
          measurementCreated: result.created,
          completedAt: now.toISOString(),
        },
        detail: "Сбор KPI завершён",
      });
      return { status: "collected" as const, ...result };
    });
  } catch (error) {
    return finishCollectionError(binding.id, source.id, now, error);
  }
}

export async function runOutcomeKpiCollection(now = new Date()) {
  const bindings = await getDb().select().from(outcomeMetricBindings).where(and(
    eq(outcomeMetricBindings.projectId, DEMO_PROJECT_ID),
    inArray(outcomeMetricBindings.status, ["active"]),
  ));
  const summary = { claimed: 0, collected: 0, throttled: 0, failed: 0, inactive: 0 };
  for (const binding of bindings) {
    const result = await collectOutcomeMetricBinding(binding.key, now);
    if (result.status === "collected" || result.status === "overlap") summary.claimed += 1;
    if (result.status === "collected") summary.collected += 1;
    if (result.status === "throttled" || result.status === "overlap") summary.throttled += 1;
    if (result.status === "failed" || result.status === "source_unavailable") summary.failed += 1;
    if (result.status === "inactive") summary.inactive += 1;
  }
  return summary;
}
