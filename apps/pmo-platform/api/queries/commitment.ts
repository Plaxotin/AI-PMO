import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditEvents,
  commitmentCandidates,
  commitmentOutcomes,
  decisions,
  projectCounters,
  proposalVersions,
  signals,
  tasks,
} from "@db/schema";
import { getDb } from "./connection";
import { DEMO_PROJECT_ID, decideProposalRecord, type ManagementActor } from "./pmo";
import { buildProposalDiff, telegramSourceLink, type ProposalSnapshot } from "./proposal-audit";
import { assessTaskOutcome } from "./outcome";

export type CommitmentCandidateInput = {
  signalId: string;
  title: string;
  owner: string;
  due: string;
  confidence: number;
  changeType: "create" | "update";
  existingTaskId?: string;
  evidenceVersion?: number;
  evidenceHash: string;
};

function normalizedTokens(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-zа-я0-9]+/gi, " ").split(/\s+/).filter((token) => token.length > 2));
}

export function commitmentSimilarity(a: string, b: string) {
  const left = normalizedTokens(a);
  const right = normalizedTokens(b);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function dueDate(value: string) {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/) || value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = match[1].length === 4 ? new Date(`${match[1]}-${match[2]}-${match[3]}T23:59:59.999Z`) : new Date(`${match[3]}-${match[2]}-${match[1]}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function nextDecisionId(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]) {
  await tx.insert(projectCounters).values({ projectId: DEMO_PROJECT_ID, counterName: "decision", nextValue: 1 })
    .onDuplicateKeyUpdate({ set: { nextValue: sql`LAST_INSERT_ID(nextValue) + 1` } });
  const [counter] = await tx.select().from(projectCounters)
    .where(and(eq(projectCounters.projectId, DEMO_PROJECT_ID), eq(projectCounters.counterName, "decision"))).for("update").limit(1);
  if (!counter) throw new Error("Не удалось получить следующий номер решения");
  return `R-${String(counter.nextValue).padStart(2, "0")}`;
}

export async function createCommitmentCandidate(input: CommitmentCandidateInput) {
  const title = input.title.trim();
  const owner = input.owner.trim();
  const due = input.due.trim();
  if (!title || !owner || !due || !input.evidenceHash.trim()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Для кандидата нужны title, owner, due и evidenceHash" });
  }
  return getDb().transaction(async (tx) => {
    const [signal] = await tx.select().from(signals).where(eq(signals.id, input.signalId)).for("update").limit(1);
    if (!signal) throw new TRPCError({ code: "NOT_FOUND", message: "Сигнал не найден" });
    const evidenceVersion = input.evidenceVersion || 1;
    const [existing] = await tx.select().from(commitmentCandidates)
      .where(and(eq(commitmentCandidates.signalId, input.signalId), eq(commitmentCandidates.evidenceVersion, evidenceVersion))).for("update").limit(1);
    if (existing) return { candidate: existing, decisionId: existing.decisionId, idempotent: true };

    let existingTaskId = input.existingTaskId || null;
    if (existingTaskId) {
      const [task] = await tx.select().from(tasks)
        .where(and(eq(tasks.projectId, DEMO_PROJECT_ID), eq(tasks.id, existingTaskId))).for("update").limit(1);
      if (!task) throw new TRPCError({ code: "CONFLICT", message: "Существующее поручение для update не найдено" });
    } else {
      const taskRows = await tx.select().from(tasks).where(eq(tasks.projectId, DEMO_PROJECT_ID));
      let best = { id: "", score: 0 };
      for (const task of taskRows) {
        if (task.status === "done") continue;
        const score = commitmentSimilarity(title, task.title);
        if (score > best.score) best = { id: task.id, score };
      }
      if (best.score >= 0.92) existingTaskId = best.id;
    }

    const isUpdate = input.changeType === "update" && Boolean(existingTaskId);
    const status = existingTaskId && !isUpdate ? "pending_merge" as const : "pending" as const;
    let decisionId: string | null = null;
    if (!existingTaskId || isUpdate) {
      decisionId = await nextDecisionId(tx);
      await tx.insert(decisions).values({
        id: decisionId,
        projectId: DEMO_PROJECT_ID,
        riskId: null,
        title,
        rationale: `Обязательство из сообщения ${signal.id}`,
        effect: "Исполнить обязательство в срок",
        status: "wait",
        displayDate: new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
        proposalOwner: owner,
        proposalDue: due,
      });
      await tx.insert(proposalVersions).values({
        projectId: DEMO_PROJECT_ID,
        proposalId: decisionId,
        version: 1,
        title,
        rationale: `Обязательство из сообщения ${signal.id}`,
        effect: "Исполнить обязательство в срок",
        owner,
        due,
        actorName: "Пиэмка",
        actorRole: "system",
        attribution: "Пиэмка · автоматически",
      });
    }
    const [inserted] = await tx.insert(commitmentCandidates).values({
      projectId: DEMO_PROJECT_ID,
      signalId: input.signalId,
      decisionId,
      existingTaskId,
      title,
      owner,
      due,
      confidence: Math.round(input.confidence * 100),
      changeType: input.changeType,
      status,
      evidenceVersion,
      evidenceHash: input.evidenceHash,
    }).$returningId();
    const [candidate] = await tx.select().from(commitmentCandidates).where(eq(commitmentCandidates.id, inserted.id)).limit(1);
    await tx.insert(auditEvents).values({
      projectId: DEMO_PROJECT_ID,
      entityType: "commitment",
      entityId: String(candidate.id),
      eventType: "commitment.proposed",
      relatedId: decisionId || existingTaskId,
      actorName: "Пиэмка",
      actorRole: "system",
      attribution: "Пиэмка · автоматически",
      channel: "telegram",
      version: evidenceVersion,
      sourceLinks: [telegramSourceLink(signal.chatId, signal.messageId)],
      metadata: { signalId: signal.id, decisionId, existingTaskId, evidenceHash: input.evidenceHash, confidence: input.confidence, status },
      detail: status === "pending_merge" ? "Предложено объединение обязательства с существующим поручением" : "Предложено новое обязательство",
    });
    return { candidate, decisionId, idempotent: false };
  });
}

export async function acceptCommitmentCandidate(
  input: { decisionId: string; title?: string; owner?: string; due?: string; expectedVersion?: number },
  actor: ManagementActor,
) {
  const decisionId = input.decisionId;
  const [candidate] = await getDb().select().from(commitmentCandidates)
    .where(and(eq(commitmentCandidates.projectId, DEMO_PROJECT_ID), eq(commitmentCandidates.decisionId, decisionId))).limit(1);
  if (!candidate) {
    return decideProposalRecord({ ...input, action: "ok" }, actor);
  }
  if (candidate.existingTaskId) {
    return getDb().transaction(async (tx) => {
      const [task] = await tx.select().from(tasks)
        .where(and(eq(tasks.projectId, DEMO_PROJECT_ID), eq(tasks.id, candidate.existingTaskId!))).for("update").limit(1);
      if (!task) throw new TRPCError({ code: "CONFLICT", message: "Существующее поручение не найдено" });
      const [decision] = await tx.select().from(decisions).where(eq(decisions.id, decisionId)).for("update").limit(1);
      if (!decision) throw new TRPCError({ code: "NOT_FOUND", message: "Решение не найдено" });
      if (decision.status !== "wait") return { decisionId, taskId: task.id, status: decision.status, alreadyDecided: true };
      if (input.expectedVersion !== undefined && input.expectedVersion !== decision.proposalVersion) {
        throw new TRPCError({ code: "CONFLICT", message: "Предпросмотр устарел" });
      }
      const before: ProposalSnapshot = { title: decision.title, rationale: decision.rationale, effect: decision.effect, owner: decision.proposalOwner || "Руководитель проекта", due: decision.proposalDue || "—" };
      const after: ProposalSnapshot = {
        title: input.title || before.title,
        rationale: before.rationale,
        effect: before.effect,
        owner: input.owner || before.owner,
        due: input.due || before.due,
      };
      let editDistance = 0;
      if (input.expectedVersion !== undefined) {
        const change = buildProposalDiff(before, after);
        editDistance = change.editDistance;
        const nextVersion = decision.proposalVersion + 1;
        await tx.insert(proposalVersions).values({
          projectId: DEMO_PROJECT_ID,
          proposalId: decisionId,
          version: nextVersion,
          title: after.title,
          rationale: decision.rationale,
          effect: decision.effect,
          owner: after.owner,
          due: after.due,
          sourceVersionId: decision.proposalVersion,
          actorUserId: actor.userId,
          actorName: actor.name,
          actorRole: "rp",
          attribution: `Пиэмка от имени ${actor.name}`,
          editDistance,
          diff: change.diff,
        });
        await tx.insert(auditEvents).values({
          projectId: DEMO_PROJECT_ID,
          entityType: "proposal",
          entityId: decisionId,
          eventType: "proposal.edited",
          actorUserId: actor.userId,
          actorName: actor.name,
          actorRole: "rp",
          attribution: `Пиэмка от имени ${actor.name}`,
          channel: actor.channel || "web",
          version: nextVersion,
          diff: change.diff,
          metadata: { sourceVersion: decision.proposalVersion, changedFields: change.changedFields, editDistance },
          detail: `Изменено предложение ${decisionId}: версия ${decision.proposalVersion} → ${nextVersion}`,
        });
        decision.proposalVersion = nextVersion;
      }
      const oldDue = task.due;
      await tx.update(tasks).set({ due: after.due }).where(eq(tasks.id, task.id));
      await tx.update(decisions).set({
        title: after.title,
        proposalOwner: after.owner,
        proposalDue: after.due,
        proposalVersion: decision.proposalVersion,
        status: "ok",
        decidedByUserId: actor.userId,
        decidedAt: new Date(),
        attribution: `Пиэмка от имени ${actor.name}`,
      }).where(eq(decisions.id, decisionId));
      await tx.update(commitmentCandidates).set({ status: "accepted", decidedAt: new Date(), editDistance })
        .where(eq(commitmentCandidates.id, candidate.id));
      await tx.insert(auditEvents).values({
        projectId: DEMO_PROJECT_ID,
        entityType: "commitment",
        entityId: String(candidate.id),
        eventType: "commitment.rescheduled",
        relatedId: task.id,
        actorUserId: actor.userId,
        actorName: actor.name,
        actorRole: "rp",
        attribution: `Пиэмка от имени ${actor.name}`,
        channel: actor.channel || "web",
        version: decision.proposalVersion,
        metadata: { oldDue, newDue: after.due, taskId: task.id, decisionId, evidenceVersion: candidate.evidenceVersion, editDistance },
        detail: `Срок поручения ${task.id}: ${oldDue} → ${after.due}`,
      });
      return { decisionId, taskId: task.id, status: "ok" as const, alreadyDecided: false };
    });
  }
  const result = await decideProposalRecord({ ...input, action: "ok" }, actor);
  const [latestVersion] = await getDb().select().from(proposalVersions)
    .where(eq(proposalVersions.proposalId, decisionId)).orderBy(desc(proposalVersions.version)).limit(1);
  await getDb().update(commitmentCandidates).set({ status: "accepted", taskId: result.taskId, decidedAt: new Date(), editDistance: latestVersion?.editDistance || 0 })
    .where(eq(commitmentCandidates.id, candidate.id));
  return result;
}

export async function hasCommitmentCandidate(decisionId: string) {
  const [candidate] = await getDb().select({ id: commitmentCandidates.id }).from(commitmentCandidates)
    .where(and(eq(commitmentCandidates.projectId, DEMO_PROJECT_ID), eq(commitmentCandidates.decisionId, decisionId))).limit(1);
  return Boolean(candidate);
}

export async function rejectCommitmentCandidate(
  decisionId: string,
  reason: "not_commitment" | "already_done" | "wont_do",
  actor: ManagementActor,
) {
  const [candidate] = await getDb().select().from(commitmentCandidates)
    .where(and(eq(commitmentCandidates.projectId, DEMO_PROJECT_ID), eq(commitmentCandidates.decisionId, decisionId))).limit(1);
  if (!candidate) throw new TRPCError({ code: "NOT_FOUND", message: "Кандидат обязательства не найден" });
  const result = await decideProposalRecord({ decisionId, action: "no" }, actor);
  await getDb().update(commitmentCandidates).set({ status: "rejected", rejectionReason: reason, decidedAt: new Date() })
    .where(eq(commitmentCandidates.id, candidate.id));
  await getDb().insert(auditEvents).values({
    projectId: DEMO_PROJECT_ID,
    entityType: "commitment",
    entityId: String(candidate.id),
    eventType: "commitment.rejected",
    relatedId: decisionId,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: "rp",
    attribution: `Пиэмка от имени ${actor.name}`,
    channel: actor.channel || "web",
    version: candidate.evidenceVersion,
    metadata: { reason, decisionId },
    detail: `Обязательство отклонено с причиной: ${reason}`,
  });
  return result;
}

export async function mergeCommitmentCandidate(candidateId: number, actor: ManagementActor) {
  return getDb().transaction(async (tx) => {
    const [candidate] = await tx.select().from(commitmentCandidates)
      .where(and(eq(commitmentCandidates.projectId, DEMO_PROJECT_ID), eq(commitmentCandidates.id, candidateId))).for("update").limit(1);
    if (!candidate || candidate.status !== "pending_merge") throw new TRPCError({ code: "CONFLICT", message: "Кандидат на merge не найден" });
    if (!candidate.existingTaskId) throw new TRPCError({ code: "CONFLICT", message: "Существующее поручение для merge не найдено" });
    await tx.update(commitmentCandidates).set({ status: "merged", taskId: candidate.existingTaskId, decidedAt: new Date() })
      .where(eq(commitmentCandidates.id, candidate.id));
    await tx.insert(auditEvents).values({
      projectId: DEMO_PROJECT_ID,
      entityType: "commitment",
      entityId: String(candidate.id),
      eventType: "commitment.merged",
      relatedId: candidate.existingTaskId,
      actorUserId: actor.userId,
      actorName: actor.name,
      actorRole: "rp",
      attribution: `Пиэмка от имени ${actor.name}`,
      channel: actor.channel || "web",
      version: candidate.evidenceVersion,
      metadata: { taskId: candidate.existingTaskId },
      detail: `Кандидат объединён с поручением ${candidate.existingTaskId}`,
    });
    return { taskId: candidate.existingTaskId, merged: true };
  });
}

export async function ignoreCommitmentCandidate(candidateId: number, actor: ManagementActor) {
  const [candidate] = await getDb().select().from(commitmentCandidates)
    .where(and(eq(commitmentCandidates.projectId, DEMO_PROJECT_ID), eq(commitmentCandidates.id, candidateId))).limit(1);
  if (!candidate) throw new TRPCError({ code: "NOT_FOUND", message: "Кандидат не найден" });
  await getDb().update(commitmentCandidates).set({ status: "ignored", rejectionReason: "wont_do", decidedAt: new Date() })
    .where(eq(commitmentCandidates.id, candidate.id));
  await getDb().insert(auditEvents).values({
    projectId: DEMO_PROJECT_ID,
    entityType: "commitment",
    entityId: String(candidate.id),
    eventType: "commitment.rejected",
    actorUserId: actor.userId,
    actorName: actor.name,
    actorRole: "rp",
    attribution: `Пиэмка от имени ${actor.name}`,
    channel: actor.channel || "web",
    version: candidate.evidenceVersion,
    metadata: { reason: "wont_do" },
    detail: "Кандидат проигнорирован",
  });
  return { ignored: true };
}

export async function recordCommitmentOutcome(taskId: string, actor: ManagementActor) {
  return getDb().transaction(async (tx) => {
    const [task] = await tx.select().from(tasks)
      .where(and(eq(tasks.projectId, DEMO_PROJECT_ID), eq(tasks.id, taskId))).for("update").limit(1);
    if (!task || task.status !== "done" || !task.completedAt) throw new TRPCError({ code: "CONFLICT", message: "Поручение ещё не завершено" });
    const [existing] = await tx.select().from(commitmentOutcomes).where(eq(commitmentOutcomes.taskId, taskId)).for("update").limit(1);
    const due = dueDate(task.due);
    const outcome = due ? (task.completedAt <= due ? "on_time" as const : "late" as const) : "unknown" as const;
    const assessment = await assessTaskOutcome(taskId);
    const resultText = task.result || "Результат подтверждён";
    if (!existing) {
      await tx.insert(commitmentOutcomes).values({
        projectId: DEMO_PROJECT_ID,
        taskId,
        decisionId: task.decisionId,
        outcome,
        resultText,
        completedAt: task.completedAt,
        source: "Подтверждение выполнения РП",
        sourceId: taskId,
        expectedEffect: assessment?.expectedEffect || null,
        effectAssessment: assessment || null,
        recordedByUserId: actor.userId || 0,
        recordedByName: actor.name,
        recordedByRole: "rp",
      });
      await tx.insert(auditEvents).values({
        projectId: DEMO_PROJECT_ID,
        entityType: "commitment",
        entityId: taskId,
        eventType: "commitment.outcome.recorded",
        relatedId: task.decisionId,
        actorUserId: actor.userId,
        actorName: actor.name,
        actorRole: "rp",
        attribution: `Пиэмка от имени ${actor.name}`,
        channel: actor.channel || "telegram",
        metadata: { outcome, completedAt: task.completedAt, due: task.due, effectAssessment: assessment },
        detail: `Исход поручения ${taskId}: ${outcome}`,
      });
    } else {
      await tx.update(commitmentOutcomes).set({ outcome, resultText, effectAssessment: assessment || null, updatedAt: new Date() })
        .where(eq(commitmentOutcomes.id, existing.id));
    }
    await tx.update(commitmentCandidates).set({ status: "completed", completedAt: task.completedAt }).where(eq(commitmentCandidates.taskId, taskId));
    const [outcomeRow] = await tx.select().from(commitmentOutcomes).where(eq(commitmentOutcomes.taskId, taskId)).limit(1);
    return { outcome: outcomeRow, idempotent: Boolean(existing) };
  });
}
