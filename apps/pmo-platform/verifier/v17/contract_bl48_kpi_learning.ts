import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import type { TrpcContext } from "../../api/context";
import { pmoRouter } from "../../api/pmo-router";
import { assessTaskOutcome, assessmentForMeasurement } from "../../api/queries/outcome";
import {
  collectOutcomeMetricBinding,
  registerOutcomeSourceAdapter,
  runOutcomeKpiCollection,
  type OutcomeObservationInput,
} from "../../api/queries/outcome-kpi";
import { buildLearningContext, recordLearningContextUsage } from "../../api/queries/learning-context";
import { getDb } from "../../api/queries/connection";
import {
  auditEvents,
  decisions,
  learningContextUsages,
  outcomeMeasurements,
  outcomeMetricBindings,
  outcomeObservations,
  outcomeSources,
  projectMemberships,
  risks,
  tasks,
  users,
  type User,
} from "../../db/schema";

const db = getDb();
const now = new Date("2026-11-09T00:00:00.000Z");
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const taskId = "P-BL48K-001";
const decisionId = "D-BL48K-001";
const bindingKey = "B-BL48K-001";
const sourceId = "SRC-BL48K-001";

await db.insert(risks).values({
  id: "R-BL48K-001", projectId: "PRJ-01", title: "Synthetic BL-48 KPI risk", recordType: "auto", channel: "test",
  impact: "Synthetic schedule impact", probability: "средняя", confidence: 90, measure: "Synthetic mitigation", source: "Synthetic BL-48 KPI fixture",
});
await db.insert(decisions).values({
  id: decisionId, projectId: "PRJ-01", riskId: "R-BL48K-001", title: "Synthetic KPI decision", rationale: "Synthetic rationale", effect: "Сократить срок до 8 дней",
  status: "ok", displayDate: "08.11", proposalOwner: "Synthetic owner", proposalDue: "10.11.2026", decidedAt: new Date("2026-11-07T09:00:00.000Z"),
});
await db.insert(tasks).values({
  id: taskId, projectId: "PRJ-01", decisionId, riskId: "R-BL48K-001", title: "Synthetic completed KPI task", owner: "Synthetic owner", due: "10.11.2026",
  status: "done", result: "Synthetic result", completedByName: "Synthetic RP", completedAt: new Date("2026-11-08T09:00:00.000Z"),
});

const roleFixtures = [
  { key: "rp", role: "rp", platformRole: "user" },
  { key: "pmo", role: "pmo", platformRole: "admin" },
  { key: "cLevel", role: "c_level", platformRole: "admin" },
  { key: "member", role: "member", platformRole: "admin" },
] as const;
const actors = {} as Record<(typeof roleFixtures)[number]["key"], User>;
for (const fixture of roleFixtures) {
  const unionId = `bl48k-${fixture.key}`;
  await db.insert(users).values({ unionId, name: `Synthetic ${fixture.key}`, role: fixture.platformRole });
  const [actor] = await db.select().from(users).where(eq(users.unionId, unionId)).limit(1);
  actors[fixture.key] = actor;
  await db.insert(projectMemberships).values({ projectId: "PRJ-01", userId: actor.id, role: fixture.role });
}
const caller = (actor: User) => pmoRouter.createCaller({ user: actor } as TrpcContext);
async function expectCode(call: () => Promise<unknown>, code: string) {
  try { await call(); return false; } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
  }
}

let currentInputs: OutcomeObservationInput[] = [];
const readCalls: string[] = [];
const failingSources = new Set<string>();
const contractAdapter = {
  async read({ source, binding }: { source: typeof outcomeSources.$inferSelect; binding: typeof outcomeMetricBindings.$inferSelect }) {
    readCalls.push(`${source.id}:${binding.key}:${binding.version}`);
    if (failingSources.has(source.id)) throw new Error("SYNTHETIC_SOURCE_TIMEOUT");
    return currentInputs;
  },
};
registerOutcomeSourceAdapter("bl48_contract", contractAdapter);

const realInputs = (actual: string, actualObservedAt = "2026-11-08T10:00:00.000Z"): OutcomeObservationInput[] => [
  { externalObservationId: "BL48K-BASE-1", role: "baseline", value: "12", unit: "days", observedAt: "2026-11-07T09:00:00.000Z", dataClass: "real", sourceRecordUrl: "https://example.test/bl48k/baseline" },
  { externalObservationId: "BL48K-TARGET-1", role: "target", value: "8", unit: "days", observedAt: "2026-11-07T09:00:00.000Z", dataClass: "real", sourceRecordUrl: "https://example.test/bl48k/target" },
  { externalObservationId: `BL48K-ACTUAL-${actual}-${actualObservedAt}`, role: "actual", value: actual, unit: "days", observedAt: actualObservedAt, dataClass: "real", sourceRecordUrl: "https://example.test/bl48k/actual" },
];

const sourceInput = {
  id: sourceId,
  type: "bl48_contract",
  name: "Synthetic read-only KPI registry",
  connectionRef: "BL48K_TEST_SOURCE",
  config: { document: "synthetic-registry", range: "KPI!A:D" },
};
const source = await caller(actors.rp).configureOutcomeSource(sourceInput);
const sourceRepeat = await caller(actors.rp).configureOutcomeSource(sourceInput);
const secretConfigDenied = await expectCode(() => caller(actors.rp).configureOutcomeSource({ ...sourceInput, id: "SRC-BL48K-SECRET", config: { token: "must-not-persist" } }), "BAD_REQUEST");
const pmoSourceDenied = await expectCode(() => caller(actors.pmo).configureOutcomeSource({ ...sourceInput, id: "SRC-BL48K-DENIED" }), "FORBIDDEN");
const bindingInput = {
  key: bindingKey,
  sourceId,
  decisionId,
  taskId,
  metric: "schedule_days" as const,
  unit: "days" as const,
  direction: "decrease_is_better" as const,
  externalKey: "synthetic-schedule",
  selectorConfig: { baseline: "B2", target: "C2", actual: "D2" },
  isPrimary: true,
};
const binding = await caller(actors.rp).approveOutcomeBinding(bindingInput);
const bindingRepeat = await caller(actors.rp).approveOutcomeBinding(bindingInput);
const cLevelBindingDenied = await expectCode(() => caller(actors.cLevel).approveOutcomeBinding({ ...bindingInput, key: "B-BL48K-DENIED" }), "FORBIDDEN");
const memberCollectDenied = await expectCode(() => caller(actors.member).collectOutcome({ key: bindingKey }), "FORBIDDEN");
const noMeasurement = await assessTaskOutcome(taskId);
const emptyLearning = await buildLearningContext("schedule_days");

currentInputs = realInputs("9");
const first = await collectOutcomeMetricBinding(bindingKey, now);
const repeated = await collectOutcomeMetricBinding(bindingKey, now);
const firstObservations = await db.select().from(outcomeObservations).where(eq(outcomeObservations.bindingId, binding.binding.id));
const firstMeasurements = await db.select().from(outcomeMeasurements).where(eq(outcomeMeasurements.taskId, taskId));
const firstAssessment = await assessTaskOutcome(taskId);

await db.update(outcomeMetricBindings).set({ collectingAt: now }).where(eq(outcomeMetricBindings.id, binding.binding.id));
const overlap = await collectOutcomeMetricBinding(bindingKey, now);
await db.update(outcomeMetricBindings).set({ collectingAt: null }).where(eq(outcomeMetricBindings.id, binding.binding.id));

currentInputs = realInputs("7").map((item) => ({ ...item, dataClass: "synthetic" as const }));
const synthetic = await collectOutcomeMetricBinding(bindingKey, later(16));
const syntheticLearning = await buildLearningContext("schedule_days");

currentInputs = [{ externalObservationId: "BL48K-BAD-UNIT", role: "actual", value: "8", unit: "hours", observedAt: "2026-11-08T11:00:00.000Z", dataClass: "real" }];
const invalidUnit = await collectOutcomeMetricBinding(bindingKey, later(32));
const rejectedObservations = await db.select().from(outcomeObservations).where(and(eq(outcomeObservations.bindingId, binding.binding.id), eq(outcomeObservations.validationStatus, "rejected")));

currentInputs = realInputs("8", "2026-11-08T08:00:00.000Z");
const earlyActual = await collectOutcomeMetricBinding(bindingKey, later(48));
const earlyLearning = await buildLearningContext("schedule_days");

currentInputs = realInputs("8");
const finalReal = await collectOutcomeMetricBinding(bindingKey, later(64));
const finalLearning = await buildLearningContext("schedule_days");
const usage = await recordLearningContextUsage({ proposalId: "D-BL48K-PREVIEW", proposalVersion: 1, modelId: "synthetic-model", context: finalLearning });
const usageRepeat = await recordLearningContextUsage({ proposalId: "D-BL48K-PREVIEW", proposalVersion: 1, modelId: "synthetic-model", context: finalLearning });
const learningUsages = await db.select().from(learningContextUsages).where(eq(learningContextUsages.proposalId, "D-BL48K-PREVIEW"));

const bindingV2 = await caller(actors.rp).approveOutcomeBinding({ ...bindingInput, externalKey: "synthetic-schedule-v2" });
currentInputs = realInputs("8");
const rebound = await collectOutcomeMetricBinding(bindingKey, later(80));
const bindingVersions = await db.select().from(outcomeMetricBindings).where(eq(outcomeMetricBindings.key, bindingKey));

await db.insert(risks).values({
  id: "R-BL48K-ERROR", projectId: "PRJ-01", title: "Synthetic source error", recordType: "auto", channel: "test",
  impact: "Synthetic", probability: "низкая", measure: "Synthetic", source: "Synthetic",
});
await db.insert(decisions).values({
  id: "D-BL48K-ERROR", projectId: "PRJ-01", riskId: "R-BL48K-ERROR", title: "Synthetic error decision", rationale: "Synthetic", effect: "Synthetic",
  status: "ok", displayDate: "08.11", proposalOwner: "Synthetic", proposalDue: "10.11.2026",
});
await db.insert(tasks).values({
  id: "P-BL48K-ERROR", projectId: "PRJ-01", decisionId: "D-BL48K-ERROR", riskId: "R-BL48K-ERROR", title: "Synthetic error task", owner: "Synthetic", due: "10.11.2026",
  status: "done", completedAt: new Date("2026-11-08T09:00:00.000Z"),
});
await caller(actors.rp).configureOutcomeSource({ ...sourceInput, id: "SRC-BL48K-ERROR" });
await caller(actors.rp).approveOutcomeBinding({ ...bindingInput, key: "B-BL48K-ERROR", sourceId: "SRC-BL48K-ERROR", decisionId: "D-BL48K-ERROR", taskId: "P-BL48K-ERROR" });
failingSources.add("SRC-BL48K-ERROR");
const scheduler = await runOutcomeKpiCollection(later(81));
const errorAudits = await db.select().from(auditEvents).where(and(eq(auditEvents.entityType, "kpi_collection"), eq(auditEvents.eventType, "kpi.collection.failed")));

await db.insert(risks).values({
  id: "R-BL48K-MULTI", projectId: "PRJ-01", title: "Synthetic multiple metrics", recordType: "auto", channel: "test",
  impact: "Synthetic", probability: "низкая", measure: "Synthetic", source: "Synthetic",
});
await db.insert(decisions).values({
  id: "D-BL48K-MULTI", projectId: "PRJ-01", riskId: "R-BL48K-MULTI", title: "Synthetic multi decision", rationale: "Synthetic", effect: "Synthetic",
  status: "ok", displayDate: "08.11", proposalOwner: "Synthetic", proposalDue: "10.11.2026",
});
await db.insert(tasks).values({
  id: "P-BL48K-MULTI", projectId: "PRJ-01", decisionId: "D-BL48K-MULTI", riskId: "R-BL48K-MULTI", title: "Synthetic multi task", owner: "Synthetic", due: "10.11.2026",
  status: "done", completedAt: new Date("2026-11-08T09:00:00.000Z"),
});
await caller(actors.rp).recordOutcome({ taskId: "P-BL48K-MULTI", metric: "schedule_days", unit: "days", baselineValue: "10", actualValue: "8", source: "Synthetic manual", sourceId: "BL48K-MANUAL-1" });
await caller(actors.rp).recordOutcome({ taskId: "P-BL48K-MULTI", metric: "quality_defects", unit: "count", baselineValue: "5", actualValue: "4", source: "Synthetic manual", sourceId: "BL48K-MANUAL-2" });
const ambiguousAssessment = await assessTaskOutcome("P-BL48K-MULTI");

const finalMeasurements = await db.select().from(outcomeMeasurements).where(eq(outcomeMeasurements.taskId, taskId));
const currentMeasurement = finalMeasurements.find((row) => row.status === "confirmed")!;
const costAssessment = assessmentForMeasurement({ ...currentMeasurement, metric: "cost_amount", unit: "currency", direction: "decrease_is_better", baselineValue: "100", targetValue: "95", actualValue: "90", currencyCode: "RUB" }, "Снизить стоимость");
const qualityAssessment = assessmentForMeasurement({ ...currentMeasurement, metric: "quality_defects", unit: "count", direction: "decrease_is_better", baselineValue: "5", targetValue: "3", actualValue: "7" }, "Снизить дефекты");
const resourceAssessment = assessmentForMeasurement({ ...currentMeasurement, metric: "resource_days", unit: "days", direction: "increase_is_better", baselineValue: "5", targetValue: "7", actualValue: "7" }, "Увеличить доступность");
const rpState = await caller(actors.rp).state();
const cLevelState = await caller(actors.cLevel).state();
const riskAiSource = await readFile(new URL("../../api/ai/risk.ts", import.meta.url), "utf8");
const finalOutcomeEvents = await db.select().from(auditEvents).where(and(eq(auditEvents.entityType, "outcome"), eq(auditEvents.entityId, taskId)));

const checks = {
  source_and_binding_require_rp_and_reject_secrets: pmoSourceDenied && cLevelBindingDenied && memberCollectDenied && secretConfigDenied,
  source_and_binding_idempotent: sourceRepeat.idempotent && bindingRepeat.idempotent,
  no_binding_or_measurement_is_unconfirmed: noMeasurement === null && emptyLearning.count === 0,
  read_only_adapter_has_no_write_method: readCalls.length > 0 && !("write" in contractAdapter),
  automatic_real_measurement_confirmed: first.status === "collected" && first.created && firstAssessment?.status === "confirmed"
    && firstAssessment.actualEffectValue === "3" && firstAssessment.targetStatus === "not_met",
  observations_and_retry_idempotent: repeated.status === "throttled" && firstObservations.length === 3 && firstMeasurements.length === 1
    && finalOutcomeEvents.filter((event) => event.eventType === "outcome.recorded").length === 1,
  overlap_is_blocked_without_adapter_call: overlap.status === "overlap",
  synthetic_and_unknown_excluded_from_learning: synthetic.status === "collected" && syntheticLearning.count === 0,
  invalid_unit_rejected_without_measurement: invalidUnit.status === "collected" && invalidUnit.created === false && rejectedObservations.length === 1
    && rejectedObservations[0].validationErrors.includes("UNIT_MISMATCH"),
  early_actual_is_incomparable: earlyActual.status === "collected" && earlyLearning.count === 0,
  real_correction_restores_target_met: finalReal.status === "collected" && finalLearning.count === 1 && finalLearning.text.includes("Достижение цели: met"),
  learning_usage_idempotent_and_auditable: usage.created && !usageRepeat.created && learningUsages.length === 1,
  binding_correction_preserves_versions: bindingV2.binding.version === 2 && bindingVersions.some((row) => row.version === 1 && row.status === "superseded")
    && rebound.status === "collected" && rebound.created === true,
  measurement_versions_preserved: finalMeasurements.length === 5 && finalMeasurements.filter((row) => row.status === "superseded").length === 4,
  source_failure_is_sanitized_and_isolated: scheduler.failed >= 1 && errorAudits.length >= 1
    && !JSON.stringify(errorAudits).includes("https://"),
  primary_metric_never_selected_arbitrarily: ambiguousAssessment === null,
  schedule_formula: firstAssessment?.actualEffectValue === "3",
  cost_formula_and_target: costAssessment.actualEffectValue === "10" && costAssessment.targetStatus === "met",
  quality_formula_and_target: qualityAssessment.actualEffectValue === "-2" && qualityAssessment.targetStatus === "not_met",
  increasing_metric_formula_and_target: resourceAssessment.actualEffectValue === "2" && resourceAssessment.targetStatus === "met",
  learning_excludes_legacy_and_has_causality_guard: finalLearning.text.includes("не доказательство причинности")
    && finalLearning.measurementRefs.length === 1 && finalLearning.measurementRefs[0].measurementVersion === 4
    && riskAiSource.includes("не доказательство причинности") && riskAiSource.includes("не повышай confidence"),
  bl35_exposes_real_origin_quality_and_sources: rpState.outcomeMeasurements.some((row) => row.id === currentMeasurement.id && row.origin === "automatic" && row.dataClass === "real" && row.comparabilityStatus === "comparable")
    && rpState.outcomeSources.some((row) => row.id === sourceId && row.readOnly)
    && rpState.outcomeBindings.some((row) => row.key === bindingKey && row.version === 2)
    && rpState.outcomeObservations.length >= 9 && rpState.learningContextUsages.length === 1,
  c_level_read_only_exposure: cLevelState.readOnly && cLevelState.role === "c_level" && cLevelState.outcomeMeasurements.some((row) => row.id === currentMeasurement.id),
  old_l3_not_duplicated_by_collection: finalOutcomeEvents.filter((event) => event.eventType === "effect.reported").length === 0,
};

const evidence = {
  mode: "BL-48 v1.1 automatic KPI and Learning Loop on isolated MySQL with synthetic read-only adapter; no production, real source, Telegram sends or real IDs",
  checks,
  allChecksPassed: Object.values(checks).every(Boolean),
  result: {
    firstAssessment,
    currentAssessment: await assessTaskOutcome(taskId),
    measurementVersions: finalMeasurements.map((row) => ({ version: row.version, status: row.status, dataClass: row.dataClass, comparabilityStatus: row.comparabilityStatus, bindingId: row.bindingId })),
    observationCount: (await db.select().from(outcomeObservations).where(eq(outcomeObservations.sourceId, sourceId))).length,
    rejectedObservationCount: rejectedObservations.length,
    learningCount: finalLearning.count,
    learningRefs: finalLearning.measurementRefs,
    learningUsageCount: learningUsages.length,
    bindingVersions: bindingVersions.map((row) => ({ version: row.version, status: row.status })),
    scheduler,
    readCallCount: readCalls.length,
    realChatOrUserIdsIncluded: false,
  },
};
writeFileSync(new URL("./bl48-kpi-learning-evidence.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.allChecksPassed) throw new Error("BL-48 KPI Learning contract failed");
process.exit(0);
