import { writeFile } from "node:fs/promises";
import { eq, inArray, sql } from "drizzle-orm";
import {
  auditEvents,
  channelExternalIds,
  channels,
  decisions,
  projects,
  proposalVersions,
  risks,
  signals,
  tasks,
  telegramCompletionChecks,
  telegramPendingResults,
  telegramSlaNotifications,
  telegramUpdates,
} from "../../db/schema";
import { getDb } from "../../api/queries/connection";
import { runSlaChecks } from "../../api/telegram/escalation-scheduler";

const mode = process.argv[2] || "decision-first";
const db = getDb();
const calls: Array<{ chatId: string; text: string; payload: Record<string, unknown> }> = [];
let nextMessageId = 8000;
const checks: Record<string, boolean> = {};

process.env.TELEGRAM_BOT_TOKEN = "sla-contract-token";
process.env.TELEGRAM_WEBHOOK_SECRET = "sla-contract-secret";
process.env.TELEGRAM_PROJECT_CHAT_IDS = "-100800";
process.env.TELEGRAM_RP_USER_IDS = "101";
process.env.TELEGRAM_MEMBER_USER_IDS = "202";
process.env.TELEGRAM_SPONSOR_USER_IDS = "301";
process.env.TELEGRAM_OWNER_USER_IDS_JSON = '{"Владелец теста":"202"}';
process.env.TELEGRAM_GATEWAY_SECRET = "";
process.env.PROJECT_TIME_ZONE = "Europe/Moscow";

globalThis.fetch = async (_input, init) => {
  const payload = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
  const text = String(payload.text || "");
  calls.push({ chatId: String(payload.chat_id), text, payload });
  if (text.includes("D-SLA-FAIL")) {
    return new Response(JSON.stringify({ ok: false, description: "synthetic rejected delivery" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (text.includes("D-SLA-UNKNOWN")) throw new TypeError("synthetic network outcome unknown");
  nextMessageId += 1;
  return new Response(JSON.stringify({ ok: true, result: { message_id: nextMessageId } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function clean() {
  for (const table of [
    "telegram_sla_notifications",
    "telegram_completion_checks",
    "telegram_pending_results",
    "telegram_updates",
    "audit_events",
    "tasks",
    "proposal_versions",
    "decisions",
    "signals",
    "risks",
    "channel_external_ids",
    "channels",
    "projects",
  ]) {
    await db.execute(sql.raw(`DELETE FROM ${table}`));
  }
}

async function seedDecision(id = "D-SLA-1", pendingSince = new Date("2026-11-05T04:00:00.000Z")) {
  const suffix = id.replace("D-SLA-", "");
  const riskId = `R-SLA-${suffix}`;
  const signalId = `S-SLA-${suffix}`;
  await db.insert(projects).values({ id: "PRJ-01", name: "Изолированный SLA contract" }).onDuplicateKeyUpdate({ set: { name: "Изолированный SLA contract" } });
  await db.insert(risks).values({
    id: riskId,
    projectId: "PRJ-01",
    title: `Synthetic risk ${suffix}`,
    recordType: "auto",
    channel: "tg",
    impact: "Synthetic impact",
    probability: "активный",
    confidence: 95,
    measure: "Synthetic measure",
    source: "synthetic",
  });
  await db.insert(signals).values({
    id: signalId,
    projectId: "PRJ-01",
    channel: "tg",
    channelId: `CH-SLA-${suffix}`,
    chatId: "-100800",
    messageId: 900 + [...suffix].reduce((sum, char) => sum + char.charCodeAt(0), 0),
    authorId: "202",
    authorName: "Synthetic member",
    content: "Synthetic source signal",
    status: "risk_created",
    riskId,
  });
  await db.insert(decisions).values({
    id,
    projectId: "PRJ-01",
    riskId,
    title: `Synthetic proposal ${suffix}`,
    rationale: "Synthetic rationale",
    effect: "Synthetic effect",
    status: "wait",
    proposalVersion: 1,
    displayDate: "05.11",
    proposalOwner: "Владелец теста",
    proposalDue: "09.11.2026",
    createdAt: pendingSince,
    updatedAt: pendingSince,
  });
  await db.insert(proposalVersions).values({
    projectId: "PRJ-01",
    proposalId: id,
    version: 1,
    title: `Synthetic proposal ${suffix}`,
    rationale: "Synthetic rationale",
    effect: "Synthetic effect",
    owner: "Владелец теста",
    due: "09.11.2026",
    actorName: "Пиэмка",
    actorRole: "system",
    attribution: "Пиэмка · автоматически",
    createdAt: pendingSince,
  });
  await db.insert(auditEvents).values({
    projectId: "PRJ-01",
    entityType: "proposal",
    entityId: id,
    eventType: "proposal.created",
    relatedId: riskId,
    actorName: "Пиэмка",
    actorRole: "system",
    attribution: "Пиэмка · автоматически",
    channel: "telegram",
    version: 1,
    detail: "Synthetic proposal created",
    createdAt: pendingSince,
  });
}

async function seedTask() {
  await seedDecision();
  await db.update(decisions).set({ status: "ok" }).where(eq(decisions.id, "D-SLA-1"));
  await db.insert(tasks).values({
    id: "P-SLA-1",
    projectId: "PRJ-01",
    decisionId: "D-SLA-1",
    riskId: "R-SLA-1",
    title: "Synthetic overdue task",
    owner: "Владелец теста",
    due: "07.11.2026",
    status: "new",
    source: "synthetic",
  });
}

async function snapshot() {
  const [notificationRows, eventRows] = await Promise.all([
    db.select().from(telegramSlaNotifications),
    db.select().from(auditEvents),
  ]);
  return {
    notifications: notificationRows.map((row) => ({
      id: row.id,
      objectType: row.objectType,
      objectId: row.objectId,
      objectVersion: row.objectVersion,
      step: row.step,
      recipientRole: row.recipientRole,
      recipientConfigured: Boolean(row.userId),
      status: row.status,
      messageId: row.messageId,
      error: row.error,
    })),
    events: eventRows.map((row) => ({
      entityType: row.entityType,
      entityId: row.entityId,
      eventType: row.eventType,
      relatedId: row.relatedId,
      version: row.version,
      sourceLinks: row.sourceLinks,
      metadata: row.metadata,
    })),
  };
}

async function finish(extra: Record<string, unknown> = {}) {
  const result = {
    mode: "isolated MySQL with synthetic fixtures and mock fetch; no real Telegram connection",
    scenario: mode,
    checks,
    allChecksPassed: Object.values(checks).every(Boolean),
    calls,
    database: await snapshot(),
    ...extra,
  };
  assert(result.allChecksPassed, `Failed checks in ${mode}`);
  await writeFile(new URL(`./sla-${mode}-evidence.json`, import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

async function decisionFirst() {
  await clean();
  await seedDecision();
  const early = await runSlaChecks(new Date("2026-11-06T03:59:00.000Z"));
  assert(early.sent === 0 && early.claimed === 0 && calls.length === 0, "Decision fired before 24 hours");
  checks.decision_23_59_no_event = true;

  const at24 = await runSlaChecks(new Date("2026-11-06T04:00:00.000Z"));
  assert(at24.sent === 1 && calls.length === 1 && calls[0].chatId === "101", "Decision reminder was not sent to RP at 24 hours");
  assert(!("reply_markup" in calls[0].payload), "RP reminder unexpectedly has action buttons");
  checks.decision_24h_rp_reminder = true;

  const repeat = await runSlaChecks(new Date("2026-11-06T04:00:00.000Z"));
  assert(repeat.sent === 0 && repeat.duplicates === 1 && calls.length === 1, "Repeated decision reminder was sent");
  checks.decision_repeat_no_duplicate = true;

  const [left, right] = await Promise.all([
    runSlaChecks(new Date("2026-11-07T04:00:00.000Z")),
    runSlaChecks(new Date("2026-11-07T04:00:00.000Z")),
  ]);
  assert(left.sent + right.sent === 1 && left.duplicates + right.duplicates === 3, "Overlap created a duplicate decision event");
  assert(calls.length === 2 && calls[1].chatId === "301", "Decision escalation was not sent only to sponsor");
  assert(calls[1].text.includes("только чтение") && !("reply_markup" in calls[1].payload), "Sponsor escalation is not read-only");
  checks.decision_48h_sponsor_read_only = true;
  checks.decision_overlap_deduplicated = true;

  const state = await snapshot();
  assert(state.notifications.length === 2 && state.notifications.every((row) => row.status === "sent"), "Decision durable rows are not sent");
  assert(state.events.filter((row) => row.eventType === "decision.reminded").length === 1, "Decision reminder audit count is wrong");
  assert(state.events.filter((row) => row.eventType === "decision.escalated").length === 1, "Decision escalation audit count is wrong");
  assert(state.events.filter((row) => row.eventType.startsWith("decision.")).every((row) => row.sourceLinks?.[0]?.url), "Decision audit lost source link");
  checks.decision_audit_and_source_chain = true;
  await finish({ summaries: { early, at24, repeat, overlap: [left, right] } });
}

async function decisionRestart() {
  const before = calls.length;
  const replay = await runSlaChecks(new Date("2026-11-07T04:00:00.000Z"));
  assert(replay.sent === 0 && replay.duplicates === 2 && calls.length === before, "Restart repeated a decision notification");
  checks.decision_restart_replay_no_duplicate = true;

  const version2Since = new Date("2026-11-07T04:00:00.000Z");
  await db.update(decisions).set({ proposalVersion: 2 }).where(eq(decisions.id, "D-SLA-1"));
  await db.insert(proposalVersions).values({
    projectId: "PRJ-01",
    proposalId: "D-SLA-1",
    version: 2,
    title: "Synthetic proposal version 2",
    rationale: "Synthetic rationale v2",
    effect: "Synthetic effect v2",
    owner: "Владелец теста",
    due: "10.11.2026",
    actorName: "РП",
    actorRole: "rp",
    attribution: "Пиэмка от имени РП",
    createdAt: version2Since,
  });
  const earlyV2 = await runSlaChecks(new Date("2026-11-08T03:59:00.000Z"));
  assert(earlyV2.sent === 0 && calls.length === 0, "Version 2 inherited version 1 timestamp");
  checks.decision_version_uses_new_timestamp = true;

  const at24V2 = await runSlaChecks(new Date("2026-11-08T04:00:00.000Z"));
  assert(at24V2.sent === 1 && at24V2.duplicates === 0 && calls.length === 1, `Version 2 did not create a new reminder context: ${JSON.stringify({ at24V2, calls })}`);
  assert(calls[0].text.includes("Synthetic proposal version 2"), "Version 2 reminder used stale content");
  checks.decision_version_new_sla_context = true;

  await db.update(decisions).set({ status: "ok" }).where(eq(decisions.id, "D-SLA-1"));
  const closed = await runSlaChecks(new Date("2026-11-09T04:00:00.000Z"));
  assert(closed.claimed === 0 && closed.sent === 0 && calls.length === 1, "Accepted decision still produces SLA events");
  checks.decision_accept_stops_events = true;
  await finish({ summaries: { replay, earlyV2, at24V2, closed } });
}

async function decisionLate() {
  await clean();
  await seedDecision();
  const late = await runSlaChecks(new Date("2026-11-07T04:00:00.000Z"));
  assert(late.sent === 2 && calls.length === 2, "Downtime lost a crossed SLA step");
  const state = await snapshot();
  assert(new Set(state.notifications.map((row) => row.step)).size === 2, "Both durable SLA steps were not recorded");
  checks.decision_downtime_records_reminder_and_escalation = true;
  await finish({ summary: late });
}

async function taskFirst() {
  await clean();
  await seedTask();
  const dueDay = await runSlaChecks(new Date("2026-11-07T20:59:00.000Z"));
  assert(dueDay.claimed === 0 && calls.length === 0, "Task became overdue on its due date");
  checks.task_due_day_no_event = true;

  const nextDay = await runSlaChecks(new Date("2026-11-07T21:00:00.000Z"));
  assert(nextDay.sent === 1 && calls.length === 1 && calls[0].chatId === "202", "Overdue reminder was not sent to exact owner");
  assert(!("reply_markup" in calls[0].payload), "Owner reminder unexpectedly has buttons");
  checks.task_next_day_owner_reminder = true;

  const repeat = await runSlaChecks(new Date("2026-11-07T21:00:00.000Z"));
  assert(repeat.duplicates === 1 && repeat.sent === 0 && calls.length === 1, "Task reminder repeated");
  checks.task_repeat_no_duplicate = true;

  const at24 = await runSlaChecks(new Date("2026-11-08T21:00:00.000Z"));
  assert(at24.sent === 2 && at24.duplicates === 1 && calls.length === 3, "Task 24-hour escalation recipients are wrong");
  assert(new Set(calls.slice(1).map((call) => call.chatId)).size === 2, "Sponsor and RP copy were not both delivered");
  assert(calls.slice(1).some((call) => call.chatId === "301" && call.text.includes("Эскалация спонсору")), "Sponsor task escalation missing");
  assert(calls.slice(1).some((call) => call.chatId === "101" && call.text.includes("Копия РП")), "RP task escalation copy missing");
  assert(calls.every((call) => call.chatId !== "-100800" && !("reply_markup" in call.payload)), "Task SLA wrote to a group or added buttons");
  checks.task_24h_sponsor_and_rp_copy = true;
  checks.task_no_group_writes_or_buttons = true;

  const state = await snapshot();
  assert(state.events.filter((row) => row.eventType === "task.reminded").length === 1, "Task reminder audit count is wrong");
  assert(state.events.filter((row) => row.eventType === "task.escalated").length === 2, "Task escalation audit count is wrong");
  assert(state.events.filter((row) => row.eventType.startsWith("task.")).every((row) => row.sourceLinks?.[0]?.url), "Task audit lost source link");
  checks.task_audit_and_source_chain = true;

  await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, "P-SLA-1"));
  const done = await runSlaChecks(new Date("2026-11-10T21:00:00.000Z"));
  assert(done.claimed === 0 && calls.length === 3, "Done task still produces SLA events");
  checks.task_done_stops_events = true;
  await finish({ summaries: { dueDay, nextDay, repeat, at24, done } });
}

async function ownerMapping() {
  await clean();
  await seedTask();
  process.env.TELEGRAM_OWNER_USER_IDS_JSON = "{}";
  const missing = await runSlaChecks(new Date("2026-11-07T21:00:00.000Z"));
  assert(missing.failed === 1 && missing.sent === 0 && calls.length === 0, "Missing owner mapping was not observable");
  let state = await snapshot();
  assert(state.notifications.length === 1 && state.notifications[0].status === "failed" && !state.notifications[0].recipientConfigured, "Missing owner failure row is wrong");
  assert(state.events.some((row) => row.eventType === "delivery.failed" && row.metadata?.recipientRole === "owner"), "Missing owner audit is absent");
  checks.task_missing_owner_mapping_observable = true;

  const repeat = await runSlaChecks(new Date("2026-11-07T21:00:00.000Z"));
  assert(repeat.duplicates === 1 && repeat.failed === 0 && calls.length === 0, "Missing owner mapping retried blindly");
  checks.task_missing_owner_no_blind_retry = true;

  process.env.TELEGRAM_OWNER_USER_IDS_JSON = '{"Владелец теста":"202"}';
  const configured = await runSlaChecks(new Date("2026-11-07T21:00:00.000Z"));
  assert(configured.sent === 1 && configured.duplicates === 0 && calls.length === 1 && calls[0].chatId === "202", `Configured owner did not get a separate delivery key: ${JSON.stringify({ configured, calls })}`);
  state = await snapshot();
  assert(state.notifications.length === 2, "Owner mapping did not create a separate durable recipient key");
  checks.task_late_owner_mapping_separate_key = true;
  await finish({ summaries: { missing, repeat, configured } });
}

async function deliveryErrors() {
  await clean();
  await seedDecision("D-SLA-FAIL");
  await seedDecision("D-SLA-UNKNOWN");
  const first = await runSlaChecks(new Date("2026-11-06T04:00:00.000Z"));
  assert(first.failed === 1 && first.unknown === 1 && first.sent === 0, "Delivery outcomes were not distinguished");
  const repeat = await runSlaChecks(new Date("2026-11-06T04:00:00.000Z"));
  assert(repeat.duplicates === 2 && repeat.failed === 0 && repeat.unknown === 0 && calls.length === 2, "Failed or unknown delivery retried blindly");
  const state = await snapshot();
  assert(state.notifications.some((row) => row.objectId === "D-SLA-FAIL" && row.status === "failed"), "Definite failure was not stored");
  assert(state.notifications.some((row) => row.objectId === "D-SLA-UNKNOWN" && row.status === "unknown"), "Unknown outcome was not stored");
  assert(state.events.filter((row) => row.eventType === "delivery.failed").length === 2, "Delivery failure audit count is wrong");
  assert(state.events.some((row) => row.metadata?.deliveryStatus === "unknown"), "Unknown outcome is not observable in audit");
  assert(!state.events.some((row) => row.eventType === "decision.reminded"), "Failed delivery was audited as sent");
  checks.delivery_failed_and_unknown_distinct = true;
  checks.delivery_failures_audited_without_retry = true;
  await finish({ summaries: { first, repeat } });
}

async function regressionSchema() {
  const expected = ["decisions", "tasks", "telegram_completion_checks", "telegram_sla_notifications"];
  for (const table of expected) await db.execute(sql.raw(`SELECT 1 FROM ${table} LIMIT 0`));
  checks.additive_schema_preserves_existing_and_sla_tables = true;
  await finish();
}

try {
  switch (mode) {
    case "decision-first": await decisionFirst(); break;
    case "decision-restart": await decisionRestart(); break;
    case "decision-late": await decisionLate(); break;
    case "task-first": await taskFirst(); break;
    case "owner-mapping": await ownerMapping(); break;
    case "delivery-errors": await deliveryErrors(); break;
    case "schema": await regressionSchema(); break;
    default: throw new Error(`Unknown SLA contract mode: ${mode}`);
  }
} finally {
  if (typeof db.$client?.end === "function") await db.$client.end();
}
