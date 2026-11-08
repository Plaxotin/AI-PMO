import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { DEFAULT_PROJECT_TIME_ZONE, parseTaskDue, projectParts } from "../telegram/completion";
import {
  auditEvents,
  decisions,
  risks,
  signals,
  tasks,
  telegramDigestDeliveries,
  telegramOnboardings,
  type AuditSourceLink,
} from "@db/schema";
import { getDb } from "./connection";
import { DEMO_PROJECT_ID } from "./pmo";
import { telegramSourceLink } from "./proposal-audit";

export type DigestKind = "welcome" | "first" | "daily" | "founder";
export type DigestRecipientRole = "rp" | "founder";

function isDuplicateEntry(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "ER_DUP_ENTRY" || candidate?.cause?.code === "ER_DUP_ENTRY";
}

export async function ensureTelegramOnboarding(
  channelId: string,
  projectId = DEMO_PROJECT_ID,
  connectedAt = new Date(),
) {
  const firstDigestDueAt = new Date(connectedAt.getTime() + 3_600_000);
  try {
    return await getDb().transaction(async (tx) => {
      const [row] = await tx.insert(telegramOnboardings).values({
        projectId,
        channelId,
        connectedAt,
        firstDigestDueAt,
      }).$returningId();
      await tx.insert(auditEvents).values({
        projectId,
        entityType: "channel",
        entityId: channelId,
        eventType: "channel.connected",
        relatedId: String(row.id),
        actorName: "Пиэмка",
        actorRole: "system",
        attribution: "Пиэмка · подключение Telegram",
        channel: "telegram",
        metadata: { onboardingId: row.id, firstDigestDueAt: firstDigestDueAt.toISOString() },
        detail: "Telegram-чат подключён для наблюдения; первый дайджест запланирован через час в личку РП",
      });
      const [onboarding] = await tx.select().from(telegramOnboardings).where(eq(telegramOnboardings.id, row.id)).limit(1);
      return { onboarding, created: true };
    });
  } catch (error) {
    if (!isDuplicateEntry(error)) throw error;
    const [onboarding] = await getDb().select().from(telegramOnboardings)
      .where(eq(telegramOnboardings.projectId, projectId)).limit(1);
    if (!onboarding) throw error;
    return { onboarding, created: false };
  }
}

export async function getTelegramOnboarding(projectId = DEMO_PROJECT_ID) {
  const [onboarding] = await getDb().select().from(telegramOnboardings)
    .where(eq(telegramOnboardings.projectId, projectId)).limit(1);
  return onboarding || null;
}

export async function listTelegramOnboardings() {
  return getDb().select().from(telegramOnboardings).orderBy(telegramOnboardings.id);
}

export async function claimDigestDelivery(input: {
  projectId: string;
  kind: DigestKind;
  periodKey: string;
  recipientRole: DigestRecipientRole;
  userId: string;
  coverageStart?: Date;
  coverageEnd?: Date;
}) {
  try {
    const [row] = await getDb().insert(telegramDigestDeliveries).values({
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

function digestAuditValues(input: {
  projectId: string;
  kind: DigestKind;
  periodKey: string;
  recipientRole: DigestRecipientRole;
  deliveryId: number;
  sourceLinks?: AuditSourceLink[];
  metadata?: Record<string, unknown>;
  detail: string;
  eventType: string;
}) {
  return {
    projectId: input.projectId,
    entityType: "digest",
    entityId: `${input.kind}:${input.periodKey}`,
    eventType: input.eventType,
    relatedId: null,
    actorName: "Пиэмка",
    actorRole: "system",
    attribution: "Пиэмка · автоматически",
    channel: "telegram",
    sourceLinks: input.sourceLinks,
    metadata: {
      delivery: "first_value",
      digestKind: input.kind,
      periodKey: input.periodKey,
      recipientRole: input.recipientRole,
      deliveryId: input.deliveryId,
      ...input.metadata,
    },
    detail: input.detail,
  };
}

export type DigestIncludedItem = {
  section: "fact" | "plan";
  entityType: "task" | "signal" | "audit";
  entityId: string;
  versionKey: string;
};

export async function markDigestDeliverySent(input: {
  deliveryId: number;
  projectId: string;
  kind: DigestKind;
  periodKey: string;
  recipientRole: DigestRecipientRole;
  messageId: number;
  sourceLinks?: AuditSourceLink[];
  includedItems?: DigestIncludedItem[];
}) {
  return getDb().transaction(async (tx) => {
    const [delivery] = await tx.select().from(telegramDigestDeliveries)
      .where(eq(telegramDigestDeliveries.id, input.deliveryId)).for("update");
    if (!delivery || delivery.status !== "sending") return false;
    const sentAt = new Date();
    await tx.update(telegramDigestDeliveries).set({
      status: "sent",
      messageId: input.messageId,
      sentAt,
      error: null,
    }).where(eq(telegramDigestDeliveries.id, input.deliveryId));
    const eventType = input.kind === "founder"
      ? "founder.notified"
      : input.kind === "welcome" ? "connection.welcomed" : "digest.sent";
    await tx.insert(auditEvents).values(digestAuditValues({
      ...input,
      eventType,
      metadata: { messageId: input.messageId, includedItems: input.includedItems || [] },
      detail: input.kind === "founder"
        ? "Основатель уведомлён о новом подключении без содержимого переписки"
        : input.kind === "welcome"
          ? "Приветствие нового подключения доставлено РП"
          : `${input.kind === "first" ? "Первый" : "Ежедневный"} дайджест доставлен РП`,
    }));
    return true;
  });
}

export async function markDigestDeliveryFailed(input: {
  deliveryId: number;
  projectId: string;
  kind: DigestKind;
  periodKey: string;
  recipientRole: DigestRecipientRole;
  outcome: "failed" | "unknown";
  error: string;
  sourceLinks?: AuditSourceLink[];
}) {
  return getDb().transaction(async (tx) => {
    const [delivery] = await tx.select().from(telegramDigestDeliveries)
      .where(eq(telegramDigestDeliveries.id, input.deliveryId)).for("update");
    if (!delivery || delivery.status !== "sending") return false;
    await tx.update(telegramDigestDeliveries).set({
      status: input.outcome,
      error: input.error.slice(0, 4000),
    }).where(eq(telegramDigestDeliveries.id, input.deliveryId));
    await tx.insert(auditEvents).values(digestAuditValues({
      ...input,
      eventType: "delivery.failed",
      metadata: { deliveryStatus: input.outcome, error: input.error.slice(0, 1000) },
      detail: input.outcome === "unknown"
        ? "Результат доставки дайджеста неизвестен; автоматический повтор запрещён"
        : "Доставка дайджеста завершилась явной ошибкой; требуется наблюдаемое восстановление",
    }));
    return true;
  });
}

const DIGEST_ITEM_LIMIT = 3;

function clip(value: string, length: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
}

function digestDate(date: Date, timeZone: string, fullYear = false) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: fullYear ? "numeric" : "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${get("day")}.${get("month")}.${get("year")}`;
}

function numberedTitle(index: number, code: string | undefined, title: string) {
  return `${index + 1}. ${code ? `${code} · ` : ""}${title}`;
}

function includedItemKey(item: DigestIncludedItem) {
  return `${item.section}:${item.entityType}:${item.entityId}:${item.versionKey}`;
}

function itemVersion(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function remainingItems(total: number, shown: number) {
  return total > shown ? `… ещё: ${total - shown}.` : "";
}

export async function buildProjectDigest(input: {
  projectId: string;
  kind: "first" | "daily";
  coverageStart: Date;
  coverageEnd: Date;
}) {
  const db = getDb();
  const timeZone = process.env.PROJECT_TIME_ZONE || DEFAULT_PROJECT_TIME_ZONE;
  const [projectRisks, projectDecisions, projectTasks, projectSignals, previousDigestEvents] = await Promise.all([
    db.select().from(risks).where(eq(risks.projectId, input.projectId)).orderBy(asc(risks.createdAt), asc(risks.id)),
    db.select().from(decisions).where(eq(decisions.projectId, input.projectId)).orderBy(asc(decisions.createdAt), asc(decisions.id)),
    db.select().from(tasks).where(eq(tasks.projectId, input.projectId)).orderBy(asc(tasks.createdAt), asc(tasks.id)),
    db.select().from(signals).where(eq(signals.projectId, input.projectId)).orderBy(asc(signals.createdAt), asc(signals.id)),
    db.select({ metadata: auditEvents.metadata }).from(auditEvents)
      .where(and(eq(auditEvents.projectId, input.projectId), eq(auditEvents.eventType, "digest.sent"))),
  ]);

  const previouslyIncluded = new Set<string>();
  for (const event of previousDigestEvents) {
    const metadata = event.metadata as { includedItems?: DigestIncludedItem[] } | null;
    for (const item of metadata?.includedItems || []) previouslyIncluded.add(includedItemKey(item));
  }

  const riskCodes = new Map(projectRisks.map((risk, index) => [risk.id, `P-${index + 1}`]));
  const decisionCodes = new Map(projectDecisions.map((decision, index) => [decision.id, `R-${index + 1}`]));
  const taskCodes = new Map(projectTasks.map((task, index) => [task.id, `P-${index + 1}`]));
  const decisionByRisk = new Map<string, typeof projectDecisions[number]>();
  const taskByDecision = new Map<string, typeof projectTasks[number]>();
  const signalByRisk = new Map<string, typeof projectSignals[number]>();
  for (const decision of projectDecisions) if (decision.riskId) decisionByRisk.set(decision.riskId, decision);
  for (const task of projectTasks) if (task.decisionId) taskByDecision.set(task.decisionId, task);
  for (const signal of projectSignals) if (signal.riskId) signalByRisk.set(signal.riskId, signal);

  const completed = projectTasks.filter((task) => task.status === "done" && task.completedAt
    && task.completedAt <= input.coverageEnd)
    .map((task) => ({
      task,
      included: {
        section: "fact" as const,
        entityType: "task" as const,
        entityId: task.id,
        versionKey: itemVersion({ title: task.title, owner: task.owner, result: task.result, completedAt: task.completedAt }),
      },
    }))
    .filter(({ included }) => !previouslyIncluded.has(includedItemKey(included)))
    .sort((left, right) => (right.task.completedAt?.getTime() || 0) - (left.task.completedAt?.getTime() || 0));
  const todayKey = projectParts(input.coverageEnd, timeZone).dayKey;
  const planned = projectTasks.map((task) => ({
    task,
    due: parseTaskDue(task.due),
    included: {
      section: "plan" as const,
      entityType: "task" as const,
      entityId: task.id,
      versionKey: itemVersion({
        title: task.title,
        owner: task.owner,
        due: task.due,
        status: task.status,
        updatedAt: task.updatedAt,
      }),
    },
  }))
    .filter(({ task, due, included }) => task.status !== "done" && due && !previouslyIncluded.has(includedItemKey(included)))
    .sort((left, right) => (left.due?.key || "").localeCompare(right.due?.key || ""));

  const includedItems: DigestIncludedItem[] = [];
  const completedItems = completed.slice(0, DIGEST_ITEM_LIMIT).map(({ task, included }, index) => {
    includedItems.push(included);
    const lines = [
      numberedTitle(index, taskCodes.get(task.id), clip(task.title, 140)),
      `  ${clip(task.owner, 60)} · Завершено: ${digestDate(task.completedAt as Date, timeZone)}`,
    ];
    if (task.result?.trim()) lines.push(`  ${clip(task.result, 160)}`);
    return lines.join("\n");
  });
  const plannedItems = planned.slice(0, DIGEST_ITEM_LIMIT).map(({ task, due, included }, index) => {
    includedItems.push(included);
    const overdue = (due?.key || "") < todayKey;
    return [
      numberedTitle(index, taskCodes.get(task.id), clip(task.title, 140)),
      `  ${clip(task.owner, 60)} · Срок: ${task.due}${overdue ? " · просрочено" : ""}`,
    ].join("\n");
  });

  const digestRisks = projectRisks.map((risk) => {
    const decision = decisionByRisk.get(risk.id);
    const task = decision ? taskByDecision.get(decision.id) : undefined;
    const hasCompletedTask = Boolean(task?.status === "done" && task.completedAt);
    const changed = Boolean(hasCompletedTask && task?.completedAt && risk.updatedAt > task.completedAt);
    const closed = hasCompletedTask && !changed;
    return { risk, decision, task, changed, closed };
  })
    .filter(({ closed }) => !closed)
    .sort((left, right) => Number(right.changed) - Number(left.changed)
      || right.risk.updatedAt.getTime() - left.risk.updatedAt.getTime());

  const sourceLinks: AuditSourceLink[] = [];
  const buttons: { text: string; callback_data: string }[][] = [];
  const riskItems = digestRisks.slice(0, DIGEST_ITEM_LIMIT).map(({ risk, decision, task, changed }, index) => {
    const signal = signalByRisk.get(risk.id);
    const sourceLink = signal ? telegramSourceLink(signal.chatId, signal.messageId) : null;
    if (sourceLink) sourceLinks.push(sourceLink);
    const riskCode = riskCodes.get(risk.id) as string;
    const lines = [
      numberedTitle(index, riskCode, `${clip(risk.title, 150)}${changed ? " · изменён" : ""}`),
    ];
    if (risk.impact.trim()) lines.push(`  Прогноз: ${clip(risk.impact, 140)}`);
    lines.push(`  Уверенность: ${risk.confidence === null ? "не оценена" : `${risk.confidence}%`}`);
    lines.push(`  Источник: ${sourceLink?.url || (sourceLink ? `недоступен · ${sourceLink.sourceId}` : "не связан")}`);
    const links = [
      decision ? `Решение ${decisionCodes.get(decision.id)}` : "",
      task ? `Поручение ${taskCodes.get(task.id)}` : "",
    ].filter(Boolean);
    if (links.length) lines.push(`  ${links.join(" · ")}`);
    buttons.push([{ text: `Открыть риск ${riskCode}`, callback_data: `open:${risk.id}` }]);
    return lines.join("\n");
  });

  const sections = [
    [
      "☑️ Факт — что сделано",
      completedItems.join("\n\n") || "Новых фактов к текущей дате нет.",
      remainingItems(completed.length, completedItems.length),
    ],
    [
      "📌 План — что дальше",
      plannedItems.join("\n\n") || "Новых планов к текущей дате нет.",
      remainingItems(planned.length, plannedItems.length),
    ],
    [
      "⚠️ Риск — что мешает",
      riskItems.join("\n\n") || "Открытых или изменённых рисков нет.",
      remainingItems(digestRisks.length, riskItems.length),
    ],
  ].map((section) => section.filter(Boolean).join("\n"));
  return {
    text: `☀️ Дайджест проекта · ${digestDate(input.coverageEnd, timeZone, true)}\n\n${sections.join("\n\n")}`,
    buttons,
    sourceLinks,
    includedItems,
    completedCount: completed.length,
    plannedCount: planned.length,
    riskCount: digestRisks.length,
  };
}

export async function recordRiskOpened(input: {
  riskId: string;
  decisionId: string;
  actorUserId: number;
  actorName: string;
}) {
  const db = getDb();
  const [risk] = await db.select().from(risks).where(eq(risks.id, input.riskId)).limit(1);
  if (!risk) throw new Error("Риск не найден");
  const [signal] = await db.select().from(signals)
    .where(and(eq(signals.projectId, risk.projectId), eq(signals.riskId, input.riskId))).limit(1);
  await db.insert(auditEvents).values({
    projectId: risk.projectId,
    entityType: "risk",
    entityId: input.riskId,
    eventType: "risk.opened",
    relatedId: input.decisionId,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    actorRole: "rp",
    attribution: `Telegram · ${input.actorName}`,
    channel: "telegram",
    sourceLinks: signal ? [telegramSourceLink(signal.chatId, signal.messageId)] : undefined,
    metadata: { decisionId: input.decisionId, metric: "first_value_open" },
    detail: "РП открыл риск в личном Telegram-чате",
  });
}

export async function getFirstValueMetrics(projectId = DEMO_PROJECT_ID) {
  const db = getDb();
  const [events, deliveries] = await Promise.all([
    db.select({ eventType: auditEvents.eventType, metadata: auditEvents.metadata }).from(auditEvents)
      .where(eq(auditEvents.projectId, projectId)),
    db.select({ kind: telegramDigestDeliveries.kind, status: telegramDigestDeliveries.status }).from(telegramDigestDeliveries)
      .where(eq(telegramDigestDeliveries.projectId, projectId)),
  ]);
  const count = (eventType: string, kind?: string) => events.filter((event) => {
    if (event.eventType !== eventType) return false;
    if (!kind) return true;
    const metadata = event.metadata as { digestKind?: string } | null;
    return metadata?.digestKind === kind;
  }).length;
  return {
    projectId,
    connections: count("channel.connected"),
    welcomes: count("connection.welcomed"),
    firstDigests: count("digest.sent", "first"),
    dailyDigests: count("digest.sent", "daily"),
    deliveryAttempts: deliveries.filter((delivery) => delivery.kind === "first" || delivery.kind === "daily").length,
    deliveryFailures: count("delivery.failed"),
    riskOpens: count("risk.opened"),
    acceptedDecisions: count("decision.accepted"),
    rejectedDecisions: count("decision.rejected"),
    founderNotifications: count("founder.notified"),
    pendingDeliveries: deliveries.filter((delivery) => delivery.status === "sending").length,
  };
}
