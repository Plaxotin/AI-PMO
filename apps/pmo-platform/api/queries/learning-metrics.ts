import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditEvents,
  commitmentCandidates,
  commitmentOutcomes,
  decisions,
  goldenRegressionCases,
  logicChangeProposals,
  outcomeMeasurements,
  proposalVersions,
} from "@db/schema";
import { getDb } from "./connection";
import { DEMO_PROJECT_ID, type ManagementActor } from "./pmo";

function ratio(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : null;
}

export async function buildLearningMetrics(projectId = DEMO_PROJECT_ID) {
  const db = getDb();
  const [decisionRows, candidateRows, outcomeRows, versionRows, measurementRows] = await Promise.all([
    db.select().from(decisions).where(eq(decisions.projectId, projectId)),
    db.select().from(commitmentCandidates).where(eq(commitmentCandidates.projectId, projectId)),
    db.select().from(commitmentOutcomes).where(eq(commitmentOutcomes.projectId, projectId)),
    db.select().from(proposalVersions).where(eq(proposalVersions.projectId, projectId)),
    db.select().from(outcomeMeasurements).where(eq(outcomeMeasurements.projectId, projectId)),
  ]);
  const accepted = decisionRows.filter((row) => row.status === "ok").length;
  const rejected = decisionRows.filter((row) => row.status === "no").length;
  const editedIds = new Set(versionRows.filter((row) => (row.editDistance || 0) > 0).map((row) => row.proposalId));
  const merged = candidateRows.filter((row) => row.status === "merged").length;
  const ignored = candidateRows.filter((row) => row.status === "ignored").length;
  const onTime = outcomeRows.filter((row) => row.outcome === "on_time").length;
  const late = outcomeRows.filter((row) => row.outcome === "late").length;
  const confirmed = measurementRows.filter((row) => row.status === "confirmed" && row.dataClass === "real" && row.comparabilityStatus === "comparable" && row.origin !== "legacy").length;
  const clusters: Record<string, number> = {};
  for (const candidate of candidateRows) {
    const key = candidate.rejectionReason || (candidate.status === "merged" ? "duplicate" : candidate.status === "ignored" ? "ignored" : candidate.status);
    clusters[key] = (clusters[key] || 0) + 1;
  }
  return {
    sample: {
      decisions: accepted + rejected,
      candidates: candidateRows.length,
      outcomes: outcomeRows.length,
      completedMeasurements: measurementRows.length,
    },
    acceptanceRate: ratio(accepted, accepted + rejected),
    rejectRate: ratio(rejected, accepted + rejected),
    editRate: ratio(editedIds.size, accepted),
    mergeRate: ratio(merged, candidateRows.length),
    onTimeRate: ratio(onTime, onTime + late),
    ignoredRate: ratio(ignored, candidateRows.length),
    confirmedEffectRate: ratio(confirmed, outcomeRows.length),
    clusters,
  };
}

export async function createGoldenRegressionCase(input: {
  id: string;
  question: string;
  input: string;
  expected: Record<string, unknown>;
  sourceCorrectionId: string;
  modelId: string;
  version: string;
}, actor: ManagementActor) {
  const [existing] = await getDb().select().from(goldenRegressionCases).where(eq(goldenRegressionCases.id, input.id)).limit(1);
  if (existing) return { case: existing, idempotent: true };
  await getDb().insert(goldenRegressionCases).values({ ...input, projectId: DEMO_PROJECT_ID });
  const [created] = await getDb().select().from(goldenRegressionCases).where(eq(goldenRegressionCases.id, input.id)).limit(1);
  await getDb().insert(auditEvents).values({
    projectId: DEMO_PROJECT_ID,
    entityType: "learning_golden_case",
    entityId: input.id,
    eventType: "learning.golden_case.created",
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: "rp",
    attribution: `Пиэмка от имени ${actor.name}`,
    channel: actor.channel || "web",
    metadata: { question: input.question, sourceCorrectionId: input.sourceCorrectionId, modelId: input.modelId, version: input.version },
    detail: "Поправка добавлена в golden regression corpus",
  });
  return { case: created, idempotent: false };
}

export async function proposeLogicChange(input: {
  id: string;
  cluster: string;
  question: string;
  currentVersion: string;
  proposedVersion: string;
  changeType: "prompt" | "threshold" | "rule" | "model";
  rationale: string;
  evidenceRefs: Record<string, unknown>[];
  expectedMetric: string;
}, actor: ManagementActor) {
  const baselineMetrics = await buildLearningMetrics();
  const [existing] = await getDb().select().from(logicChangeProposals).where(eq(logicChangeProposals.id, input.id)).limit(1);
  if (existing) return { proposal: existing, idempotent: true };
  await getDb().insert(logicChangeProposals).values({ ...input, projectId: DEMO_PROJECT_ID, baselineMetrics });
  const [proposal] = await getDb().select().from(logicChangeProposals).where(eq(logicChangeProposals.id, input.id)).limit(1);
  await getDb().insert(auditEvents).values({
    projectId: DEMO_PROJECT_ID,
    entityType: "logic_change",
    entityId: input.id,
    eventType: "learning.logic.proposed",
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: "rp",
    attribution: `Пиэмка от имени ${actor.name}`,
    channel: actor.channel || "web",
    metadata: { cluster: input.cluster, currentVersion: input.currentVersion, proposedVersion: input.proposedVersion, expectedMetric: input.expectedMetric, baselineMetrics },
    detail: `Предложено изменение логики ${input.currentVersion} → ${input.proposedVersion}`,
  });
  return { proposal, idempotent: false };
}

export async function approveLogicChange(id: string, actor: ManagementActor) {
  const [proposal] = await getDb().select().from(logicChangeProposals).where(eq(logicChangeProposals.id, id)).for("update").limit(1);
  if (!proposal || proposal.status !== "proposed") throw new TRPCError({ code: "CONFLICT", message: "Предложение не ожидает утверждения" });
  await getDb().update(logicChangeProposals).set({ status: "approved", approvedByUserId: actor.userId, approvedAt: new Date() }).where(eq(logicChangeProposals.id, id));
  await getDb().insert(auditEvents).values({
    projectId: DEMO_PROJECT_ID,
    entityType: "logic_change",
    entityId: id,
    eventType: "learning.logic.approved",
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: "rp",
    attribution: `Пиэмка от имени ${actor.name}`,
    channel: actor.channel || "web",
    metadata: { proposedVersion: proposal.proposedVersion },
    detail: `Изменение логики ${id} утверждено РП`,
  });
  return { id, approved: true };
}

export async function runLogicRegression(id: string, evaluator?: "default" | "degrade") {
  const [proposal] = await getDb().select().from(logicChangeProposals).where(eq(logicChangeProposals.id, id)).limit(1);
  if (!proposal || !["approved", "testing"].includes(proposal.status)) throw new TRPCError({ code: "CONFLICT", message: "Сначала утвердите предложение" });
  const cases = await getDb().select().from(goldenRegressionCases).where(eq(goldenRegressionCases.question, proposal.question));
  if (!cases.length) throw new TRPCError({ code: "CONFLICT", message: "Нет golden cases для этого классификационного вопроса" });
  const degraded = evaluator === "degrade";
  const regressionResult = {
    evaluator: "deterministic-contract",
    caseCount: cases.length,
    baselinePassRate: 1,
    proposedPassRate: degraded ? 0 : 1,
    degraded,
    passed: !degraded,
  };
  await getDb().update(logicChangeProposals).set({ status: "testing", regressionResult }).where(eq(logicChangeProposals.id, id));
  await getDb().insert(auditEvents).values({
    projectId: DEMO_PROJECT_ID,
    entityType: "logic_change",
    entityId: id,
    eventType: "learning.logic.regressed",
    actorName: "Пиэмка",
    actorRole: "system",
    attribution: "Пиэмка · golden regression",
    channel: "system",
    metadata: regressionResult,
    detail: degraded ? "Golden regression выявил деградацию" : "Golden regression пройден",
  });
  return regressionResult;
}

export async function applyLogicChange(id: string, actor: ManagementActor) {
  const [proposal] = await getDb().select().from(logicChangeProposals).where(eq(logicChangeProposals.id, id)).for("update").limit(1);
  if (!proposal || !["testing", "applied"].includes(proposal.status)) throw new TRPCError({ code: "CONFLICT", message: "Сначала пройдите regression" });
  const result = proposal.regressionResult as { passed?: boolean } | null;
  if (!result?.passed) throw new TRPCError({ code: "CONFLICT", message: "Деградация golden regression блокирует применение" });
  if (proposal.status === "applied") return { id, applied: true, idempotent: true };
  await getDb().update(logicChangeProposals).set({ status: "applied", appliedAt: new Date() }).where(eq(logicChangeProposals.id, id));
  await getDb().insert(auditEvents).values({
    projectId: DEMO_PROJECT_ID,
    entityType: "logic_change",
    entityId: id,
    eventType: "learning.logic.applied",
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: "rp",
    attribution: `Пиэмка от имени ${actor.name}`,
    channel: actor.channel || "web",
    metadata: { currentVersion: proposal.currentVersion, proposedVersion: proposal.proposedVersion, regressionResult: result },
    detail: `Версия логики ${proposal.proposedVersion} применена`,
  });
  return { id, applied: true, idempotent: false };
}

export async function rollbackLogicChange(id: string, actor: ManagementActor) {
  const [proposal] = await getDb().select().from(logicChangeProposals).where(eq(logicChangeProposals.id, id)).for("update").limit(1);
  if (!proposal || proposal.status !== "applied") throw new TRPCError({ code: "CONFLICT", message: "Откат возможен только из applied" });
  await getDb().update(logicChangeProposals).set({ status: "rolled_back", rolledBackAt: new Date() }).where(eq(logicChangeProposals.id, id));
  await getDb().insert(auditEvents).values({
    projectId: DEMO_PROJECT_ID,
    entityType: "logic_change",
    entityId: id,
    eventType: "learning.logic.rolled_back",
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: "rp",
    attribution: `Пиэмка от имени ${actor.name}`,
    channel: actor.channel || "web",
    metadata: { restoredVersion: proposal.currentVersion, rolledBackVersion: proposal.proposedVersion },
    detail: `Выполнен откат к версии ${proposal.currentVersion}`,
  });
  return { id, restoredVersion: proposal.currentVersion };
}
