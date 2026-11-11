import { writeFileSync } from "node:fs";
import { and, eq, or } from "drizzle-orm";
import { auditEvents, decisions, projectCounters, proposalVersions, risks, signals, tasks, telegramPendingEdits } from "../../db/schema";
import { getDb } from "../../api/queries/connection";
import { correctPendingProposal } from "../../api/queries/correction";

const RP_ID = 978300001;
const MEMBER_ID = 978300002;
const CHAT_ID = "-100978300001";
process.env.TELEGRAM_BOT_TOKEN = "synthetic-bl41-token";
process.env.TELEGRAM_WEBHOOK_SECRET = "synthetic-bl41-secret";
process.env.TELEGRAM_PROJECT_CHAT_IDS = CHAT_ID;
process.env.TELEGRAM_RP_USER_IDS = String(RP_ID);
process.env.TELEGRAM_MEMBER_USER_IDS = String(MEMBER_ID);
process.env.TELEGRAM_API_BASE_URL = "http://synthetic-telegram";
process.env.TELEGRAM_GATEWAY_SECRET = "";
process.env.PMO_WORKSPACE_URL = "https://synthetic-workspace.example/workspace.html";
process.env.KIMI_AGENTGW_BASE_URL = "http://synthetic-ai";
process.env.KIMI_AGENTGW_API_KEY = "synthetic-bl41-ai";

const telegramCalls: { method: string; payload: Record<string, unknown> }[] = [];
let aiChatCalls = 0;
let aiShouldFail = false;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/models")) {
    return new Response(JSON.stringify({ data: [{ id: "synthetic-model" }], default_model_id: "synthetic-model" }), { status: 200 });
  }
  const payload = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
  if (url.endsWith("/chat/completions")) {
    aiChatCalls += 1;
    if (aiShouldFail) return new Response(JSON.stringify({ error: { message: "Synthetic AI failure" } }), { status: 500 });
    const content = JSON.stringify({ title: "Edited synthetic proposal", owner: "Edited owner", due: "21.11.2026" });
    return new Response(JSON.stringify({
      id: "synthetic-edit", object: "chat.completion", created: 1, model: "synthetic-model",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const method = url.split("/").pop() || "";
  telegramCalls.push({ method, payload });
  const result = method === "sendMessage" ? { message_id: 9000 + telegramCalls.length } : true;
  return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { "Content-Type": "application/json" } });
};

const { handleCallback, handlePrivateMessage } = await import("../../api/routes/telegram");
const db = getDb();
const ids = ["EDIT", "CANCEL", "REJECT", "STALE", "AIERROR"] as const;
for (const [index, key] of ids.entries()) {
  const suffix = `BL41-${key}`;
  await db.insert(signals).values({
    id: `S-${suffix}`, projectId: "PRJ-01", channel: "telegram", channelId: "CH-BL41", chatId: CHAT_ID,
    messageId: 300 + index, authorId: String(MEMBER_ID), authorName: "Synthetic member", content: `Synthetic source ${key}`,
    status: "risk_created", riskId: `R-${suffix}`,
  });
  await db.insert(risks).values({
    id: `R-${suffix}`, projectId: "PRJ-01", title: `Synthetic risk ${key}`, recordType: "auto", channel: "telegram",
    impact: "Synthetic impact", probability: "средняя", confidence: 90, measure: "Synthetic measure", source: "Synthetic BL-41",
  });
  await db.insert(decisions).values({
    id: `D-${suffix}`, projectId: "PRJ-01", riskId: `R-${suffix}`, title: `Original proposal ${key}`,
    rationale: "Original rationale", effect: "Original effect", status: "wait", displayDate: "07.11",
    proposalOwner: "Original owner", proposalDue: "20.11.2026",
  });
  await db.insert(proposalVersions).values({
    projectId: "PRJ-01", proposalId: `D-${suffix}`, version: 1, title: `Original proposal ${key}`,
    rationale: "Original rationale", effect: "Original effect", owner: "Original owner", due: "20.11.2026",
    actorName: "Пиэмка", actorRole: "system", attribution: "Пиэмка · автоматически",
  });
}

function callback(action: string, decisionId: string, userId = RP_ID) {
  return {
    id: `cb-${action}-${decisionId}-${telegramCalls.length}`,
    from: { id: userId, first_name: userId === RP_ID ? "Synthetic RP" : "Synthetic member" },
    data: `${action}:${decisionId}`,
    message: { message_id: 8000 + telegramCalls.length, chat: { id: userId } },
  };
}
function instruction(decisionId: string, text = "Apply the synthetic edit") {
  return handlePrivateMessage({
    message_id: 7000 + aiChatCalls,
    from: { id: RP_ID, first_name: "Synthetic RP" },
    chat: { id: RP_ID },
    text,
  }).then((status) => ({ status, decisionId }));
}
const decision = (id: string) => db.select().from(decisions).where(eq(decisions.id, id)).limit(1).then((rows) => rows[0]);
const decisionTasks = (id: string) => db.select().from(tasks).where(eq(tasks.decisionId, id));
const decisionEvents = (id: string) => db.select().from(auditEvents)
  .where(or(eq(auditEvents.entityId, id), eq(auditEvents.relatedId, id)));
const pendingEdit = (id: string) => db.select().from(telegramPendingEdits)
  .where(and(eq(telegramPendingEdits.decisionId, id), eq(telegramPendingEdits.userId, String(RP_ID)))).limit(1).then((rows) => rows[0]);

const opened = await handleCallback(callback("open", "R-BL41-EDIT"));
const memberEdit = await handleCallback(callback("edit", "D-BL41-EDIT", MEMBER_ID));
const memberPendingEdit = await pendingEdit("D-BL41-EDIT");
const editStarted = await handleCallback(callback("edit", "D-BL41-EDIT"));
const acceptBeforePreview = await handleCallback(callback("accept", "D-BL41-EDIT"));
const beforePreviewDecision = await decision("D-BL41-EDIT");
const beforePreviewTasks = await decisionTasks("D-BL41-EDIT");
const preview = await instruction("D-BL41-EDIT");
const previewRow = await pendingEdit("D-BL41-EDIT");
const afterPreviewDecision = await decision("D-BL41-EDIT");
const previewVersions = await db.select().from(proposalVersions).where(eq(proposalVersions.proposalId, "D-BL41-EDIT"));
const previewMessage = telegramCalls.find((call) => String(call.payload.text || "").startsWith("Новый предпросмотр D-BL41-EDIT"));
const accepted = await handleCallback(callback("accept", "D-BL41-EDIT"));
const acceptedDecision = await decision("D-BL41-EDIT");
const acceptedTasks = await decisionTasks("D-BL41-EDIT");
const acceptedEvents = await decisionEvents("D-BL41-EDIT");
const acceptedVersions = await db.select().from(proposalVersions).where(eq(proposalVersions.proposalId, "D-BL41-EDIT"));
const acceptedEdit = await pendingEdit("D-BL41-EDIT");
const repeatedAccept = await handleCallback(callback("accept", "D-BL41-EDIT"));
const repeatedTasks = await decisionTasks("D-BL41-EDIT");
const repeatedEvents = await decisionEvents("D-BL41-EDIT");
const acceptedCounter = await db.select().from(projectCounters).where(eq(projectCounters.counterName, "task")).limit(1);
const demoRisk = await db.select().from(risks).where(eq(risks.id, "R-101")).limit(1);

await handleCallback(callback("edit", "D-BL41-CANCEL"));
await instruction("D-BL41-CANCEL");
const cancelled = await handleCallback(callback("editcancel", "D-BL41-CANCEL"));
const cancelledDecision = await decision("D-BL41-CANCEL");
const cancelledVersions = await db.select().from(proposalVersions).where(eq(proposalVersions.proposalId, "D-BL41-CANCEL"));
const cancelledEvents = await decisionEvents("D-BL41-CANCEL");
const cancelledTasks = await decisionTasks("D-BL41-CANCEL");

const rejected = await handleCallback(callback("reject", "D-BL41-REJECT"));
const rejectedDecision = await decision("D-BL41-REJECT");
const rejectedTasks = await decisionTasks("D-BL41-REJECT");
const rejectedEvents = await decisionEvents("D-BL41-REJECT");

await handleCallback(callback("edit", "D-BL41-STALE"));
await instruction("D-BL41-STALE");
await correctPendingProposal({ decisionId: "D-BL41-STALE", title: "Concurrent web correction" }, { userId: 1, name: "Synthetic web RP" });
const staleAccept = await handleCallback(callback("accept", "D-BL41-STALE"));
const staleDecision = await decision("D-BL41-STALE");
const staleTasks = await decisionTasks("D-BL41-STALE");

await handleCallback(callback("edit", "D-BL41-AIERROR"));
aiShouldFail = true;
const failedPreview = await instruction("D-BL41-AIERROR");
const failedEdit = await pendingEdit("D-BL41-AIERROR");
const failedDecision = await decision("D-BL41-AIERROR");
aiShouldFail = false;
const retriedPreview = await instruction("D-BL41-AIERROR");
const retriedEdit = await pendingEdit("D-BL41-AIERROR");

const checks = {
  non_rp_cannot_start_edit: memberEdit === "ignored" && !memberPendingEdit,
  edit_starts_pending_without_mutating_proposal: editStarted === "processed"
    && beforePreviewDecision.status === "wait"
    && beforePreviewDecision.title === "Original proposal EDIT",
  accept_is_blocked_until_preview_or_cancel: acceptBeforePreview === "ignored"
    && beforePreviewDecision.proposalVersion === 1
    && beforePreviewTasks.length === 0,
  one_instruction_creates_preview_without_mutating_original: preview.status === "processed"
    && aiChatCalls >= 1
    && previewRow.status === "preview"
    && afterPreviewDecision.title === "Original proposal EDIT"
    && afterPreviewDecision.proposalVersion === 1
    && previewVersions.length === 1
    && String(previewMessage?.payload.text || "").includes("Edited synthetic proposal")
    && !String(previewMessage?.payload.text || "").includes("Diff:")
    && !String(previewMessage?.payload.text || "").includes("Исходная версия не изменена"),
  accept_applies_version_diff_attribution_decision_and_task_atomically: accepted === "processed"
    && acceptedDecision.status === "ok"
    && acceptedDecision.proposalVersion === 2
    && acceptedDecision.title === "Edited synthetic proposal"
    && acceptedTasks.length === 1
    && acceptedTasks[0].title === "Edited synthetic proposal"
    && acceptedVersions.length === 2
    && (acceptedVersions.find((row) => row.version === 2)?.editDistance || 0) > 0
    && acceptedVersions.find((row) => row.version === 2)?.actorRole === "rp"
    && acceptedEvents.filter((row) => row.eventType === "proposal.edited" && row.channel === "telegram").length === 1
    && acceptedEvents.filter((row) => row.eventType === "decision.accepted").length === 1
    && acceptedEvents.filter((row) => row.eventType === "task.created").length === 1
    && acceptedEdit.status === "accepted"
    && telegramCalls.some((call) => call.method === "editMessageText"
      && String(call.payload.text || "").includes("Реестр поручений: https://synthetic-workspace.example/workspace.html?view=tasks")),
  repeated_accept_has_no_duplicates: repeatedAccept === "processed"
    && repeatedTasks.length === 1
    && repeatedEvents.filter((row) => row.eventType === "proposal.edited").length === 1
    && repeatedEvents.filter((row) => row.eventType === "decision.accepted").length === 1
    && repeatedEvents.filter((row) => row.eventType === "task.created").length === 1,
  short_task_id_atomic_and_repeat_stable: acceptedTasks.length === 1
    && acceptedCounter.length === 1
    && acceptedTasks[0].id === `P-${String(acceptedCounter[0].nextValue).padStart(2, "0")}`
    && acceptedTasks[0].id.length <= 4,
  decision_does_not_create_demo_seed_records: demoRisk.length === 0,
  cancel_after_preview_preserves_original_and_creates_no_version_or_task: cancelled === "processed"
    && cancelledDecision.status === "wait"
    && cancelledDecision.title === "Original proposal CANCEL"
    && cancelledDecision.proposalVersion === 1
    && cancelledVersions.length === 1
    && cancelledEvents.filter((row) => row.eventType === "proposal.edited").length === 0
    && cancelledTasks.length === 0,
  reject_creates_decision_without_task: rejected === "processed"
    && rejectedDecision.status === "no"
    && rejectedTasks.length === 0
    && rejectedEvents.filter((row) => row.eventType === "decision.rejected").length === 1,
  stale_preview_cannot_overwrite_newer_version: staleAccept === "error"
    && staleDecision.status === "wait"
    && staleDecision.proposalVersion === 2
    && staleDecision.title === "Concurrent web correction"
    && staleTasks.length === 0,
  ai_failure_preserves_original_and_allows_explicit_retry: failedPreview.status === "error"
    && failedEdit.status === "pending"
    && failedDecision.title === "Original proposal AIERROR"
    && failedDecision.proposalVersion === 1
    && retriedPreview.status === "processed"
    && retriedEdit.status === "preview",
  opened_card_has_no_more_than_three_actions: (() => {
    const openCall = telegramCalls.find((call) => String(call.payload.text || "").includes("Исходный сигнал"));
    const keyboard = (openCall?.payload.reply_markup as { inline_keyboard?: unknown[][] } | undefined)?.inline_keyboard || [];
    return opened === "processed" && keyboard.flat().length === 3;
  })(),
  all_new_outbound_messages_stay_in_rp_dm: telegramCalls.filter((call) => call.method === "sendMessage")
    .every((call) => call.payload.chat_id === String(RP_ID)),
};

const evidence = {
  mode: "BL-41 Telegram Edit through real route handlers on isolated MySQL with synthetic fixtures and mock AI/Telegram; no production or real Telegram calls",
  checks,
  allChecksPassed: Object.values(checks).every(Boolean),
  result: {
    accepted: { status: acceptedDecision.status, version: acceptedDecision.proposalVersion, tasks: repeatedTasks.length },
    versions: acceptedVersions.map((row) => ({ version: row.version, actorRole: row.actorRole, editDistance: row.editDistance })),
    eventTypes: repeatedEvents.map((row) => row.eventType),
    cancel: { status: cancelledDecision.status, version: cancelledDecision.proposalVersion, versions: cancelledVersions.length },
    reject: { status: rejectedDecision.status, tasks: rejectedTasks.length },
    stale: { callback: staleAccept, status: staleDecision.status, version: staleDecision.proposalVersion },
    aiRetry: { first: failedPreview.status, retry: retriedPreview.status },
    aiChatCalls,
    telegramCalls: telegramCalls.length,
  },
};
writeFileSync(new URL("./bl41-telegram-edit-evidence.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.allChecksPassed) throw new Error("BL-41 Telegram Edit contract failed");
process.exit(0);
