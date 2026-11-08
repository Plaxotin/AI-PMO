import { createHash } from "node:crypto";
import { and, asc, eq, ne, or } from "drizzle-orm";
import {
  auditEvents,
  decisions,
  proposalVersions,
  risks,
  signals,
  tasks,
  telegramSlaNotifications,
  type AuditSourceLink,
} from "@db/schema";
import type { SlaObjectType, SlaRecipientRole, SlaStep } from "../telegram/escalation";
import { getDb } from "./connection";
import { DEMO_PROJECT_ID } from "./pmo";
import { telegramSourceLink } from "./proposal-audit";

function isDuplicateEntry(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "ER_DUP_ENTRY" || candidate?.cause?.code === "ER_DUP_ENTRY";
}

function taskVersion(task: { owner: string; due: string; status: string }) {
  const digest = createHash("sha256").update(JSON.stringify([task.owner, task.due, task.status])).digest("hex").slice(0, 24);
  return `v${digest}`;
}

async function entityHistory(entityId: string) {
  const rows = await getDb().select({ eventType: auditEvents.eventType }).from(auditEvents)
    .where(and(
      eq(auditEvents.projectId, DEMO_PROJECT_ID),
      or(eq(auditEvents.entityId, entityId), eq(auditEvents.relatedId, entityId)),
    ))
    .orderBy(asc(auditEvents.id));
  return rows.map((row) => row.eventType).slice(-8);
}

async function riskAndSignal(riskId: string | null) {
  if (!riskId) return { risk: undefined, signal: undefined };
  const db = getDb();
  const [risk] = await db.select().from(risks).where(eq(risks.id, riskId)).limit(1);
  const [signal] = await db.select().from(signals).where(eq(signals.riskId, riskId)).limit(1);
  return { risk, signal };
}

export type DecisionSlaContext = {
  objectType: "decision";
  objectId: string;
  objectVersion: string;
  relatedId: string | null;
  version: number;
  title: string;
  riskTitle: string;
  owner: string;
  due: string;
  pendingSince: Date;
  history: string[];
  sourceLink?: AuditSourceLink;
};

export type TaskSlaContext = {
  objectType: "task";
  objectId: string;
  objectVersion: string;
  relatedId: string | null;
  version?: number;
  title: string;
  riskTitle: string;
  owner: string;
  due: string;
  history: string[];
  sourceLink?: AuditSourceLink;
};

export type SlaAuditContext = DecisionSlaContext | TaskSlaContext;

export async function listPendingSlaDecisions() {
  return getDb().select({ id: decisions.id }).from(decisions)
    .where(and(eq(decisions.projectId, DEMO_PROJECT_ID), eq(decisions.status, "wait")));
}

export async function listOpenSlaTasks() {
  return getDb().select({ id: tasks.id }).from(tasks)
    .where(and(eq(tasks.projectId, DEMO_PROJECT_ID), ne(tasks.status, "done")));
}

export async function getDecisionSlaContext(decisionId: string): Promise<DecisionSlaContext | null> {
  const db = getDb();
  const [decision] = await db.select().from(decisions)
    .where(and(eq(decisions.projectId, DEMO_PROJECT_ID), eq(decisions.id, decisionId), eq(decisions.status, "wait"))).limit(1);
  if (!decision) return null;
  const [storedVersion] = await db.select().from(proposalVersions)
    .where(and(eq(proposalVersions.proposalId, decision.id), eq(proposalVersions.version, decision.proposalVersion))).limit(1);
  const [{ risk, signal }, history] = await Promise.all([riskAndSignal(decision.riskId), entityHistory(decision.id)]);
  return {
    objectType: "decision",
    objectId: decision.id,
    objectVersion: `v${decision.proposalVersion}`,
    relatedId: decision.riskId,
    version: decision.proposalVersion,
    title: storedVersion?.title || decision.title,
    riskTitle: risk?.title || "Риск не связан",
    owner: storedVersion?.owner || decision.proposalOwner || "—",
    due: storedVersion?.due || decision.proposalDue || "—",
    pendingSince: storedVersion?.createdAt || decision.createdAt,
    history,
    sourceLink: signal ? telegramSourceLink(signal.chatId, signal.messageId) : undefined,
  };
}

export async function getTaskSlaContext(taskId: string): Promise<TaskSlaContext | null> {
  const db = getDb();
  const [task] = await db.select().from(tasks)
    .where(and(eq(tasks.projectId, DEMO_PROJECT_ID), eq(tasks.id, taskId), ne(tasks.status, "done"))).limit(1);
  if (!task) return null;
  const [decision] = task.decisionId ? await db.select().from(decisions).where(eq(decisions.id, task.decisionId)).limit(1) : [];
  const riskId = task.riskId || decision?.riskId || null;
  const [{ risk, signal }, history] = await Promise.all([riskAndSignal(riskId), entityHistory(task.id)]);
  return {
    objectType: "task",
    objectId: task.id,
    objectVersion: taskVersion(task),
    relatedId: task.decisionId,
    version: decision?.proposalVersion,
    title: task.title,
    riskTitle: risk?.title || "Риск не связан",
    owner: task.owner,
    due: task.due,
    history,
    sourceLink: signal ? telegramSourceLink(signal.chatId, signal.messageId) : undefined,
  };
}

export async function claimSlaNotification(input: {
  objectType: SlaObjectType;
  objectId: string;
  objectVersion: string;
  step: SlaStep;
  recipientRole: SlaRecipientRole;
  userId: string;
}) {
  try {
    const [row] = await getDb().insert(telegramSlaNotifications).values({
      ...input,
      chatId: input.userId,
      status: "sending",
    }).$returningId();
    return row.id;
  } catch (error) {
    if (isDuplicateEntry(error)) return null;
    throw error;
  }
}

function auditValues(context: SlaAuditContext, input: {
  step: SlaStep;
  recipientRole: SlaRecipientRole;
  metadata: Record<string, unknown>;
  detail: string;
  eventType?: string;
}) {
  return {
    projectId: DEMO_PROJECT_ID,
    entityType: context.objectType,
    entityId: context.objectId,
    eventType: input.eventType || `${context.objectType}.${input.step === "reminder" ? "reminded" : "escalated"}`,
    relatedId: context.relatedId,
    actorName: "Пиэмка",
    actorRole: "system",
    attribution: "Пиэмка · автоматически",
    channel: "telegram",
    version: context.version,
    sourceLinks: context.sourceLink ? [context.sourceLink] : undefined,
    metadata: {
      delivery: "sla",
      slaStep: input.step,
      recipientRole: input.recipientRole,
      objectVersion: context.objectVersion,
      ...input.metadata,
    },
    detail: input.detail,
  };
}

export async function markSlaNotificationSent(input: {
  notificationId: number;
  messageId: number;
  context: SlaAuditContext;
  step: SlaStep;
  recipientRole: SlaRecipientRole;
}) {
  return getDb().transaction(async (tx) => {
    const [notification] = await tx.select().from(telegramSlaNotifications)
      .where(eq(telegramSlaNotifications.id, input.notificationId)).for("update");
    if (!notification || notification.status !== "sending") return false;
    const sentAt = new Date();
    await tx.update(telegramSlaNotifications).set({
      status: "sent",
      messageId: input.messageId,
      sentAt,
      error: null,
    }).where(eq(telegramSlaNotifications.id, input.notificationId));
    await tx.insert(auditEvents).values(auditValues(input.context, {
      step: input.step,
      recipientRole: input.recipientRole,
      metadata: { notificationId: input.notificationId, messageId: input.messageId },
      detail: `${input.step === "reminder" ? "Напоминание" : "Эскалация"} по ${input.context.objectId} доставлено получателю с ролью ${input.recipientRole}`,
    }));
    return true;
  });
}

export async function markSlaNotificationFailed(input: {
  notificationId: number;
  outcome: "failed" | "unknown";
  error: string;
  context: SlaAuditContext;
  step: SlaStep;
  recipientRole: SlaRecipientRole;
}) {
  return getDb().transaction(async (tx) => {
    const [notification] = await tx.select().from(telegramSlaNotifications)
      .where(eq(telegramSlaNotifications.id, input.notificationId)).for("update");
    if (!notification || notification.status !== "sending") return false;
    await tx.update(telegramSlaNotifications).set({
      status: input.outcome,
      error: input.error.slice(0, 4000),
    }).where(eq(telegramSlaNotifications.id, input.notificationId));
    await tx.insert(auditEvents).values(auditValues(input.context, {
      step: input.step,
      recipientRole: input.recipientRole,
      eventType: "delivery.failed",
      metadata: { notificationId: input.notificationId, deliveryStatus: input.outcome, error: input.error.slice(0, 1000) },
      detail: input.outcome === "unknown"
        ? `Результат доставки SLA-события по ${input.context.objectId} неизвестен; автоматический повтор запрещён`
        : `Не удалось доставить SLA-событие по ${input.context.objectId} получателю с ролью ${input.recipientRole}`,
    }));
    return true;
  });
}
