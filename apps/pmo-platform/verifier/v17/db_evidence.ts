import { eq, inArray } from "drizzle-orm";
import { auditEvents, channelExternalIds, channels, decisions, proposalVersions, risks, signals, tasks, telegramCompletionChecks, telegramPendingResults, telegramUpdates } from "../../db/schema";
import { getDb } from "../../api/queries/connection";

const base = 978100001;
const chatIds = ["-100900", "-100902", "-100903"];
const ids = {
  signal: `S-TG-${base}`,
  migratedSignal: `S-TG-${base + 33}`,
  channel: "CH-TG--100900",
  failedSignal: `S-TG-${base + 1}`,
  unknownSignal: `S-TG-${base + 2}`,
  ignoredSignal: `S-TG-${base + 3}`,
  risk: `R-TG-${base}`,
  decision: "R-01",
  failedDecision: `D-TG-${base + 1}`,
  task: "P-01",
};
const entityIds = [ids.signal, ids.migratedSignal, ids.failedSignal, ids.unknownSignal, ids.ignoredSignal, ids.risk, ids.decision, ids.failedDecision, ids.task, ids.channel];
const updateIds = [base, base + 1, base + 2, base + 3, base + 10, base + 11, base + 20, base + 21, base + 22, base + 23, base + 24, base + 25, base + 26, base + 27, base + 28, base + 30, base + 31, base + 32, base + 33];
const db = getDb();
const mode = process.argv[2] || "read";

if (mode === "cleanup") {
  await db.delete(channelExternalIds).where(inArray(channelExternalIds.externalId, chatIds));
  await db.delete(channels).where(inArray(channels.id, [ids.channel, "CH-TG--100902"]));
  await db.delete(telegramCompletionChecks).where(inArray(telegramCompletionChecks.taskId, [ids.task]));
  await db.delete(telegramPendingResults).where(inArray(telegramPendingResults.taskId, [ids.task]));
  await db.delete(auditEvents).where(inArray(auditEvents.entityId, entityIds));
  await db.delete(tasks).where(inArray(tasks.id, [ids.task]));
  await db.delete(proposalVersions).where(inArray(proposalVersions.proposalId, [ids.decision, ids.failedDecision]));
  await db.delete(decisions).where(inArray(decisions.id, [ids.decision, ids.failedDecision]));
  await db.delete(risks).where(inArray(risks.id, [ids.risk]));
  await db.delete(signals).where(inArray(signals.id, [ids.signal, ids.migratedSignal, ids.failedSignal, ids.unknownSignal, ids.ignoredSignal]));
  await db.delete(telegramUpdates).where(inArray(telegramUpdates.updateId, updateIds));
}

if (mode === "set-due") {
  await db.update(tasks).set({ due: "07.11.2026" }).where(eq(tasks.id, ids.task));
}

const [signalRows, channelIdRows, riskRows, decisionRows, versionRows, taskRows, pendingRows, completionRows, updateRows, eventRows] = await Promise.all([
  db.select().from(signals).where(inArray(signals.id, [ids.signal, ids.migratedSignal, ids.failedSignal, ids.unknownSignal, ids.ignoredSignal])),
  db.select().from(channelExternalIds).where(inArray(channelExternalIds.externalId, chatIds)),
  db.select().from(risks).where(inArray(risks.id, [ids.risk])),
  db.select().from(decisions).where(inArray(decisions.id, [ids.decision, ids.failedDecision])),
  db.select().from(proposalVersions).where(inArray(proposalVersions.proposalId, [ids.decision, ids.failedDecision])),
  db.select().from(tasks).where(inArray(tasks.id, [ids.task])),
  db.select().from(telegramPendingResults).where(inArray(telegramPendingResults.taskId, [ids.task])),
  db.select().from(telegramCompletionChecks).where(inArray(telegramCompletionChecks.taskId, [ids.task])),
  db.select().from(telegramUpdates).where(inArray(telegramUpdates.updateId, updateIds)),
  db.select().from(auditEvents).where(inArray(auditEvents.entityId, entityIds)),
]);
console.log(JSON.stringify({ mode, ids, signals: signalRows, channelExternalIds: channelIdRows, risks: riskRows, decisions: decisionRows, proposalVersions: versionRows, tasks: taskRows, pendingResults: pendingRows, completionChecks: completionRows, updates: updateRows, events: eventRows }, null, 2));
process.exit(0);
