import { readFileSync, writeFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import type { TrpcContext } from "../../api/context";
import { pmoRouter } from "../../api/pmo-router";
import { getDb } from "../../api/queries/connection";
import { DEMO_PROJECT_ID } from "../../api/queries/pmo";
import { collectOutcomeMetricBinding } from "../../api/queries/outcome-kpi";
import { assessTaskOutcome } from "../../api/queries/outcome";
import { buildLearningContext, recordLearningContextUsage } from "../../api/queries/learning-context";
import { decisions, projectCounters, projectMemberships, tasks, users } from "../../db/schema";

const registry = JSON.parse(readFileSync("/opt/plan-audit-bot/.credentials/bl6_registry.json", "utf8")) as { creds_path: string; spreadsheet_id: string };
process.env.BL6_REGISTRY_READONLY_CREDS_PATH = "/opt/aipmo-platform/current/.credentials/bl6-registry-service-account.json";
process.env.BL6_REGISTRY_READONLY_SPREADSHEET_ID = registry.spreadsheet_id;

const db = getDb();
const decisionId = "R-06";
const taskId = "P-07";
const sourceId = "SRC-BL6-REGISTRY";
const bindingKey = "B-BL48-P03";

const [membership] = await db.select({ user: users }).from(projectMemberships)
  .innerJoin(users, eq(projectMemberships.userId, users.id))
  .where(and(eq(projectMemberships.projectId, DEMO_PROJECT_ID), eq(projectMemberships.role, "rp"))).limit(1);
const actor = membership?.user;
if (!actor) throw new Error("RP actor is not configured");
const caller = pmoRouter.createCaller({ user: actor } as TrpcContext);

const [existingDecision] = await db.select().from(decisions).where(eq(decisions.id, decisionId)).limit(1);
const [existingTask] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
if (!existingDecision || !existingTask) {
  await db.transaction(async (tx) => {
    if (!existingDecision) {
      await tx.insert(projectCounters).values({ projectId: DEMO_PROJECT_ID, counterName: "decision", nextValue: 1 })
        .onDuplicateKeyUpdate({ set: { nextValue: sql`LAST_INSERT_ID(nextValue) + 1` } });
      const [counter] = await tx.select().from(projectCounters)
        .where(and(eq(projectCounters.projectId, DEMO_PROJECT_ID), eq(projectCounters.counterName, "decision"))).for("update").limit(1);
      const nextDecisionId = `R-${String(counter.nextValue).padStart(2, "0")}`;
      if (nextDecisionId !== decisionId) throw new Error(`Unexpected next decision ID: ${nextDecisionId}`);
      await tx.insert(decisions).values({
        id: decisionId,
        projectId: DEMO_PROJECT_ID,
        riskId: null,
        title: "Направить список тех.долга официальным письмом не позднее 19.08.2026",
        rationale: "Отдельный пилот BL-48 по реальной строке P-03 реестра BL-6",
        effect: "Сохранить базовый срок: направить список тех.долга официальным письмом не позднее 19.08.2026",
        status: "ok",
        displayDate: "18.08",
        proposalOwner: "Руководитель проекта",
        proposalDue: "19.08.2026",
        attribution: "Пиэмка · отдельный пилот BL-48",
        decidedAt: new Date("2026-08-18T00:00:00.000Z"),
      });
    }
    if (!existingTask) {
      await tx.insert(projectCounters).values({ projectId: DEMO_PROJECT_ID, counterName: "task", nextValue: 1 })
        .onDuplicateKeyUpdate({ set: { nextValue: sql`LAST_INSERT_ID(nextValue) + 1` } });
      const [counter] = await tx.select().from(projectCounters)
        .where(and(eq(projectCounters.projectId, DEMO_PROJECT_ID), eq(projectCounters.counterName, "task"))).for("update").limit(1);
      const nextTaskId = `P-${String(counter.nextValue).padStart(2, "0")}`;
      if (nextTaskId !== taskId) throw new Error(`Unexpected next task ID: ${nextTaskId}`);
      await tx.insert(tasks).values({
        id: taskId,
        projectId: DEMO_PROJECT_ID,
        decisionId,
        riskId: null,
        title: "Направить список тех.долга официальным письмом",
        owner: "Руководитель проекта",
        due: "19.08.2026",
        status: "done",
        source: "Отдельный пилот BL-48 · реестр BL-6 P-03",
        result: "Список тех.долга направлен официальным письмом 18.08.2026",
        completedAt: new Date("2026-08-18T00:00:00.000Z"),
        completedByName: "Руководитель проекта",
      });
    }
  });
}

const sourceResult = await caller.configureOutcomeSource({
  id: sourceId,
  type: "google_sheets",
  name: "BL-6 · Реестр поручений · read-only",
  connectionRef: "BL6_REGISTRY_READONLY",
  config: { range: "Реестр поручений!A:Z" },
  status: "active",
});
const bindingResult = await caller.approveOutcomeBinding({
  key: bindingKey,
  sourceId,
  decisionId,
  taskId,
  metric: "schedule_days",
  unit: "days",
  direction: "decrease_is_better",
  externalKey: "P-03",
  selectorConfig: { created: "Data sozdaniya", deadline: "Srok korr|Srok plan", closed: "Data zakrytiya" },
  isPrimary: true,
});

const firstCollection = await collectOutcomeMetricBinding(bindingKey);
const repeatCollection = await collectOutcomeMetricBinding(bindingKey);
const assessment = await assessTaskOutcome(taskId);
const learning = await buildLearningContext("schedule_days");
const learningUsage = await recordLearningContextUsage({
  proposalId: "D-BL48-PREVIEW",
  proposalVersion: 1,
  modelId: "preview-no-ai-call",
  context: learning,
});
const learningUsageRepeat = await recordLearningContextUsage({
  proposalId: "D-BL48-PREVIEW",
  proposalVersion: 1,
  modelId: "preview-no-ai-call",
  context: learning,
});
const state = await caller.state();
const measurements = state.outcomeMeasurements.filter((row) => row.taskId === taskId);
const observations = state.outcomeObservations.filter((row) => row.bindingId === bindingResult.binding.id);
const evidence = {
  scope: "BL-48 separate real pilot P-03 with read-only Google Sheets; no Telegram sends and no synthetic effect",
  decisionId,
  taskId,
  source: { id: sourceId, type: "google_sheets", readOnly: true, idempotent: sourceResult.idempotent },
  binding: { key: bindingKey, version: bindingResult.binding.version, idempotent: bindingResult.idempotent },
  firstCollection: {
    status: firstCollection.status,
    created: "created" in firstCollection ? firstCollection.created : null,
  },
  repeatCollection: { status: repeatCollection.status },
  assessment,
  observations: observations.map((row) => ({ role: row.role, value: row.value, unit: row.unit, dataClass: row.dataClass, validationStatus: row.validationStatus })),
  measurements: measurements.map((row) => ({ version: row.version, status: row.status, origin: row.origin, dataClass: row.dataClass, comparabilityStatus: row.comparabilityStatus })),
  learning: {
    count: learning.count,
    measurementRefs: learning.measurementRefs,
    includesTaskP07: learning.text.includes("P-07"),
    includesSourceRegistry: learning.text.includes("BL-6"),
    includesLegacySyntheticP06: learning.text.includes("P-06"),
    usageCreated: learningUsage.created,
    usageRepeatCreated: learningUsageRepeat.created,
    usageAuditCount: state.learningContextUsages.filter((row) => row.proposalId === "D-BL48-PREVIEW").length,
    previewModelId: "preview-no-ai-call",
  },
  bl35: {
    sourceVisible: state.outcomeSources.some((row) => row.id === sourceId && row.readOnly),
    bindingVisible: state.outcomeBindings.some((row) => row.key === bindingKey),
    measurementsVisible: measurements.length > 0,
  },
  spreadsheetIdIncluded: false,
  realChatOrUserIdsIncluded: false,
};
const evidencePath = process.env.BL48_PILOT_EVIDENCE_PATH || "/opt/aipmo-platform/bl48-real-pilot-evidence.json";
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(evidence, null, 2));
process.exit(0);
