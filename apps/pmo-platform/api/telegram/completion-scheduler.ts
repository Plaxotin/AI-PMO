import { log } from "../lib/logger";
import {
  claimCompletionCheck,
  claimEffectNotification,
  getCompletionContext,
  listOpenCompletionTasks,
  listPendingEffectChecks,
  markCompletionCheckFailed,
  markCompletionCheckSent,
  markEffectNotificationFailed,
  markEffectNotificationSent,
} from "../queries/completion";
import { sendTelegramMessage } from "./client";
import {
  assessTaskEffect,
  completionPromptText,
  DEFAULT_PROJECT_TIME_ZONE,
  effectNotificationText,
  parseTaskDue,
  shouldAskForCompletion,
} from "./completion";
import { getTelegramConfig } from "./config";
import { telegramSourceLink } from "../queries/proposal-audit";
import { runSlaChecks } from "./escalation-scheduler";
import { runFirstValueChecks } from "./first-value";
import { assessTaskOutcome } from "../queries/outcome";

function projectTimeZone() {
  return process.env.PROJECT_TIME_ZONE || DEFAULT_PROJECT_TIME_ZONE;
}

export async function deliverEffectNotification(checkId: number) {
  if (!await claimEffectNotification(checkId)) return false;
  const context = await getCompletionContext(checkId);
  if (!context?.decision) {
    await markEffectNotificationFailed(checkId, "Не найден контекст решения для оценки эффекта");
    return false;
  }
  const measuredAssessment = await assessTaskOutcome(context.task.id);
  const assessment = measuredAssessment || assessTaskEffect(context.decision.effect);
  try {
    const message = await sendTelegramMessage({
      chatId: context.check.chatId,
      text: effectNotificationText({
        taskId: context.task.id,
        title: context.task.title,
        actorName: context.task.completedByName || "Руководитель проекта",
        assessment,
      }),
    });
    await markEffectNotificationSent(checkId, message.message_id);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markEffectNotificationFailed(checkId, message);
    log.error("Telegram effect notification failed", { checkId, error: message });
    return false;
  }
}

export async function runDueCompletionChecks(now = new Date()) {
  const config = getTelegramConfig();
  const summary = { claimed: 0, sent: 0, duplicates: 0, failed: 0, effectsSent: 0 };
  if (!config.rpUserIds.size) {
    log.warn("Completion scheduler skipped: RP DM is not configured");
    return summary;
  }

  const openTasks = await listOpenCompletionTasks();
  for (const task of openTasks) {
    const due = parseTaskDue(task.due);
    if (!due || !shouldAskForCompletion(task.due, now, projectTimeZone())) continue;
    for (const userId of config.rpUserIds) {
      const checkId = await claimCompletionCheck({ taskId: task.id, dueVersion: due.key, chatId: userId, userId });
      if (!checkId) {
        summary.duplicates += 1;
        continue;
      }
      summary.claimed += 1;
      try {
        const context = await getCompletionContext(checkId);
        if (!context) throw new Error("Не найден контекст поручения для проверки выполнения");
        const prompt = await sendTelegramMessage({
          chatId: userId,
          text: completionPromptText({
            taskId: task.id,
            title: task.title,
            author: context.signal?.authorName || "—",
            owner: task.owner,
            source: context.signal ? telegramSourceLink(context.signal.chatId, context.signal.messageId) : undefined,
            createdAt: task.createdAt,
            due: task.due,
            timeZone: projectTimeZone(),
          }),
          buttons: [[
            { text: "Выполнено", callback_data: `cd:${checkId}` },
            { text: "Не выполнено", callback_data: `cn:${checkId}` },
          ]],
        });
        await markCompletionCheckSent(checkId, prompt.message_id);
        summary.sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await markCompletionCheckFailed(checkId, message);
        summary.failed += 1;
        log.error("Telegram completion check failed", { checkId, error: message });
      }
    }
  }

  const pendingEffects = await listPendingEffectChecks();
  for (const check of pendingEffects) {
    if (await deliverEffectNotification(check.id)) summary.effectsSent += 1;
  }
  return summary;
}

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerTickRunning = false;

export async function runCompletionSchedulerTick(now = new Date()) {
  if (schedulerTickRunning) return null;
  schedulerTickRunning = true;
  try {
    const completion = await runDueCompletionChecks(now);
    const sla = await runSlaChecks(now);
    const firstValue = await runFirstValueChecks(now);
    return { ...completion, sla, firstValue };
  } finally {
    schedulerTickRunning = false;
  }
}

export function startCompletionScheduler() {
  if (schedulerTimer) return;
  const tick = () => {
    void runCompletionSchedulerTick().catch((error) => {
      log.error("Completion scheduler tick failed", { error: error instanceof Error ? error.message : String(error) });
    });
  };
  tick();
  schedulerTimer = setInterval(tick, 30_000);
  schedulerTimer.unref();
}
