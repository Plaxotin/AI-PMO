import { writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import type { TrpcContext } from "../../api/context";
import { pmoRouter } from "../../api/pmo-router";
import {
  acceptCommitmentCandidate,
  commitmentSimilarity,
  createCommitmentCandidate,
  mergeCommitmentCandidate,
  recordCommitmentOutcome,
  rejectCommitmentCandidate,
} from "../../api/queries/commitment";
import { getDb } from "../../api/queries/connection";
import { getRiskProposal } from "../../api/queries/telegram";
import { proposalButtons, proposalText } from "../../api/routes/telegram";
import {
  auditEvents,
  commitmentCandidates,
  commitmentOutcomes,
  decisions,
  projectMemberships,
  signals,
  tasks,
  users,
  type User,
} from "../../db/schema";

const db = getDb();
const actorName = "Synthetic RP";
const actor = { userId: 101, name: actorName, channel: "telegram" as const };

await db.insert(users).values({ unionId: "bl50-rp", name: actorName, role: "user" });
const [rp] = await db.select().from(users).where(eq(users.unionId, "bl50-rp")).limit(1);
await db.insert(projectMemberships).values({ projectId: "PRJ-01", userId: rp.id, role: "rp" });
await db.insert(users).values({ unionId: "bl50-c-level", name: "Synthetic C-level", role: "admin" });
const [cLevel] = await db.select().from(users).where(eq(users.unionId, "bl50-c-level")).limit(1);
await db.insert(projectMemberships).values({ projectId: "PRJ-01", userId: cLevel.id, role: "c_level" });
const caller = (user: User) => pmoRouter.createCaller({ user } as TrpcContext);

await db.insert(signals).values([
  { id: "S-BL50-NEW", projectId: "PRJ-01", channel: "telegram", channelId: "CH-BL50", chatId: "-100500", messageId: 501, authorId: "member", authorName: "Synthetic member", content: "Подготовить отчёт для спонсора до 15.11.2026", status: "processing" },
  { id: "S-BL50-REJECT", projectId: "PRJ-01", channel: "telegram", channelId: "CH-BL50", chatId: "-100500", messageId: 502, authorId: "member", authorName: "Synthetic member", content: "Обычное обсуждение", status: "processing" },
  { id: "S-BL50-MERGE", projectId: "PRJ-01", channel: "telegram", channelId: "CH-BL50", chatId: "-100500", messageId: 503, authorId: "member", authorName: "Synthetic member", content: "Подготовить отчёт для спонсора до 20.11.2026", status: "processing" },
  { id: "S-BL50-UPDATE", projectId: "PRJ-01", channel: "telegram", channelId: "CH-BL50", chatId: "-100500", messageId: 504, authorId: "member", authorName: "Synthetic member", content: "Перенести отчёт для спонсора на 25.11.2026", status: "processing" },
]);
await db.insert(decisions).values({
  id: "D-BL50-EXIST", projectId: "PRJ-01", riskId: null, title: "Подготовить отчёт для спонсора", rationale: "Existing fixture", effect: "Отчёт в срок",
  status: "ok", displayDate: "01.11", proposalOwner: "Synthetic owner", proposalDue: "20.11.2026",
});
await db.insert(tasks).values({
  id: "P-BL50-EXIST", projectId: "PRJ-01", decisionId: "D-BL50-EXIST", riskId: null, title: "Подготовить отчёт для спонсора", owner: "Synthetic owner", due: "20.11.2026", status: "new",
});

const newCandidate = await createCommitmentCandidate({
  signalId: "S-BL50-NEW", title: "Подготовить отчёт для спонсора до 15.11.2026", owner: "Synthetic owner", due: "15.11.2026", confidence: 0.94, changeType: "create", evidenceHash: "hash-new",
});
const repeatedCandidate = await createCommitmentCandidate({
  signalId: "S-BL50-NEW", title: "Подготовить отчёт для спонсора до 15.11.2026", owner: "Synthetic owner", due: "15.11.2026", confidence: 0.94, changeType: "create", evidenceHash: "hash-new",
});
const proposalBundle = await getRiskProposal(newCandidate.decisionId!);
const commitmentCard = proposalBundle ? proposalText(proposalBundle) : "";
const commitmentButtonLabels = proposalButtons(newCandidate.decisionId!, "").flat().map((button) => button.text);
const accepted = await acceptCommitmentCandidate({ decisionId: newCandidate.decisionId!, due: "16.11.2026", expectedVersion: 1 }, actor);
const newTaskCount = (await db.select().from(tasks).where(eq(tasks.decisionId, newCandidate.decisionId!))).length;
const [acceptedCandidate] = await db.select().from(commitmentCandidates).where(eq(commitmentCandidates.id, newCandidate.candidate.id)).limit(1);
const [acceptedTask] = await db.select().from(tasks).where(eq(tasks.decisionId, newCandidate.decisionId!)).limit(1);
const [acceptedDecision] = await db.select().from(decisions).where(eq(decisions.id, newCandidate.decisionId!)).limit(1);
const [newSignal] = await db.select().from(signals).where(eq(signals.id, "S-BL50-NEW")).limit(1);

const rejectedCandidate = await createCommitmentCandidate({
  signalId: "S-BL50-REJECT", title: "Согласовать встречу до 16.11.2026", owner: "Synthetic owner", due: "16.11.2026", confidence: 0.9, changeType: "create", evidenceHash: "hash-reject",
});
const rejected = await rejectCommitmentCandidate(rejectedCandidate.decisionId!, "not_commitment", actor);
const rejectedTaskCount = (await db.select().from(tasks).where(eq(tasks.decisionId, rejectedCandidate.decisionId!))).length;
const rejectedState = await db.select().from(commitmentCandidates).where(eq(commitmentCandidates.id, rejectedCandidate.candidate.id));

const mergeCandidate = await createCommitmentCandidate({
  signalId: "S-BL50-MERGE", title: "Подготовить отчёт для спонсора", owner: "Synthetic owner", due: "20.11.2026", confidence: 0.92, changeType: "create", evidenceHash: "hash-merge",
});
const merged = await mergeCommitmentCandidate(mergeCandidate.candidate.id, actor);
const mergeDecisionCount = mergeCandidate.decisionId ? 1 : 0;

const updateCandidate = await createCommitmentCandidate({
  signalId: "S-BL50-UPDATE", title: "Перенести отчёт для спонсора на 25.11.2026", owner: "Synthetic owner", due: "25.11.2026", confidence: 0.96, changeType: "update", existingTaskId: "P-BL50-EXIST", evidenceHash: "hash-update",
});
const updated = await acceptCommitmentCandidate({ decisionId: updateCandidate.decisionId!, due: "25.11.2026", expectedVersion: 1 }, actor);
const [updatedTask] = await db.select().from(tasks).where(eq(tasks.id, "P-BL50-EXIST")).limit(1);
const [updatedCandidate] = await db.select().from(commitmentCandidates).where(eq(commitmentCandidates.id, updateCandidate.candidate.id)).limit(1);
const updateEvents = await db.select().from(auditEvents).where(and(eq(auditEvents.entityType, "commitment"), eq(auditEvents.entityId, String(updateCandidate.candidate.id))));

await db.update(tasks).set({ status: "done", completedAt: new Date("2026-11-21T12:00:00.000Z"), completedByName: actorName, result: "Отчёт готов" }).where(eq(tasks.id, "P-BL50-EXIST"));
const onTime = await recordCommitmentOutcome("P-BL50-EXIST", actor);
const onTimeRepeat = await recordCommitmentOutcome("P-BL50-EXIST", actor);
await db.update(tasks).set({ completedAt: new Date("2026-11-26T12:00:00.000Z") }).where(eq(tasks.id, "P-BL50-EXIST"));
const late = await recordCommitmentOutcome("P-BL50-EXIST", actor);
await db.insert(tasks).values({ id: "P-BL50-UNKNOWN", projectId: "PRJ-01", decisionId: null, riskId: null, title: "Synthetic unknown outcome", owner: "Synthetic owner", due: "—", status: "done", completedAt: new Date("2026-11-21T12:00:00.000Z") });
const unknown = await recordCommitmentOutcome("P-BL50-UNKNOWN", actor);
const state = await caller(rp).state();
const cLevelState = await caller(cLevel).state();
const outcomeAudit = await db.select().from(auditEvents).where(and(eq(auditEvents.entityType, "commitment"), eq(auditEvents.entityId, "P-BL50-EXIST"), eq(auditEvents.eventType, "commitment.outcome.recorded")));
const allCandidates = await db.select().from(commitmentCandidates);

const checks = {
  valid_commitment_creates_one_candidate_and_task: newCandidate.candidate.status === "pending"
    && newTaskCount === 1
    && Boolean(accepted.taskId)
    && acceptedCandidate.due === "16.11.2026"
    && acceptedTask.due === "16.11.2026"
    && newSignal.status === "commitment_created"
    && !acceptedDecision.rationale.includes("S-BL50-NEW")
    && commitmentCard.includes("https://t.me/c/500/501")
    && commitmentCard.includes("Synthetic member")
    && commitmentCard.includes("Подготовить отчёт для спонсора до 15.11.2026")
    && !commitmentCard.includes("Риск")
    && !commitmentCard.includes("S-BL50-NEW")
    && !commitmentButtonLabels.some((label) => label.includes("Риск")),
  same_evidence_is_idempotent: repeatedCandidate.idempotent && repeatedCandidate.candidate.id === newCandidate.candidate.id,
  reject_requires_reason_and_no_task: rejected.status === "no" && rejectedTaskCount === 0 && rejectedState[0].rejectionReason === "not_commitment",
  merge_instead_of_duplicate: mergeCandidate.candidate.status === "pending_merge" && mergeDecisionCount === 0 && merged.taskId === "P-BL50-EXIST" && merged.merged,
  update_changes_existing_due_without_new_task: updated.taskId === "P-BL50-EXIST" && updatedTask.due === "25.11.2026" && updatedCandidate.due === "25.11.2026",
  update_has_old_new_and_edit_distance: updateEvents.some((event) => event.eventType === "commitment.rescheduled"
    && (event.metadata as { oldDue?: string }).oldDue === "20.11.2026"
    && (event.metadata as { newDue?: string }).newDue === "25.11.2026"
    && (event.metadata as { editDistance?: number }).editDistance !== undefined),
  on_time_outcome: onTime.outcome.outcome === "on_time" && onTimeRepeat.idempotent,
  late_outcome: late.outcome.outcome === "late" && late.outcome.resultText === "Отчёт готов",
  unknown_outcome: unknown.outcome.outcome === "unknown",
  outcome_audit_not_duplicated: outcomeAudit.length === 1,
  candidate_lifecycle_completed: allCandidates.some((row) => row.taskId === "P-BL50-EXIST" && row.status === "completed"),
  bl35_exposes_candidates_and_outcomes: state.commitmentCandidates.length >= 4 && state.commitmentOutcomes.some((row) => row.taskId === "P-BL50-EXIST" && row.outcome === "late"),
  c_level_read_only: cLevelState.readOnly && cLevelState.commitmentCandidates.length >= 4,
  similarity_threshold: commitmentSimilarity("Подготовить отчёт для спонсора", "Подготовить отчёт для спонсора") === 1 && commitmentSimilarity("Обычное обсуждение", "Подготовить отчёт") < 0.92,
  all_candidates_have_source_and_evidence: allCandidates.every((row) => row.signalId && row.evidenceHash && row.evidenceVersion >= 1),
};

const evidence = {
  mode: "BL-50 Commitment Tracking on isolated MySQL with synthetic fixtures; no production, real Telegram sends or real IDs",
  checks,
  allChecksPassed: Object.values(checks).every(Boolean),
  result: {
    acceptedTaskId: accepted.taskId,
    rejectedTaskCount,
    mergedTaskId: merged.taskId,
    updatedDue: updatedTask.due,
    onTime: onTime.outcome.outcome,
    late: late.outcome.outcome,
    unknown: unknown.outcome.outcome,
    outcomeAuditCount: outcomeAudit.length,
    candidateCount: allCandidates.length,
  },
  realChatOrUserIdsIncluded: false,
};
writeFileSync(new URL("./bl50-commitment-evidence.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.allChecksPassed) throw new Error("BL-50 commitment contract failed");
process.exit(0);
