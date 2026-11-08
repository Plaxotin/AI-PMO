import type { telegramOnboardings } from "@db/schema";
import { log } from "../lib/logger";
import {
  buildProjectDigest,
  claimDigestDelivery,
  listTelegramOnboardings,
  markDigestDeliveryFailed,
  markDigestDeliverySent,
  type DigestKind,
  type DigestRecipientRole,
} from "../queries/first-value";
import { sendTelegramMessage, TelegramDeliveryError, telegramDeliveryOutcome } from "./client";
import { getTelegramConfig } from "./config";
import { DEFAULT_PROJECT_TIME_ZONE } from "./completion";

type Onboarding = typeof telegramOnboardings.$inferSelect;
type FirstValueSummary = { claimed: number; sent: number; duplicates: number; failed: number; unknown: number };

function projectTimeZone() {
  return process.env.PROJECT_TIME_ZONE || DEFAULT_PROJECT_TIME_ZONE;
}

function dateParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return { year: value("year"), month: value("month"), day: value("day"), hour: Number(value("hour")) };
}

export function dailyDigestPeriod(now: Date, timeZone = DEFAULT_PROJECT_TIME_ZONE) {
  const parts = dateParts(now, timeZone);
  return { periodKey: `${parts.year}-${parts.month}-${parts.day}`, due: parts.hour >= 9 };
}

function welcomeText(onboarding: Onboarding) {
  return `Пиэмка подключила проект ${onboarding.projectId} к наблюдению.\n\nРабочий чат используется только для чтения сигналов. Первый дайджест по доступным реальным данным придёт в этот личный чат примерно в ${onboarding.firstDigestDueAt.toISOString()} — через час после подключения. Далее — ежедневно в 09:00 по часовому поясу проекта. Открывать веб не требуется.`;
}

function founderText(onboarding: Onboarding) {
  return `AI PMO: новое подключение проекта ${onboarding.projectId}. Время подключения: ${onboarding.connectedAt.toISOString()}. Содержимое переписки и секреты не включены.`;
}

async function deliver(input: {
  onboarding: Onboarding;
  kind: DigestKind;
  periodKey: string;
  recipientRole: DigestRecipientRole;
  userId: string;
  text: string;
  buttons?: { text: string; callback_data: string }[][];
  coverageStart?: Date;
  coverageEnd?: Date;
  sourceLinks?: Awaited<ReturnType<typeof buildProjectDigest>>["sourceLinks"];
  includedItems?: Awaited<ReturnType<typeof buildProjectDigest>>["includedItems"];
  summary: FirstValueSummary;
}) {
  const deliveryId = await claimDigestDelivery({
    projectId: input.onboarding.projectId,
    kind: input.kind,
    periodKey: input.periodKey,
    recipientRole: input.recipientRole,
    userId: input.userId,
    coverageStart: input.coverageStart,
    coverageEnd: input.coverageEnd,
  });
  if (!deliveryId) {
    input.summary.duplicates += 1;
    return;
  }
  input.summary.claimed += 1;
  try {
    if (!input.userId) {
      throw new TelegramDeliveryError(`Не настроен личный получатель с ролью ${input.recipientRole}`, "failed");
    }
    const message = await sendTelegramMessage({ chatId: input.userId, text: input.text, buttons: input.buttons });
    await markDigestDeliverySent({
      deliveryId,
      projectId: input.onboarding.projectId,
      kind: input.kind,
      periodKey: input.periodKey,
      recipientRole: input.recipientRole,
      messageId: message.message_id,
      sourceLinks: input.sourceLinks,
      includedItems: input.includedItems,
    });
    input.summary.sent += 1;
  } catch (error) {
    const outcome = telegramDeliveryOutcome(error);
    const message = error instanceof Error ? error.message : String(error);
    await markDigestDeliveryFailed({
      deliveryId,
      projectId: input.onboarding.projectId,
      kind: input.kind,
      periodKey: input.periodKey,
      recipientRole: input.recipientRole,
      outcome,
      error: message,
      sourceLinks: input.sourceLinks,
    });
    input.summary[outcome] += 1;
    log.error("Telegram first-value delivery failed", { deliveryId, kind: input.kind, outcome, error: message });
  }
}

function recipients(role: DigestRecipientRole, userIds: Iterable<string>) {
  const ids = [...new Set(userIds)];
  return ids.length ? ids : [""];
}

export async function deliverOnboardingMessages(onboarding: Onboarding) {
  const config = getTelegramConfig();
  const summary: FirstValueSummary = { claimed: 0, sent: 0, duplicates: 0, failed: 0, unknown: 0 };
  for (const userId of recipients("rp", config.rpUserIds)) {
    await deliver({
      onboarding,
      kind: "welcome",
      periodKey: String(onboarding.id),
      recipientRole: "rp",
      userId,
      text: welcomeText(onboarding),
      summary,
    });
  }
  for (const userId of recipients("founder", config.founderUserIds)) {
    await deliver({
      onboarding,
      kind: "founder",
      periodKey: String(onboarding.id),
      recipientRole: "founder",
      userId,
      text: founderText(onboarding),
      summary,
    });
  }
  return summary;
}

async function deliverDigest(input: {
  onboarding: Onboarding;
  kind: "first" | "daily";
  periodKey: string;
  coverageStart: Date;
  now: Date;
  summary: FirstValueSummary;
}) {
  const digest = await buildProjectDigest({
    projectId: input.onboarding.projectId,
    kind: input.kind,
    coverageStart: input.coverageStart,
    coverageEnd: input.now,
  });
  const config = getTelegramConfig();
  for (const userId of recipients("rp", config.rpUserIds)) {
    await deliver({
      onboarding: input.onboarding,
      kind: input.kind,
      periodKey: input.periodKey,
      recipientRole: "rp",
      userId,
      text: digest.text,
      buttons: digest.buttons,
      coverageStart: input.coverageStart,
      coverageEnd: input.now,
      sourceLinks: digest.sourceLinks,
      includedItems: digest.includedItems,
      summary: input.summary,
    });
  }
}

export async function runFirstValueChecks(now = new Date()) {
  const summary: FirstValueSummary = { claimed: 0, sent: 0, duplicates: 0, failed: 0, unknown: 0 };
  const daily = dailyDigestPeriod(now, projectTimeZone());
  const coverageStart = new Date(now.getTime() - 7 * 86_400_000);
  const onboardings = await listTelegramOnboardings();
  for (const onboarding of onboardings) {
    if (onboarding.firstDigestDueAt <= now) {
      await deliverDigest({
        onboarding,
        kind: "first",
        periodKey: String(onboarding.id),
        coverageStart,
        now,
        summary,
      });
    }
    if (daily.due) {
      await deliverDigest({
        onboarding,
        kind: "daily",
        periodKey: daily.periodKey,
        coverageStart,
        now,
        summary,
      });
    }
  }
  return summary;
}
