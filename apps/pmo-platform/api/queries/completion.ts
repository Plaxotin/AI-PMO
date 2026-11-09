import { and, eq, ne } from "drizzle-orm";
import { auditEvents, decisions, signals, tasks, telegramCompletionChecks } from "@db/schema";
import { assessTaskEffect } from "../telegram/completion";
import { assessTaskOutcome } from "./outcome";
import { recordCommitmentOutcome } from "./commitment";
import { getDb } from "./connection";
import { DEMO_PROJECT_ID } from "./pmo";
import { telegramSourceLink } from "./proposal-audit";

function isDuplicateEntry(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "ER_DUP_ENTRY" || candidate?.cause?.code === "ER_DUP_ENTRY";
}

export async function listOpenCompletionTasks() {
  return getDb().select().from(tasks).where(and(eq(tasks.projectId, DEMO_PROJECT_ID), ne(tasks.status, "done")));
}

export async function claimCompletionCheck(input: { taskId: string; dueVersion: string; chatId: string; userId: string }) {
  try {
    const [row] = await getDb().insert(telegramCompletionChecks).values({ ...input, status: "sending" }).$returningId();
    return row.id;
  } catch (error) {
    if (isDuplicateEntry(error)) return null;
    throw error;
  }
}

export async function getCompletionContext(checkId: number) {
  const db = getDb();
  const [check] = await db.select().from(telegramCompletionChecks).where(eq(telegramCompletionChecks.id, checkId)).limit(1);
  if (!check) return null;
  const [task] = await db.select().from(tasks).where(and(eq(tasks.id, check.taskId), eq(tasks.projectId, DEMO_PROJECT_ID))).limit(1);
  if (!task) return null;
  const [decision] = task.decisionId ? await db.select().from(decisions).where(eq(decisions.id, task.decisionId)).limit(1) : [];
  const [signal] = decision?.riskId ? await db.select().from(signals).where(eq(signals.riskId, decision.riskId)).limit(1) : [];
  return { check, task, decision, signal };
}

export async function markCompletionCheckSent(checkId: number, promptMessageId: number) {
  return getDb().transaction(async (tx) => {
    const [check] = await tx.select().from(telegramCompletionChecks).where(eq(telegramCompletionChecks.id, checkId)).for("update");
    if (!check || check.status !== "sending") return false;
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, check.taskId)).for("update");
    if (!task || task.status === "done") return false;
    const [decision] = task.decisionId ? await tx.select().from(decisions).where(eq(decisions.id, task.decisionId)).limit(1) : [];
    const [signal] = decision?.riskId ? await tx.select().from(signals).where(eq(signals.riskId, decision.riskId)).limit(1) : [];
    await tx.update(telegramCompletionChecks).set({ status: "pending", promptMessageId, error: null }).where(eq(telegramCompletionChecks.id, checkId));
    await tx.insert(auditEvents).values({
      projectId: DEMO_PROJECT_ID,
      entityType: "task",
      entityId: task.id,
      eventType: "task.completion_asked",
      relatedId: task.decisionId,
      actorName: "Пиэмка",
      actorRole: "system",
      attribution: "Пиэмка · автоматически",
      channel: "telegram",
      version: decision?.proposalVersion,
      sourceLinks: signal ? [telegramSourceLink(signal.chatId, signal.messageId)] : undefined,
      metadata: { checkId, dueVersion: check.dueVersion, promptMessageId },
      detail: `РП получил вопрос о выполнении поручения ${task.id}`,
    });
    return true;
  });
}

export async function markCompletionCheckFailed(checkId: number, error: string) {
  return getDb().transaction(async (tx) => {
    const [check] = await tx.select().from(telegramCompletionChecks).where(eq(telegramCompletionChecks.id, checkId)).for("update");
    if (!check || check.status !== "sending") return;
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, check.taskId)).limit(1);
    await tx.update(telegramCompletionChecks).set({ status: "failed", error: error.slice(0, 4000) }).where(eq(telegramCompletionChecks.id, checkId));
    await tx.insert(auditEvents).values({
      projectId: DEMO_PROJECT_ID,
      entityType: "task",
      entityId: check.taskId,
      eventType: "delivery.failed",
      relatedId: task?.decisionId,
      actorName: "Пиэмка",
      actorRole: "system",
      attribution: "Пиэмка · автоматически",
      channel: "telegram",
      metadata: { checkId, delivery: "completion_check", error: error.slice(0, 1000) },
      detail: `Не удалось доставить вопрос о выполнении поручения ${check.taskId}`,
    });
  });
}

export async function answerCompletionCheck(input: {
  checkId: number;
  chatId: string;
  userId: string;
  answer: "done" | "not_done";
  actorUserId: number;
  actorName: string;
}) {
  const result = await getDb().transaction(async (tx) => {
    const [check] = await tx.select().from(telegramCompletionChecks).where(eq(telegramCompletionChecks.id, input.checkId)).for("update");
    if (!check || check.chatId !== input.chatId || check.userId !== input.userId) throw new Error("Проверка выполнения не найдена");
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, check.taskId)).for("update");
    if (!task) throw new Error("Поручение не найдено");

    if (input.answer === "not_done") {
      if (task.status === "done" || check.status === "done") return { kind: "already_done" as const };
      if (check.status === "not_done") return { kind: "already_not_done" as const };
      const now = new Date();
      await tx.update(telegramCompletionChecks).set({ status: "not_done", respondedAt: now, error: null }).where(eq(telegramCompletionChecks.id, check.id));
      await tx.insert(auditEvents).values({
        projectId: DEMO_PROJECT_ID,
        entityType: "task",
        entityId: task.id,
        eventType: "task.completion_not_done",
        relatedId: task.decisionId,
        actorUserId: input.actorUserId,
        actorName: input.actorName,
        actorRole: "rp",
        attribution: `Пиэмка от имени ${input.actorName}`,
        channel: "telegram",
        metadata: { checkId: check.id, dueVersion: check.dueVersion },
        detail: `РП ответил, что поручение ${task.id} не выполнено; поручение остаётся открытым`,
      });
      return { kind: "not_done" as const };
    }

    if (task.status === "done" || check.status === "done") return { kind: "already_done" as const };
    const [decision] = task.decisionId ? await tx.select().from(decisions).where(eq(decisions.id, task.decisionId)).limit(1) : [];
    const [signal] = decision?.riskId ? await tx.select().from(signals).where(eq(signals.riskId, decision.riskId)).limit(1) : [];
    const assessment = assessTaskEffect(decision?.effect || "—");
    const now = new Date();
    const result = `Выполнение подтверждено РП ${input.actorName}.`;
    await tx.update(tasks).set({ status: "done", result, completedAt: now, completedByName: input.actorName }).where(eq(tasks.id, task.id));
    await tx.update(telegramCompletionChecks).set({ status: "done", respondedAt: now, effectStatus: "pending", error: null }).where(eq(telegramCompletionChecks.id, check.id));
    await tx.insert(auditEvents).values({
      projectId: DEMO_PROJECT_ID,
      entityType: "result",
      entityId: task.id,
      eventType: "result.recorded",
      relatedId: task.decisionId,
      actorUserId: input.actorUserId,
      actorName: input.actorName,
      actorRole: "rp",
      attribution: `Пиэмка от имени ${input.actorName}`,
      channel: "telegram",
      version: decision?.proposalVersion,
      sourceLinks: signal ? [telegramSourceLink(signal.chatId, signal.messageId)] : undefined,
      metadata: {
        checkId: check.id,
        signalId: signal?.id || null,
        channelId: signal?.channelId || null,
        taskId: task.id,
        expectedEffect: assessment.expectedEffect,
        effectStatus: assessment.status,
        effect: assessment.text,
        effectBasis: assessment.basis,
      },
      detail: result,
    });
    return { kind: "done" as const };
  });
  if (result.kind === "done") {
    const [check] = await getDb().select().from(telegramCompletionChecks).where(eq(telegramCompletionChecks.id, input.checkId)).limit(1);
    if (check) await recordCommitmentOutcome(check.taskId, { userId: input.actorUserId, name: input.actorName, channel: "telegram" });
  }
  return result;
}

export async function claimEffectNotification(checkId: number) {
  return getDb().transaction(async (tx) => {
    const [check] = await tx.select().from(telegramCompletionChecks).where(eq(telegramCompletionChecks.id, checkId)).for("update");
    if (!check || check.status !== "done" || check.effectStatus !== "pending") return false;
    await tx.update(telegramCompletionChecks).set({ effectStatus: "sending", error: null }).where(eq(telegramCompletionChecks.id, checkId));
    return true;
  });
}

export async function listPendingEffectChecks() {
  return getDb().select({ id: telegramCompletionChecks.id }).from(telegramCompletionChecks)
    .where(and(eq(telegramCompletionChecks.status, "done"), eq(telegramCompletionChecks.effectStatus, "pending")));
}

export async function markEffectNotificationSent(checkId: number, effectMessageId: number) {
  return getDb().transaction(async (tx) => {
    const [check] = await tx.select().from(telegramCompletionChecks).where(eq(telegramCompletionChecks.id, checkId)).for("update");
    if (!check || check.effectStatus !== "sending") return false;
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, check.taskId)).limit(1);
    if (!task) return false;
    const [decision] = task.decisionId ? await tx.select().from(decisions).where(eq(decisions.id, task.decisionId)).limit(1) : [];
    const [signal] = decision?.riskId ? await tx.select().from(signals).where(eq(signals.riskId, decision.riskId)).limit(1) : [];
    const measuredAssessment = await assessTaskOutcome(task.id);
    const assessment = measuredAssessment || assessTaskEffect(decision?.effect || "—");
    await tx.update(telegramCompletionChecks).set({ effectStatus: "sent", effectMessageId, error: null }).where(eq(telegramCompletionChecks.id, checkId));
    await tx.insert(auditEvents).values({
      projectId: DEMO_PROJECT_ID,
      entityType: "effect",
      entityId: task.id,
      eventType: "effect.reported",
      relatedId: task.decisionId,
      actorName: "Пиэмка",
      actorRole: "system",
      attribution: "Пиэмка · автоматически",
      channel: "telegram",
      version: decision?.proposalVersion,
      sourceLinks: signal ? [telegramSourceLink(signal.chatId, signal.messageId)] : undefined,
      metadata: {
        checkId,
        effectMessageId,
        expectedEffect: assessment.expectedEffect,
        effectStatus: assessment.status,
        effect: assessment.text,
        effectBasis: assessment.basis,
      },
      detail: assessment.status === "confirmed" ? assessment.text : `Результат по ${task.id} зафиксирован; ${assessment.text}`,
    });
    return true;
  });
}

export async function markEffectNotificationFailed(checkId: number, error: string) {
  return getDb().transaction(async (tx) => {
    const [check] = await tx.select().from(telegramCompletionChecks).where(eq(telegramCompletionChecks.id, checkId)).for("update");
    if (!check || check.effectStatus !== "sending") return;
    await tx.update(telegramCompletionChecks).set({ effectStatus: "failed", error: error.slice(0, 4000) }).where(eq(telegramCompletionChecks.id, checkId));
    await tx.insert(auditEvents).values({
      projectId: DEMO_PROJECT_ID,
      entityType: "effect",
      entityId: check.taskId,
      eventType: "delivery.failed",
      relatedId: null,
      actorName: "Пиэмка",
      actorRole: "system",
      attribution: "Пиэмка · автоматически",
      channel: "telegram",
      metadata: { checkId, delivery: "effect_notification", error: error.slice(0, 1000) },
      detail: `Не удалось доставить оценку эффекта по поручению ${check.taskId}`,
    });
  });
}
