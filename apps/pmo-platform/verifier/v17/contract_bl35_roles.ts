import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { TrpcContext } from "../../api/context";
import { pmoRouter } from "../../api/pmo-router";
import { telegramRouter } from "../../api/telegram-router";
import { decisions, projectMemberships, risks, tasks, users, type User } from "../../db/schema";
import { getDb } from "../../api/queries/connection";
import type { ProjectRole } from "../../api/queries/project-access";

const db = getDb();
const decisionId = "D-TG-978100100";
const conflictDecisionId = "D-TG-978100099";
const overviewDecisionId = "D-TG-978100101";
const overviewTaskId = "P-D-TG-978100101";
const missingRiskId = "R-BL35-MISSING";
const unsourcedRiskId = "R-BL35-NO-SOURCE";

await db.insert(risks).values({
  id: unsourcedRiskId,
  projectId: "PRJ-01",
  title: "Synthetic auto risk without source",
  recordType: "auto",
  channel: "telegram",
  impact: "Synthetic impact",
  probability: "средняя",
  confidence: 50,
  measure: "Synthetic measure",
  source: "Synthetic BL-35 role fixture",
});
await db.insert(decisions).values([
  {
    id: decisionId,
    projectId: "PRJ-01",
    riskId: unsourcedRiskId,
    title: "Synthetic pending proposal for role checks",
    rationale: "Synthetic rationale",
    effect: "Synthetic effect",
    status: "wait",
    proposalVersion: 1,
    displayDate: "07.11",
  },
  {
    id: conflictDecisionId,
    projectId: "PRJ-01",
    riskId: missingRiskId,
    title: "Synthetic broken chain",
    rationale: "Synthetic rationale",
    effect: "Synthetic effect",
    status: "wait",
    proposalVersion: 1,
    displayDate: "07.11",
  },
  {
    id: overviewDecisionId,
    projectId: "PRJ-01",
    riskId: unsourcedRiskId,
    title: "Synthetic accepted decision for independent overview chain",
    rationale: "Synthetic rationale",
    effect: "Synthetic effect",
    status: "ok",
    proposalVersion: 1,
    displayDate: "07.11",
  },
]);
await db.insert(tasks).values({
  id: overviewTaskId,
  projectId: "PRJ-01",
  decisionId: overviewDecisionId,
  riskId: unsourcedRiskId,
  title: "Synthetic completed task for independent overview chain",
  owner: "Synthetic owner",
  due: "08.11",
  status: "done",
  source: "Synthetic BL-35 overview fixture",
  result: "Synthetic recorded result",
  completedByName: "Synthetic RP",
  completedAt: new Date(),
});

const fixtures = [
  { key: "rp", platformRole: "user", projectRole: "rp" },
  { key: "pmo", platformRole: "admin", projectRole: "pmo" },
  { key: "auditor", platformRole: "user", projectRole: "auditor" },
  { key: "cLevel", platformRole: "admin", projectRole: "c_level" },
  { key: "member", platformRole: "user", projectRole: "member" },
] as const;

const actors = {} as Record<(typeof fixtures)[number]["key"], User>;
for (const fixture of fixtures) {
  const unionId = `bl35-role-${fixture.key}`;
  await db.insert(users).values({
    unionId,
    name: `Synthetic ${fixture.key}`,
    role: fixture.platformRole,
  });
  const [actor] = await db.select().from(users).where(eq(users.unionId, unionId)).limit(1);
  actors[fixture.key] = actor;
  await db.insert(projectMemberships).values({
    projectId: "PRJ-01",
    userId: actor.id,
    role: fixture.projectRole,
  });
}

const caller = (actor: User) => pmoRouter.createCaller({ user: actor } as TrpcContext);
async function expectCode(call: () => Promise<unknown>, code: string) {
  try {
    await call();
    return false;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
  }
}

const anonymous = pmoRouter.createCaller({} as TrpcContext);
const anonymousStateDenied = await expectCode(() => anonymous.state(), "UNAUTHORIZED");
const anonymousCorrectDenied = await expectCode(
  () => anonymous.correct({ projectId: "PRJ-01", decisionId, title: "Anonymous correction" }),
  "UNAUTHORIZED",
);

type ProjectState = Awaited<ReturnType<ReturnType<typeof caller>["state"]>>;
const states = {} as Record<(typeof fixtures)[number]["key"], ProjectState>;
for (const fixture of fixtures) states[fixture.key] = await caller(actors[fixture.key]).state();

const [before] = await db.select().from(decisions).where(eq(decisions.id, decisionId)).limit(1);
const readOnlyKeys = ["pmo", "auditor", "cLevel", "member"] as const;
const correctDenied = {} as Record<(typeof readOnlyKeys)[number], boolean>;
const decideDenied = {} as Record<(typeof readOnlyKeys)[number], boolean>;
for (const key of readOnlyKeys) {
  correctDenied[key] = await expectCode(
    () => caller(actors[key]).correct({ projectId: "PRJ-01", decisionId, title: `Forbidden ${key}` }),
    "FORBIDDEN",
  );
  decideDenied[key] = await expectCode(
    () => caller(actors[key]).decide({ projectId: "PRJ-01", decisionId, action: "ok" }),
    "FORBIDDEN",
  );
}
const [afterDenied] = await db.select().from(decisions).where(eq(decisions.id, decisionId)).limit(1);
const rpState = await caller(actors.rp).correct({
  projectId: "PRJ-01",
  decisionId,
  title: "Исправление от проектной роли РП",
});
const [afterRp] = await db.select().from(decisions).where(eq(decisions.id, decisionId)).limit(1);
const rpTasks = await db.select().from(tasks).where(eq(tasks.decisionId, decisionId));
const telegramCaller = (actor: User) => telegramRouter.createCaller({ user: actor } as TrpcContext);
const rpTelegramStatus = await telegramCaller(actors.rp).status();
const cLevelTelegramStatusDenied = await expectCode(() => telegramCaller(actors.cLevel).status(), "FORBIDDEN");
const anonymousTelegramStatusDenied = await expectCode(
  () => telegramRouter.createCaller({} as TrpcContext).status(),
  "UNAUTHORIZED",
);

const expectedRoles: Record<(typeof fixtures)[number]["key"], ProjectRole> = {
  rp: "rp",
  pmo: "pmo",
  auditor: "auditor",
  cLevel: "c_level",
  member: "member",
};
const overview = rpState.overview;
const checks = {
  project_roles_exposed_with_read_only_flag: fixtures.every((fixture) => {
    const state = states[fixture.key];
    return state.role === expectedRoles[fixture.key]
      && state.readOnly === (expectedRoles[fixture.key] !== "rp");
  }),
  anonymous_requests_unauthorized: anonymousStateDenied && anonymousCorrectDenied,
  read_only_roles_cannot_correct: Object.values(correctDenied).every(Boolean),
  read_only_roles_cannot_decide: Object.values(decideDenied).every(Boolean),
  platform_admin_does_not_override_project_read_only: states.pmo.role === "pmo"
    && states.cLevel.role === "c_level"
    && correctDenied.pmo
    && correctDenied.cLevel
    && decideDenied.pmo
    && decideDenied.cLevel,
  denied_mutations_leave_state_unchanged: afterDenied.proposalVersion === before.proposalVersion
    && afterDenied.title === before.title
    && afterDenied.status === before.status,
  explicit_rp_membership_can_correct_without_platform_admin: actors.rp.role === "user"
    && afterRp.proposalVersion === before.proposalVersion + 1
    && afterRp.status === "wait"
    && rpState.role === "rp"
    && rpState.readOnly === false
    && rpTasks.length === 0,
  project_rp_can_read_telegram_status_without_platform_admin: actors.rp.role === "user"
    && rpTelegramStatus.configured === false
    && rpTelegramStatus.connected === false
    && cLevelTelegramStatusDenied
    && anonymousTelegramStatusDenied,
  overview_has_freshness_sources_and_recent_chain: overview.freshness.latestAt !== null
    && overview.freshness.status === "fresh"
    && overview.sources.available >= 1
    && overview.recentChains.some((item) => item.taskId === overviewTaskId
      && item.decisionId === overviewDecisionId
      && item.riskId === unsourcedRiskId),
  overview_detects_conflicts_and_unsourced_auto_risk: overview.conflicts.some((item) => item.entityId === conflictDecisionId
      && item.type === "missing_risk"
      && item.relatedId === missingRiskId)
    && overview.sources.missing >= 1
    && overview.requiresReview.some((item) => item.entityId === unsourcedRiskId)
    && overview.requiresReview.some((item) => item.entityId === conflictDecisionId),
  overview_exposes_pending_and_delivery_review: overview.requiresReview.some((item) => item.entityId === decisionId)
    && overview.requiresReview.some((item) => item.entityType === "delivery"),
};

const evidence = {
  mode: "BL-35 project roles and audit overview through real tRPC middleware on isolated MySQL; synthetic users and fixtures; no production connection or Telegram sends",
  checks,
  allChecksPassed: Object.values(checks).every(Boolean),
  result: {
    roles: Object.fromEntries(fixtures.map((fixture) => [fixture.key, {
      platformRole: actors[fixture.key].role,
      projectRole: states[fixture.key].role,
      readOnly: states[fixture.key].readOnly,
      correctDenied: fixture.key === "rp" ? null : correctDenied[fixture.key as (typeof readOnlyKeys)[number]],
      decideDenied: fixture.key === "rp" ? null : decideDenied[fixture.key as (typeof readOnlyKeys)[number]],
    }])),
    anonymousStateDenied,
    anonymousCorrectDenied,
    correctedVersion: afterRp.proposalVersion,
    tasksCreatedByCorrection: rpTasks.length,
    overview: {
      freshness: overview.freshness,
      sources: overview.sources,
      recentChains: overview.recentChains.length,
      conflicts: overview.conflicts.length,
      requiresReview: overview.requiresReview.length,
    },
  },
};
writeFileSync(new URL("./bl35-roles-evidence.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.allChecksPassed) throw new Error("BL-35 roles and overview contract failed");
process.exit(0);
