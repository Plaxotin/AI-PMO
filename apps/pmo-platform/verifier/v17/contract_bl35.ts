import { writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { decisions, risks, signals, tasks, type User } from "../../db/schema";
import { getDb } from "../../api/queries/connection";
import { getProjectState } from "../../api/queries/pmo";

const db = getDb();
const ids = {
  signal: "S-TG-978100001",
  risk: "R-TG-978100001",
  decision: "R-01",
  task: "P-01",
};

const [signal] = await db.select().from(signals).where(and(eq(signals.projectId, "PRJ-01"), eq(signals.id, ids.signal))).limit(1);
const [risk] = await db.select().from(risks).where(and(eq(risks.projectId, "PRJ-01"), eq(risks.id, ids.risk))).limit(1);
const [decision] = await db.select().from(decisions).where(and(eq(decisions.projectId, "PRJ-01"), eq(decisions.id, ids.decision))).limit(1);
const [task] = await db.select().from(tasks).where(and(eq(tasks.projectId, "PRJ-01"), eq(tasks.id, ids.task))).limit(1);
if (!signal || !risk || !decision || !task) throw new Error("BL-35 fixture chain is missing");

const before = {
  signals: (await db.select({ id: signals.id }).from(signals)).length,
  risks: (await db.select({ id: risks.id }).from(risks)).length,
  decisions: (await db.select({ id: decisions.id }).from(decisions)).length,
  tasks: (await db.select({ id: tasks.id }).from(tasks)).length,
};

const actor = {
  id: 1,
  unionId: "bl35-contract",
  name: "РП",
  email: null,
  avatar: null,
  role: "admin",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignInAt: new Date(),
} satisfies User;

const state = await getProjectState(actor);
const repeatedState = await getProjectState(actor);
const after = {
  signals: (await db.select({ id: signals.id }).from(signals)).length,
  risks: (await db.select({ id: risks.id }).from(risks)).length,
  decisions: (await db.select({ id: decisions.id }).from(decisions)).length,
  tasks: (await db.select({ id: tasks.id }).from(tasks)).length,
};

const stateSignal = state.signals.find((item) => item.id === ids.signal);
const stateRisk = state.risks.find((item) => item.id === ids.risk);
const stateDecision = state.decisions.find((item) => item.id === ids.decision);
const stateTask = state.tasks.find((item) => item.id === ids.task);
const sameSource = stateRisk?.sourceLink?.url
  && stateRisk.sourceLink.url === stateDecision?.sourceLink?.url
  && stateRisk.sourceLink.url === stateTask?.sourceLink?.url
  && stateRisk.sourceLink.url === stateSignal?.sourceLink?.url;

const checks = {
  read_has_no_demo_seed_side_effect: JSON.stringify(before) === JSON.stringify(after),
  repeated_read_is_stable: JSON.stringify(state) === JSON.stringify(repeatedState),
  signal_exposed_with_author_and_primary_source: stateSignal?.authorName === signal.authorName
    && stateSignal.content === signal.content
    && stateSignal.sourceLink.url === `https://t.me/c/${signal.chatId.replace(/^-100/, "")}/${signal.messageId}`,
  risk_has_confidence_and_signal: stateRisk?.confidence === risk.confidence
    && stateRisk.confidence != null
    && stateRisk.signalId === ids.signal,
  decision_has_version_risk_and_signal: stateDecision?.risk === ids.risk
    && stateDecision.signalId === ids.signal
    && stateDecision.proposalVersion === decision.proposalVersion,
  task_has_result_decision_and_signal: stateTask?.decisionId === ids.decision
    && stateTask.riskId === ids.risk
    && stateTask.signalId === ids.signal
    && stateTask.result === task.result
    && stateTask.completedByName === task.completedByName,
  complete_chain_uses_one_primary_source: Boolean(sameSource),
  proposal_versions_and_audit_are_returned: state.proposalVersions.some((item) => item.proposalId === ids.decision)
    && state.events.some((item) => item.entityId === ids.task && item.eventType === "result.recorded")
    && state.events.some((item) => item.entityId === ids.decision && item.eventType === "decision.accepted"),
};

const evidence = {
  mode: "BL-35 read-only audit chain on isolated MySQL after the real-format contract fixture; no production connection and no Telegram sends",
  checks,
  allChecksPassed: Object.values(checks).every(Boolean),
  countsBeforeAndAfterReads: { before, after },
  chain: {
    signal: ids.signal,
    risk: ids.risk,
    decision: ids.decision,
    task: ids.task,
    sourceAvailable: stateSignal?.sourceLink.status === "available",
    sourceUrl: stateSignal?.sourceLink.url,
    confidence: stateRisk?.confidence,
    proposalVersion: stateDecision?.proposalVersion,
    resultPresent: Boolean(stateTask?.result),
  },
};
writeFileSync(new URL("./bl35-chain-evidence.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.allChecksPassed) throw new Error("BL-35 contract failed");
process.exit(0);
