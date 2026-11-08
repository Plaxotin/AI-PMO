import { writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import {
  auditEvents,
  decisions,
  projects,
  risks,
  signals,
  tasks,
  telegramDigestDeliveries,
  telegramOnboardings,
} from "../../db/schema";
import { getDb } from "../../api/queries/connection";
import {
  buildProjectDigest,
  ensureTelegramOnboarding,
  getFirstValueMetrics,
  recordRiskOpened,
} from "../../api/queries/first-value";
import {
  dailyDigestPeriod,
  deliverOnboardingMessages,
  runFirstValueChecks,
} from "../../api/telegram/first-value";

const PROJECT_ID = "PRJ-BL54";
const EMPTY_PROJECT_ID = "PRJ-BL54-EMPTY";
const RP_ID = "978200001";
const FOUNDER_ID = "978200002";
const SYNTHETIC_CHAT_ID = "-100978200001";
const connectedAt = new Date("2026-11-07T07:30:00.000Z");
const firstDue = new Date("2026-11-07T08:30:00.000Z");

process.env.TELEGRAM_BOT_TOKEN = "synthetic-bl54-token";
process.env.TELEGRAM_WEBHOOK_SECRET = "synthetic-bl54-webhook";
process.env.TELEGRAM_PROJECT_CHAT_IDS = SYNTHETIC_CHAT_ID;
process.env.TELEGRAM_RP_USER_IDS = RP_ID;
process.env.TELEGRAM_FOUNDER_USER_IDS = FOUNDER_ID;
process.env.TELEGRAM_API_BASE_URL = "http://127.0.0.1:9/telegram";
process.env.TELEGRAM_GATEWAY_SECRET = "";
process.env.PROJECT_TIME_ZONE = "UTC";

type Call = { url: string; payload: Record<string, unknown> };
const calls: Call[] = [];
let deliveryMode: "sent" | "failed" | "unknown" = "sent";
globalThis.fetch = async (input, init) => {
  const payload = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
  calls.push({ url: String(input), payload });
  if (deliveryMode === "unknown") throw new Error("Synthetic network timeout");
  if (deliveryMode === "failed") {
    return new Response(JSON.stringify({ ok: false, description: "Synthetic Telegram explicit rejection" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true, result: { message_id: 5000 + calls.length } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

const db = getDb();
// Isolated database only: remove scheduler state from earlier contract scenarios.
await db.delete(telegramDigestDeliveries);
await db.delete(telegramOnboardings);
await db.insert(projects).values([
  { id: PROJECT_ID, name: "Synthetic BL-54 project" },
  { id: EMPTY_PROJECT_ID, name: "Synthetic BL-54 empty project" },
]);
await db.insert(signals).values({
  id: "S-BL54-001",
  projectId: PROJECT_ID,
  channel: "telegram",
  channelId: "CH-BL54",
  chatId: SYNTHETIC_CHAT_ID,
  messageId: 101,
  authorId: "synthetic-member",
  authorName: "Synthetic member",
  content: "Synthetic source signal for BL-54",
  status: "risk_created",
  riskId: "R-TG-770070523",
  createdAt: new Date("2026-11-07T07:45:00.000Z"),
  updatedAt: new Date("2026-11-07T07:45:00.000Z"),
});
await db.insert(risks).values({
  id: "R-TG-770070523",
  projectId: PROJECT_ID,
  title: "Synthetic BL-54 supplier risk",
  recordType: "auto",
  channel: "telegram",
  impact: "Synthetic schedule impact",
  probability: "средняя",
  confidence: 91,
  measure: "Synthetic mitigation",
  source: "Synthetic BL-54 source",
  createdAt: new Date("2026-11-07T07:46:00.000Z"),
  updatedAt: new Date("2026-11-07T08:05:00.000Z"),
});
await db.insert(decisions).values({
  id: "D-BL54-001",
  projectId: PROJECT_ID,
  riskId: "R-TG-770070523",
  title: "Synthetic BL-54 proposal",
  rationale: "Synthetic rationale",
  effect: "Synthetic expected effect",
  status: "wait",
  displayDate: "07.11",
  proposalOwner: "Synthetic owner",
  proposalDue: "10.11.2026",
  createdAt: new Date("2026-11-07T07:47:00.000Z"),
  updatedAt: new Date("2026-11-07T07:47:00.000Z"),
});
await db.insert(tasks).values([
  {
    id: "P-BL54-001",
    projectId: PROJECT_ID,
    decisionId: "D-BL54-001",
    riskId: "R-TG-770070523",
    title: "Synthetic BL-54 completed task",
    owner: "Synthetic owner",
    due: "07.11.2026",
    status: "done",
    result: "Synthetic actual completed result",
    completedAt: new Date("2026-11-07T08:00:00.000Z"),
    createdAt: new Date("2026-11-07T07:48:00.000Z"),
    updatedAt: new Date("2026-11-07T08:00:00.000Z"),
  },
  {
    id: "P-BL54-002",
    projectId: PROJECT_ID,
    riskId: "R-TG-770070523",
    title: "Synthetic BL-54 planned task",
    owner: "Synthetic planner",
    due: "10.11.2026",
    status: "new",
    createdAt: new Date("2026-11-07T08:01:00.000Z"),
    updatedAt: new Date("2026-11-07T08:01:00.000Z"),
  },
]);

const { onboarding, created } = await ensureTelegramOnboarding("CH-BL54", PROJECT_ID, connectedAt);
if (!onboarding) throw new Error("BL-54 onboarding was not created");
const firstWelcome = await deliverOnboardingMessages(onboarding);
const callsAfterWelcome = calls.length;
const repeatedWelcome = await deliverOnboardingMessages(onboarding);
const callsAfterRepeatedWelcome = calls.length;

const beforeFirst = await runFirstValueChecks(new Date("2026-11-07T08:29:00.000Z"));
const atFirst = await runFirstValueChecks(firstDue);
const firstDigestCall = calls.find((call) => String(call.payload.text || "").startsWith("☀️ Дайджест проекта"));
const callsAfterFirst = calls.length;
const repeatedFirst = await runFirstValueChecks(new Date("2026-11-07T08:30:30.000Z"));
const callsAfterRepeatedFirst = calls.length;

const atDaily = await runFirstValueChecks(new Date("2026-11-07T09:00:00.000Z"));
const dailyDigestCall = calls.filter((call) => String(call.payload.text || "").startsWith("☀️ Дайджест проекта"))[1];
const callsAfterDaily = calls.length;
const repeatedDaily = await runFirstValueChecks(new Date("2026-11-07T09:00:30.000Z"));
const callsAfterRepeatedDaily = calls.length;

const emptyDigest = await buildProjectDigest({
  projectId: EMPTY_PROJECT_ID,
  kind: "first",
  coverageStart: new Date(firstDue.getTime() - 7 * 86_400_000),
  coverageEnd: firstDue,
});

await recordRiskOpened({
  riskId: "R-TG-770070523",
  decisionId: "D-BL54-001",
  actorUserId: Number(RP_ID),
  actorName: "Synthetic RP",
});
await db.insert(auditEvents).values({
  projectId: PROJECT_ID,
  entityType: "proposal",
  entityId: "D-BL54-001",
  eventType: "decision.accepted",
  relatedId: "R-TG-770070523",
  actorUserId: Number(RP_ID),
  actorName: "Synthetic RP",
  actorRole: "rp",
  attribution: "Telegram · Synthetic RP",
  channel: "telegram",
  detail: "Synthetic accepted decision for BL-54 metrics",
});

deliveryMode = "failed";
const explicitFailure = await runFirstValueChecks(new Date("2026-11-08T09:00:00.000Z"));
const callsAfterFailure = calls.length;
const repeatedFailure = await runFirstValueChecks(new Date("2026-11-08T09:01:00.000Z"));
const callsAfterRepeatedFailure = calls.length;
deliveryMode = "unknown";
const unknownFailure = await runFirstValueChecks(new Date("2026-11-09T09:00:00.000Z"));
const callsAfterUnknown = calls.length;
const repeatedUnknown = await runFirstValueChecks(new Date("2026-11-09T09:00:30.000Z"));
const callsAfterRepeatedUnknown = calls.length;

const deliveries = await db.select().from(telegramDigestDeliveries)
  .where(eq(telegramDigestDeliveries.projectId, PROJECT_ID));
const events = await db.select().from(auditEvents)
  .where(eq(auditEvents.projectId, PROJECT_ID));
const failedDelivery = await db.select().from(telegramDigestDeliveries)
  .where(and(
    eq(telegramDigestDeliveries.projectId, PROJECT_ID),
    eq(telegramDigestDeliveries.kind, "daily"),
    eq(telegramDigestDeliveries.periodKey, "2026-11-08"),
  )).limit(1);
const unknownDelivery = await db.select().from(telegramDigestDeliveries)
  .where(and(
    eq(telegramDigestDeliveries.projectId, PROJECT_ID),
    eq(telegramDigestDeliveries.kind, "daily"),
    eq(telegramDigestDeliveries.periodKey, "2026-11-09"),
  )).limit(1);
const metrics = await getFirstValueMetrics(PROJECT_ID);
const welcomeCall = calls.find((call) => String(call.payload.text || "").includes("Пиэмка подключила проект"));
const founderCall = calls.find((call) => String(call.payload.text || "").startsWith("AI PMO: новое подключение"));
const eventTypes = events.map((event) => event.eventType);
const dailyBeforeNine = dailyDigestPeriod(new Date("2026-11-07T08:59:59.000Z"), "UTC");
const dailyAtNine = dailyDigestPeriod(new Date("2026-11-07T09:00:00.000Z"), "UTC");

const firstDigestText = String(firstDigestCall?.payload.text || "");
const dailyDigestText = String(dailyDigestCall?.payload.text || "");
const factSectionIndex = firstDigestText.indexOf("☑️ Факт — что сделано");
const planSectionIndex = firstDigestText.indexOf("📌 План — что дальше");
const risksSectionIndex = firstDigestText.indexOf("⚠️ Риск — что мешает");
const visibleCodes = firstDigestText.match(/(?<![A-Z])[A-Z]-\d+\b/g) || [];
const firstDigestAudit = [...events].reverse().find((event) => event.entityId === `first:${onboarding.id}`);
const dailyDigestAudit = [...events].reverse().find((event) => event.entityId === "daily:2026-11-07");
const firstIncludedItems = (firstDigestAudit?.metadata as { includedItems?: unknown[] } | null)?.includedItems || [];
const dailyIncludedItems = (dailyDigestAudit?.metadata as { includedItems?: unknown[] } | null)?.includedItems || [];
const checks = {
  onboarding_persists_connection_and_first_due: created
    && onboarding.firstDigestDueAt.toISOString() === firstDue.toISOString()
    && eventTypes.includes("channel.connected"),
  immediate_welcome_and_sanitized_founder_signal: firstWelcome.sent === 2
    && firstWelcome.failed === 0
    && welcomeCall?.payload.chat_id === RP_ID
    && String(welcomeCall?.payload.text || "").includes("через час")
    && founderCall?.payload.chat_id === FOUNDER_ID
    && !String(founderCall?.payload.text || "").includes("Synthetic source signal")
    && !String(founderCall?.payload.text || "").includes(SYNTHETIC_CHAT_ID),
  welcome_and_founder_are_durable_deduplicated: repeatedWelcome.sent === 0
    && repeatedWelcome.duplicates === 2
    && callsAfterRepeatedWelcome === callsAfterWelcome,
  no_digest_before_one_hour: beforeFirst.claimed === 0 && beforeFirst.sent === 0,
  first_digest_has_simple_numbered_sections_short_codes_and_changed_risk: atFirst.sent === 1
    && Boolean(firstDigestCall)
    && firstDigestText.startsWith("☀️ Дайджест проекта · 07.11.2026")
    && !firstDigestText.includes("Период")
    && !firstDigestText.includes("Покрытие")
    && !firstDigestText.includes("2026-11-07T")
    && !firstDigestText.includes("•")
    && !/\b(?:new|done)\b/.test(firstDigestText)
    && factSectionIndex >= 0
    && planSectionIndex > factSectionIndex
    && risksSectionIndex > planSectionIndex
    && firstDigestText.includes("☑️ Факт — что сделано\n1. P-1")
    && firstDigestText.includes("📌 План — что дальше\n1. P-2")
    && firstDigestText.includes("⚠️ Риск — что мешает\n1. P-1")
    && firstDigestText.includes("Synthetic BL-54 completed task")
    && firstDigestText.includes("Synthetic actual completed result")
    && firstDigestText.includes("Synthetic BL-54 planned task")
    && firstDigestText.includes("Synthetic BL-54 supplier risk")
    && firstDigestText.includes("· изменён")
    && firstDigestText.includes("Решение R-1 · Поручение P-1")
    && !firstDigestText.includes("Synthetic BL-54 proposal")
    && firstDigestText.includes("Уверенность: 91%")
    && firstDigestText.includes("https://t.me/c/")
    && visibleCodes.length > 0
    && visibleCodes.every((code) => /^[A-Z]-\d{1,3}$/.test(code))
    && !firstDigestText.includes("R-TG-")
    && !firstDigestText.includes("P-BL54-")
    && !firstDigestText.includes("D-BL54-")
    && JSON.stringify(firstDigestCall?.payload.reply_markup || {}).includes("Открыть риск P-1")
    && JSON.stringify(firstDigestCall?.payload.reply_markup || {}).includes("open:R-TG-770070523")
    && firstIncludedItems.length === 2,
  first_digest_restart_and_repeat_do_not_duplicate: repeatedFirst.sent === 0
    && repeatedFirst.duplicates === 1
    && callsAfterRepeatedFirst === callsAfterFirst,
  daily_digest_starts_at_nine_and_dedupes_facts_plans: atDaily.sent === 1
    && atDaily.duplicates === 1
    && Boolean(dailyDigestCall)
    && dailyAtNine.due
    && dailyAtNine.periodKey === "2026-11-07"
    && !dailyBeforeNine.due
    && !dailyDigestText.includes("Synthetic BL-54 completed task")
    && !dailyDigestText.includes("Synthetic BL-54 planned task")
    && dailyDigestText.includes("Новых фактов к текущей дате нет")
    && dailyDigestText.includes("Новых планов к текущей дате нет")
    && dailyDigestText.includes("Synthetic BL-54 supplier risk")
    && dailyIncludedItems.length === 0,
  daily_digest_restart_and_repeat_do_not_duplicate: repeatedDaily.sent === 0
    && repeatedDaily.duplicates === 2
    && callsAfterRepeatedDaily === callsAfterDaily,
  empty_digest_is_honest: emptyDigest.riskCount === 0
    && emptyDigest.completedCount === 0
    && emptyDigest.plannedCount === 0
    && emptyDigest.buttons.length === 0
    && emptyDigest.text.includes("Новых фактов к текущей дате нет")
    && emptyDigest.text.includes("Новых планов к текущей дате нет")
    && emptyDigest.text.includes("Открытых или изменённых рисков нет"),
  metrics_link_connection_delivery_open_and_decision_to_project: metrics.projectId === PROJECT_ID
    && metrics.connections === 1
    && metrics.welcomes === 1
    && metrics.firstDigests === 1
    && metrics.dailyDigests === 1
    && metrics.deliveryAttempts === 4
    && metrics.deliveryFailures === 2
    && metrics.riskOpens === 1
    && metrics.acceptedDecisions === 1
    && metrics.founderNotifications === 1,
  explicit_delivery_failure_is_audited_and_not_blindly_retried: explicitFailure.failed === 1
    && repeatedFailure.sent === 0
    && repeatedFailure.failed === 0
    && callsAfterRepeatedFailure === callsAfterFailure
    && failedDelivery[0]?.status === "failed"
    && eventTypes.includes("delivery.failed"),
  unknown_delivery_outcome_is_audited_and_not_blindly_retried: unknownFailure.unknown === 1
    && repeatedUnknown.sent === 0
    && repeatedUnknown.unknown === 0
    && callsAfterRepeatedUnknown === callsAfterUnknown
    && unknownDelivery[0]?.status === "unknown",
  all_outbound_messages_stay_in_private_targets: calls.every((call) => call.payload.chat_id === RP_ID || call.payload.chat_id === FOUNDER_ID),
  delivery_rows_are_durable_and_bounded: deliveries.filter((row) => row.kind === "welcome").length === 1
    && deliveries.filter((row) => row.kind === "founder").length === 1
    && deliveries.filter((row) => row.kind === "first").length === 1
    && deliveries.filter((row) => row.kind === "daily").length === 3,
};

const evidence = {
  mode: "BL-54 first value on isolated MySQL with synthetic projects and mock global Telegram fetch; no production connection or real Telegram sends",
  checks,
  allChecksPassed: Object.values(checks).every(Boolean),
  result: {
    firstDigestDueAt: onboarding.firstDigestDueAt,
    firstSummary: atFirst,
    dailySummary: atDaily,
    deliveryCounts: Object.fromEntries(["welcome", "founder", "first", "daily"].map((kind) => [kind, deliveries.filter((row) => row.kind === kind).length])),
    failedStatus: failedDelivery[0]?.status,
    unknownStatus: unknownDelivery[0]?.status,
    metrics,
    outboundCallCount: calls.length,
    emptyDigest: { riskCount: emptyDigest.riskCount, buttons: emptyDigest.buttons.length },
    debug: { firstDigestText, visibleCodes, firstIncludedItems, replyMarkup: firstDigestCall?.payload.reply_markup },
  },
};
writeFileSync(new URL("./bl54-first-value-evidence.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.allChecksPassed) throw new Error("BL-54 first-value contract failed");
process.exit(0);
