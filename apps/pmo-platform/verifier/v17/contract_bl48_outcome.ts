import { writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import type { TrpcContext } from "../../api/context";
import { pmoRouter } from "../../api/pmo-router";
import { assessTaskOutcome } from "../../api/queries/outcome";
import { deliverEffectNotification } from "../../api/telegram/completion-scheduler";
import { getDb } from "../../api/queries/connection";
import { auditEvents, decisions, outcomeMeasurements, projectMemberships, risks, tasks, telegramCompletionChecks, users, type User } from "../../db/schema";

const db = getDb();
const taskId = "P-BL48-TEST";
const decisionId = "D-BL48-TEST";
const riskId = "R-BL48-TEST";
const baseInput = {
  taskId,
  metric: "schedule_days" as const,
  unit: "days" as const,
  baselineValue: "10",
  targetValue: "8",
  actualValue: "8",
  source: "Synthetic project schedule measurement",
  sourceId: "BL48-SYNTHETIC-001",
  sourceUrl: "https://example.test/outcome",
};
await db.insert(risks).values({
  id: riskId, projectId: "PRJ-01", title: "Synthetic BL-48 risk", recordType: "auto", channel: "telegram",
  impact: "Synthetic schedule impact", probability: "средняя", confidence: 90, measure: "Synthetic mitigation", source: "Synthetic BL-48 fixture",
});
await db.insert(decisions).values({
  id: decisionId, projectId: "PRJ-01", riskId, title: "Synthetic BL-48 decision", rationale: "Synthetic rationale", effect: "Сократить срок на 2 дня",
  status: "ok", displayDate: "08.11", proposalOwner: "Synthetic owner", proposalDue: "10.11.2026",
});
await db.insert(tasks).values({
  id: taskId, projectId: "PRJ-01", decisionId, riskId, title: "Synthetic completed BL-48 task", owner: "Synthetic owner", due: "10.11.2026",
  status: "done", result: "Synthetic result", completedByName: "Synthetic RP",
});

const roleFixtures = [
  { key: "rp", role: "rp", platformRole: "user" },
  { key: "pmo", role: "pmo", platformRole: "admin" },
  { key: "cLevel", role: "c_level", platformRole: "admin" },
] as const;
const actors = {} as Record<(typeof roleFixtures)[number]["key"], User>;
for (const fixture of roleFixtures) {
  const unionId = `bl48-${fixture.key}`;
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

const noMeasurement = await assessTaskOutcome(taskId);
const pmoDenied = await expectCode(() => caller(actors.pmo).recordOutcome(baseInput), "FORBIDDEN");
const cLevelDenied = await expectCode(() => caller(actors.cLevel).recordOutcome(baseInput), "FORBIDDEN");
const invalidBaseline = await expectCode(() => caller(actors.rp).recordOutcome({ ...baseInput, baselineValue: "not-a-number" }), "BAD_REQUEST");
const first = await caller(actors.rp).recordOutcome(baseInput);
const repeated = await caller(actors.rp).recordOutcome(baseInput);
const firstVersions = await db.select().from(outcomeMeasurements).where(eq(outcomeMeasurements.taskId, taskId));
const firstOutcomeEvents = await db.select().from(auditEvents).where(and(eq(auditEvents.entityType, "outcome"), eq(auditEvents.entityId, taskId)));
const corrected = await caller(actors.rp).recordOutcome({ ...baseInput, actualValue: "7", measurementId: first.measurement.id });
const versions = await db.select().from(outcomeMeasurements).where(eq(outcomeMeasurements.taskId, taskId));
const outcomeEvents = await db.select().from(auditEvents).where(and(eq(auditEvents.entityType, "outcome"), eq(auditEvents.entityId, taskId)));
const state = await caller(actors.rp).state();
const cLevelState = await caller(actors.cLevel).state();
const taskState = state.tasks.find((item) => item.id === taskId);

await db.insert(telegramCompletionChecks).values({
  taskId,
  dueVersion: "2026-11-10",
  chatId: "978400001",
  userId: "978400001",
  status: "done",
  effectStatus: "pending",
});
const [completion] = await db.select().from(telegramCompletionChecks).where(eq(telegramCompletionChecks.taskId, taskId)).limit(1);
process.env.TELEGRAM_BOT_TOKEN = "synthetic-bl48-token";
process.env.TELEGRAM_WEBHOOK_SECRET = "synthetic-bl48-secret";
process.env.TELEGRAM_PROJECT_CHAT_IDS = "-100978400001";
process.env.TELEGRAM_RP_USER_IDS = "978400001";
process.env.TELEGRAM_API_BASE_URL = "http://synthetic-telegram";
process.env.TELEGRAM_GATEWAY_SECRET = "";
const telegramCalls: Record<string, unknown>[] = [];
globalThis.fetch = async (_input, init) => {
  const payload = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
  telegramCalls.push(payload);
  return new Response(JSON.stringify({ ok: true, result: { message_id: 9100 + telegramCalls.length } }), { status: 200 });
};
const firstEffect = await deliverEffectNotification(completion.id);
const repeatedEffect = await deliverEffectNotification(completion.id);
const [completionAfter] = await db.select().from(telegramCompletionChecks).where(eq(telegramCompletionChecks.id, completion.id)).limit(1);
const correctedEvent = outcomeEvents.find((event) => event.eventType === "outcome.corrected");
const effectEvent = await db.select().from(auditEvents).where(and(eq(auditEvents.entityType, "effect"), eq(auditEvents.entityId, taskId))).limit(1);

const checks = {
  no_measurement_is_not_confirmed: noMeasurement === null,
  pmo_and_c_level_cannot_record: pmoDenied && cLevelDenied,
  invalid_baseline_rejected: invalidBaseline,
  valid_measurement_confirms_numeric_effect: first.assessment.status === "confirmed"
    && first.assessment.text.includes("−2")
    && first.assessment.basis.includes("baseline 10")
    && first.assessment.basis.includes("actual 8")
    && first.assessment.basis.includes("BL48-SYNTHETIC-001"),
  identical_retry_is_idempotent: repeated.idempotent === true && firstVersions.length === 1
    && firstOutcomeEvents.filter((event) => event.eventType === "outcome.recorded").length === 1,
  correction_creates_version_two_and_preserves_original: corrected.measurement.version === 2
    && corrected.assessment.text.includes("−3")
    && versions.length === 2
    && versions.some((row) => row.version === 1 && row.status === "superseded")
    && versions.some((row) => row.version === 2 && row.previousVersionId === first.measurement.id)
    && outcomeEvents.filter((event) => event.eventType === "outcome.corrected").length === 1,
  audit_has_rp_attribution_and_source: Boolean(correctedEvent)
    && correctedEvent.actorRole === "rp"
    && correctedEvent.version === 2
    && (correctedEvent.metadata as { sourceId?: string }).sourceId === "BL48-SYNTHETIC-001",
  effect_audit_uses_measured_assessment: effectEvent.length === 1
    && (effectEvent[0].metadata as { effectStatus?: string }).effectStatus === "confirmed"
    && String((effectEvent[0].metadata as { effect?: string }).effect || "").includes("−3"),
  bl35_exposes_measurement_and_assessment: state.outcomeMeasurements.some((row) => row.taskId === taskId && row.version === 2)
    && taskState?.effectAssessment?.status === "confirmed"
    && taskState.effectAssessment.measurementVersion === 2,
  c_level_is_read_only: cLevelState.readOnly === true && cLevelState.role === "c_level",
  l3_uses_measured_effect_once: firstEffect === true
    && repeatedEffect === false
    && telegramCalls.length === 1
    && String(telegramCalls[0].text || "").includes("−3")
    && String(telegramCalls[0].text || "").includes("BL48-SYNTHETIC-001")
    && completionAfter.effectStatus === "sent",
};

const evidence = {
  mode: "BL-48 outcome measurements and L3 on isolated MySQL with synthetic users/fixtures and mock Telegram; no production connection or real sends",
  checks,
  allChecksPassed: Object.values(checks).every(Boolean),
  result: {
    noMeasurement,
    firstAssessment: first.assessment,
    correctedAssessment: corrected.assessment,
    versions: versions.map((row) => ({ version: row.version, status: row.status, previousVersionId: row.previousVersionId })),
    outcomeEventTypes: outcomeEvents.map((row) => row.eventType),
    firstEffect,
    repeatedEffect,
    telegramCalls: telegramCalls.length,
  },
};
writeFileSync(new URL("./bl48-outcome-evidence.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.allChecksPassed) throw new Error("BL-48 outcome contract failed");
process.exit(0);
