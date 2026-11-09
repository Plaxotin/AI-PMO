import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { TrpcContext } from "../../api/context";
import { pmoRouter } from "../../api/pmo-router";
import {
  applyLogicChange,
  approveLogicChange,
  buildLearningMetrics,
  createGoldenRegressionCase,
  proposeLogicChange,
  rollbackLogicChange,
  runLogicRegression,
} from "../../api/queries/learning-metrics";
import { getDb } from "../../api/queries/connection";
import {
  commitmentCandidates,
  commitmentOutcomes,
  decisions,
  logicChangeProposals,
  outcomeMeasurements,
  projectMemberships,
  proposalVersions,
  tasks,
  users,
  type User,
} from "../../db/schema";

const db = getDb();
const actor = { userId: 201, name: "Synthetic RP", channel: "web" as const };
await db.insert(users).values({ unionId: "bl55-rp", name: "Synthetic RP", role: "user" });
const [rp] = await db.select().from(users).where(eq(users.unionId, "bl55-rp")).limit(1);
await db.insert(projectMemberships).values({ projectId: "PRJ-01", userId: rp.id, role: "rp" });
await db.insert(users).values({ unionId: "bl55-c-level", name: "Synthetic C-level", role: "admin" });
const [cLevel] = await db.select().from(users).where(eq(users.unionId, "bl55-c-level")).limit(1);
await db.insert(projectMemberships).values({ projectId: "PRJ-01", userId: cLevel.id, role: "c_level" });
const caller = (user: User) => pmoRouter.createCaller({ user } as TrpcContext);

// Isolated database only: remove earlier scenario rows so metric assertions are deterministic.
await db.delete(commitmentOutcomes);
await db.delete(commitmentCandidates);
await db.delete(outcomeMeasurements);
await db.delete(proposalVersions);
await db.delete(tasks);
await db.delete(decisions);

await db.insert(decisions).values([
  { id: "D-BL55-OK", projectId: "PRJ-01", riskId: null, title: "Accepted fixture", rationale: "Fixture", effect: "Effect", status: "ok", displayDate: "01.11", proposalOwner: "Owner", proposalDue: "20.11.2026" },
  { id: "D-BL55-NO", projectId: "PRJ-01", riskId: null, title: "Rejected fixture", rationale: "Fixture", effect: "Effect", status: "no", displayDate: "01.11", proposalOwner: "Owner", proposalDue: "20.11.2026" },
]);
await db.insert(proposalVersions).values({
  projectId: "PRJ-01", proposalId: "D-BL55-OK", version: 2, title: "Edited fixture", rationale: "Fixture", effect: "Effect", owner: "Owner", due: "20.11.2026",
  actorName: "Synthetic RP", actorRole: "rp", attribution: "Synthetic RP", editDistance: 27,
});
await db.insert(commitmentCandidates).values([
  { projectId: "PRJ-01", signalId: "S-BL55-A", decisionId: "D-BL55-OK", taskId: "P-BL55-A", title: "Accepted", owner: "Owner", due: "20.11.2026", confidence: 90, status: "accepted", evidenceHash: "a" },
  { projectId: "PRJ-01", signalId: "S-BL55-R", decisionId: "D-BL55-NO", title: "Rejected", owner: "Owner", due: "20.11.2026", confidence: 90, status: "rejected", rejectionReason: "not_commitment", evidenceHash: "r" },
  { projectId: "PRJ-01", signalId: "S-BL55-M", taskId: "P-BL55-M", title: "Merged", owner: "Owner", due: "20.11.2026", confidence: 90, status: "merged", evidenceHash: "m" },
  { projectId: "PRJ-01", signalId: "S-BL55-I", title: "Ignored", owner: "Owner", due: "20.11.2026", confidence: 90, status: "ignored", evidenceHash: "i" },
]);
await db.insert(commitmentOutcomes).values([
  { projectId: "PRJ-01", taskId: "P-BL55-A", decisionId: "D-BL55-OK", outcome: "on_time", resultText: "Done", source: "Fixture", sourceId: "P-BL55-A", recordedByUserId: 201, recordedByName: "Synthetic RP", recordedByRole: "rp", completedAt: new Date("2026-11-20T12:00:00Z") },
  { projectId: "PRJ-01", taskId: "P-BL55-L", decisionId: "D-BL55-OK", outcome: "late", resultText: "Late", source: "Fixture", sourceId: "P-BL55-L", recordedByUserId: 201, recordedByName: "Synthetic RP", recordedByRole: "rp", completedAt: new Date("2026-11-21T12:00:00Z") },
]);
await db.insert(outcomeMeasurements).values({
  projectId: "PRJ-01", taskId: "P-BL55-A", decisionId: "D-BL55-OK", metric: "schedule_days", unit: "days", baselineValue: "12", targetValue: "12", actualValue: "11",
  source: "Synthetic real source", sourceId: "BL55-REAL", status: "confirmed", version: 1, recordedByUserId: 201, recordedByName: "Synthetic RP", recordedByRole: "system",
  origin: "automatic", direction: "decrease_is_better", dataClass: "real", comparabilityStatus: "comparable",
});

const metrics = await buildLearningMetrics();
const emptyMetrics = await buildLearningMetrics("PRJ-EMPTY");
const golden = await createGoldenRegressionCase({
  id: "GC-BL55-1", question: "commitment confidence", input: "Подготовить отчёт до 15.11.2026", expected: { isCommitment: true }, sourceCorrectionId: "D-BL55-NO", modelId: "synthetic-model", version: "v1",
}, actor);
const goldenRepeat = await createGoldenRegressionCase({
  id: "GC-BL55-1", question: "commitment confidence", input: "Подготовить отчёт до 15.11.2026", expected: { isCommitment: true }, sourceCorrectionId: "D-BL55-NO", modelId: "synthetic-model", version: "v1",
}, actor);
const proposed = await proposeLogicChange({
  id: "LC-BL55-1", cluster: "not_commitment", question: "commitment confidence", currentVersion: "v1", proposedVersion: "v2", changeType: "threshold", rationale: "Слишком много ложных обязательств", evidenceRefs: [{ candidateId: "D-BL55-NO" }], expectedMetric: "rejectRate",
}, actor);
let applyBeforeRegressionDenied = false;
try { await applyLogicChange(proposed.proposal.id, actor); } catch { applyBeforeRegressionDenied = true; }
const approved = await approveLogicChange(proposed.proposal.id, actor);
const degraded = await runLogicRegression(proposed.proposal.id, "degrade");
let degradationBlocked = false;
try { await applyLogicChange(proposed.proposal.id, actor); } catch { degradationBlocked = true; }
const passed = await runLogicRegression(proposed.proposal.id, "default");
const applied = await applyLogicChange(proposed.proposal.id, actor);
const appliedRepeat = await applyLogicChange(proposed.proposal.id, actor);
const rolledBack = await rollbackLogicChange(proposed.proposal.id, actor);
const [proposalAfter] = await db.select().from(logicChangeProposals).where(eq(logicChangeProposals.id, proposed.proposal.id)).limit(1);
const state = await caller(rp).state();
let cLevelDenied = false;
try { await caller(cLevel).approveLogic({ id: proposed.proposal.id }); } catch { cLevelDenied = true; }

const checks = {
  metrics_acceptance_and_reject_rates: metrics.acceptanceRate === 0.5 && metrics.rejectRate === 0.5,
  metrics_edit_merge_ignore_rates: metrics.editRate === 1 && metrics.mergeRate === 0.25 && metrics.ignoredRate === 0.25,
  metrics_outcome_and_effect_rates: metrics.onTimeRate === 0.5 && metrics.confirmedEffectRate === 0.5,
  zero_denominator_is_null: emptyMetrics.acceptanceRate === null && emptyMetrics.onTimeRate === null,
  clusters_include_reasons: metrics.clusters.not_commitment === 1 && metrics.clusters.duplicate === 1 && metrics.clusters.ignored === 1,
  golden_case_idempotent: goldenRepeat.idempotent === true,
  proposal_has_baseline_metrics: proposed.proposal.baselineMetrics !== null,
  apply_before_regression_denied: applyBeforeRegressionDenied,
  approval_recorded: approved.approved === true,
  degradation_blocked: degraded.degraded === true && degradationBlocked,
  regression_pass_and_apply_idempotent: passed.passed === true && applied.applied === true && appliedRepeat.idempotent === true,
  rollback_restores_version_and_status: rolledBack.restoredVersion === "v1" && proposalAfter.status === "rolled_back",
  state_exposes_metrics_proposals_cases: state.learningMetrics !== null && state.logicChangeProposals.some((row) => row.id === proposed.proposal.id) && state.goldenRegressionCases.some((row) => row.id === "GC-BL55-1"),
  c_level_cannot_change_logic: cLevelDenied && state.readOnly !== true,
};

const evidence = {
  mode: "BL-55 Learning Loop on isolated MySQL with synthetic fixtures; no production or real AI calls",
  checks,
  allChecksPassed: Object.values(checks).every(Boolean),
  result: {
    metrics,
    degraded,
    passed,
    appliedRepeat,
    rolledBack,
    proposalStatus: proposalAfter.status,
    cLevelDenied,
  },
  realChatOrUserIdsIncluded: false,
};
writeFileSync(new URL("./bl55-learning-loop-evidence.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.allChecksPassed) throw new Error("BL-55 learning loop contract failed");
process.exit(0);
