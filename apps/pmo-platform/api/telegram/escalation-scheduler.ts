import { log } from "../lib/logger";
import {
  claimSlaNotification,
  getDecisionSlaContext,
  getTaskSlaContext,
  listOpenSlaTasks,
  listPendingSlaDecisions,
  markSlaNotificationFailed,
  markSlaNotificationSent,
  type SlaAuditContext,
} from "../queries/escalation";
import { sendTelegramMessage, TelegramDeliveryError, telegramDeliveryOutcome } from "./client";
import { getTelegramConfig } from "./config";
import { DEFAULT_PROJECT_TIME_ZONE } from "./completion";
import {
  decisionNotificationText,
  decisionSlaSteps,
  taskNotificationText,
  taskOverdueHours,
  taskSlaSteps,
  type SlaRecipientRole,
  type SlaStep,
} from "./escalation";

type DeliveryTarget = { recipientRole: SlaRecipientRole; userId: string | null };
type SlaSummary = { claimed: number; sent: number; duplicates: number; failed: number; unknown: number };

function projectTimeZone() {
  return process.env.PROJECT_TIME_ZONE || DEFAULT_PROJECT_TIME_ZONE;
}

function targets(role: SlaRecipientRole, userIds: Iterable<string>): DeliveryTarget[] {
  const ids = [...new Set(userIds)];
  return ids.length ? ids.map((userId) => ({ recipientRole: role, userId })) : [{ recipientRole: role, userId: null }];
}

async function deliver(input: {
  context: SlaAuditContext;
  step: SlaStep;
  target: DeliveryTarget;
  text: string;
  summary: SlaSummary;
}) {
  const { context, step, target, summary } = input;
  const notificationId = await claimSlaNotification({
    objectType: context.objectType,
    objectId: context.objectId,
    objectVersion: context.objectVersion,
    step,
    recipientRole: target.recipientRole,
    userId: target.userId || "",
  });
  if (!notificationId) {
    summary.duplicates += 1;
    return;
  }
  summary.claimed += 1;
  try {
    if (!target.userId) {
      throw new TelegramDeliveryError(`Не настроен личный получатель с ролью ${target.recipientRole}`, "failed");
    }
    const message = await sendTelegramMessage({ chatId: target.userId, text: input.text });
    await markSlaNotificationSent({
      notificationId,
      messageId: message.message_id,
      context,
      step,
      recipientRole: target.recipientRole,
    });
    summary.sent += 1;
  } catch (error) {
    const outcome = telegramDeliveryOutcome(error);
    const message = error instanceof Error ? error.message : String(error);
    await markSlaNotificationFailed({
      notificationId,
      outcome,
      error: message,
      context,
      step,
      recipientRole: target.recipientRole,
    });
    summary[outcome] += 1;
    log.error("Telegram SLA delivery failed", { notificationId, objectId: context.objectId, outcome, error: message });
  }
}

export async function runSlaChecks(now = new Date()) {
  const config = getTelegramConfig();
  const summary: SlaSummary = { claimed: 0, sent: 0, duplicates: 0, failed: 0, unknown: 0 };

  const pendingDecisions = await listPendingSlaDecisions();
  for (const candidate of pendingDecisions) {
    const context = await getDecisionSlaContext(candidate.id);
    if (!context) continue;
    const steps = decisionSlaSteps(context.pendingSince, now);
    for (const step of steps) {
      const role = step === "reminder" ? "rp" : "sponsor";
      const recipients = targets(role, step === "reminder" ? config.rpUserIds : config.sponsorUserIds);
      const pendingHours = (now.getTime() - context.pendingSince.getTime()) / 3_600_000;
      const text = decisionNotificationText({
        step,
        decisionId: context.objectId,
        title: context.title,
        riskTitle: context.riskTitle,
        owner: context.owner,
        due: context.due,
        pendingHours,
        history: context.history,
        source: context.sourceLink,
      });
      for (const target of recipients) {
        await deliver({ context, step, target, text, summary });
      }
    }
  }

  const openTasks = await listOpenSlaTasks();
  for (const candidate of openTasks) {
    const context = await getTaskSlaContext(candidate.id);
    if (!context) continue;
    const steps = taskSlaSteps(context.due, now, projectTimeZone());
    for (const step of steps) {
      const recipients = step === "reminder"
        ? targets("owner", config.ownerUserIds[context.owner] ? [config.ownerUserIds[context.owner]] : [])
        : [...targets("sponsor", config.sponsorUserIds), ...targets("rp", config.rpUserIds)];
      const seen = new Set<string>();
      const overdueHours = taskOverdueHours(context.due, now, projectTimeZone()) || 0;
      for (const target of recipients) {
        if (target.userId && seen.has(target.userId)) continue;
        if (target.userId) seen.add(target.userId);
        const text = taskNotificationText({
          step,
          recipientRole: target.recipientRole,
          taskId: context.objectId,
          title: context.title,
          riskTitle: context.riskTitle,
          owner: context.owner,
          due: context.due,
          overdueHours,
          history: context.history,
          source: context.sourceLink,
        });
        await deliver({ context, step, target, text, summary });
      }
    }
  }
  return summary;
}
