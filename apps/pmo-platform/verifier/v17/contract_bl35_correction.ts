import { writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import type { TrpcContext } from "../../api/context";
import { pmoRouter } from "../../api/pmo-router";
import { auditEvents, decisions, proposalVersions, risks, tasks, type User } from "../../db/schema";
import { getDb } from "../../api/queries/connection";

const db = getDb();
const decisionId = "D-TG-978100035";
const riskId = "R-BL35-CORRECT";
const originalTitle = "Исходное предложение BL-35";
const correctedTitle = "Исправленное предложение BL-35";

await db.insert(risks).values({
  id: riskId,
  projectId: "PRJ-01",
  title: "Synthetic correction risk",
  recordType: "auto",
  channel: "telegram",
  impact: "Synthetic impact",
  probability: "средняя",
  confidence: 80,
  measure: "Synthetic measure",
  source: "Synthetic BL-35 fixture",
});
await db.insert(decisions).values({
  id: decisionId,
  projectId: "PRJ-01",
  riskId,
  title: originalTitle,
  rationale: "Synthetic rationale",
  effect: "Synthetic effect",
  status: "wait",
  proposalVersion: 1,
  displayDate: "07.11",
  proposalOwner: "Владелец теста",
  proposalDue: "10.11.2026",
});
await db.insert(proposalVersions).values({
  projectId: "PRJ-01",
  proposalId: decisionId,
  version: 1,
  title: originalTitle,
  rationale: "Synthetic rationale",
  effect: "Synthetic effect",
  owner: "Владелец теста",
  due: "10.11.2026",
  actorName: "Пиэмка",
  actorRole: "system",
  attribution: "Пиэмка · автоматически",
});

const user = (id: number, role: "user" | "admin"): User => ({
  id,
  unionId: `bl35-${role}`,
  name: role === "admin" ? "РП" : "Участник",
  email: null,
  avatar: null,
  role,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignInAt: new Date(),
});
const memberCaller = pmoRouter.createCaller({ user: user(201, "user") } as TrpcContext);
const rpCaller = pmoRouter.createCaller({ user: user(101, "admin") } as TrpcContext);
const input = { projectId: "PRJ-01" as const, decisionId, title: correctedTitle };

async function expectCode(call: () => Promise<unknown>, code: string) {
  try {
    await call();
    return false;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
  }
}

const memberDenied = await expectCode(() => memberCaller.correct(input), "FORBIDDEN");
const memberDidNotChange = (await db.select().from(decisions).where(eq(decisions.id, decisionId)).limit(1))[0]?.proposalVersion === 1;
const correctedState = await rpCaller.correct(input);
await rpCaller.correct(input);
const decidedDenied = await expectCode(
  () => rpCaller.correct({ ...input, decisionId: "R-01", title: "Недопустимая правка" }),
  "CONFLICT",
);

const [corrected] = await db.select().from(decisions).where(eq(decisions.id, decisionId)).limit(1);
const versions = await db.select().from(proposalVersions).where(eq(proposalVersions.proposalId, decisionId)).orderBy(proposalVersions.version);
const correctionEvents = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, decisionId), eq(auditEvents.eventType, "record.corrected")));
const fixtureTasks = await db.select().from(tasks).where(eq(tasks.decisionId, decisionId));
const original = versions.find((item) => item.version === 1);
const correction = versions.find((item) => item.version === 2);
const returned = correctedState.decisions.find((item) => item.id === decisionId);

const checks = {
  direct_member_request_forbidden: memberDenied && memberDidNotChange,
  rp_correction_creates_version_two: corrected.status === "wait" && corrected.proposalVersion === 2 && returned?.proposalVersion === 2,
  identical_retry_has_no_duplicate: versions.length === 2 && correctionEvents.length === 1,
  original_origin_and_diff_preserved: original?.actorRole === "system"
    && original.attribution === "Пиэмка · автоматически"
    && correction?.actorRole === "rp"
    && correction.diff?.includes(`- ${originalTitle}`)
    && correction.diff.includes(`+ ${correctedTitle}`),
  audit_records_correction_without_acceptance: correctionEvents[0]?.actorRole === "rp"
    && correctionEvents[0].channel === "web"
    && correctionEvents[0].version === 2
    && corrected.status === "wait",
  no_task_created_by_correction: fixtureTasks.length === 0,
  decided_proposal_conflict: decidedDenied,
};
const evidence = {
  mode: "BL-35 correction through tRPC on isolated MySQL; no production connection and no Telegram sends",
  checks,
  allChecksPassed: Object.values(checks).every(Boolean),
  result: {
    status: corrected.status,
    currentVersion: corrected.proposalVersion,
    storedVersions: versions.length,
    correctionEvents: correctionEvents.length,
    tasks: fixtureTasks.length,
    memberDenied,
    decidedDenied,
    auditEvent: correctionEvents[0] ? {
      actorRole: correctionEvents[0].actorRole,
      channel: correctionEvents[0].channel,
      version: correctionEvents[0].version,
      eventType: correctionEvents[0].eventType,
    } : null,
    auditCriteria: {
      actorRole: correctionEvents[0]?.actorRole === "rp",
      channel: correctionEvents[0]?.channel === "web",
      version: correctionEvents[0]?.version === 2,
      status: corrected.status === "wait",
    },
  },
};
writeFileSync(new URL("./bl35-correction-evidence.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.allChecksPassed) throw new Error("BL-35 correction contract failed");
process.exit(0);
