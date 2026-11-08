import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  int,
  json,
  index,
  uniqueIndex,
  boolean,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const projects = mysqlTable("projects", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const projectCounters = mysqlTable("project_counters", {
  projectId: varchar("projectId", { length: 64 }).notNull(),
  counterName: varchar("counterName", { length: 32 }).notNull(),
  nextValue: bigint("nextValue", { mode: "number", unsigned: true }).notNull(),
}, (table) => ({
  projectCounterUnique: uniqueIndex("project_counters_project_name_unique").on(table.projectId, table.counterName),
}));

export const projectMemberships = mysqlTable("project_memberships", {
  id: serial("id").primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  role: mysqlEnum("role", ["member", "rp", "pmo", "auditor", "c_level"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  projectUserUnique: uniqueIndex("project_memberships_project_user_unique").on(table.projectId, table.userId),
  projectRoleIdx: index("project_memberships_project_role_idx").on(table.projectId, table.role),
}));

export const channels = mysqlTable("channels", {
  id: varchar("id", { length: 64 }).primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  type: varchar("type", { length: 24 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  projectIdx: index("channels_project_idx").on(table.projectId),
}));

export const channelExternalIds = mysqlTable("channel_external_ids", {
  id: serial("id").primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  channelId: varchar("channelId", { length: 64 }).notNull(),
  externalId: varchar("externalId", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["active", "migrated"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  externalIdx: uniqueIndex("channel_external_ids_external_unique").on(table.externalId),
  channelIdx: index("channel_external_ids_channel_idx").on(table.channelId),
}));

export const risks = mysqlTable("risks", {
  id: varchar("id", { length: 64 }).primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  title: text("title").notNull(),
  recordType: varchar("recordType", { length: 24 }).notNull(),
  channel: varchar("channel", { length: 24 }),
  impact: text("impact").notNull(),
  probability: varchar("probability", { length: 32 }).notNull(),
  confidence: int("confidence", { unsigned: true }),
  measure: text("measure").notNull(),
  source: text("source").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  projectIdx: index("risks_project_idx").on(table.projectId),
}));

export const decisions = mysqlTable("decisions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  riskId: varchar("riskId", { length: 64 }),
  title: text("title").notNull(),
  rationale: text("rationale").notNull(),
  effect: text("effect").notNull(),
  status: mysqlEnum("status", ["wait", "ok", "no"]).default("wait").notNull(),
  proposalVersion: int("proposalVersion", { unsigned: true }).default(1).notNull(),
  displayDate: varchar("displayDate", { length: 16 }).notNull(),
  proposalOwner: varchar("proposalOwner", { length: 255 }),
  proposalDue: varchar("proposalDue", { length: 16 }),
  attribution: varchar("attribution", { length: 255 }),
  decidedByUserId: bigint("decidedByUserId", { mode: "number", unsigned: true }),
  decidedAt: timestamp("decidedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  projectIdx: index("decisions_project_idx").on(table.projectId),
  riskIdx: index("decisions_risk_idx").on(table.riskId),
}));

export const proposalVersions = mysqlTable("proposal_versions", {
  id: serial("id").primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  proposalId: varchar("proposalId", { length: 64 }).notNull(),
  version: int("version", { unsigned: true }).notNull(),
  title: text("title").notNull(),
  rationale: text("rationale").notNull(),
  effect: text("effect").notNull(),
  owner: varchar("owner", { length: 255 }).notNull(),
  due: varchar("due", { length: 16 }).notNull(),
  sourceVersionId: bigint("sourceVersionId", { mode: "number", unsigned: true }),
  actorUserId: bigint("actorUserId", { mode: "number", unsigned: true }),
  actorName: varchar("actorName", { length: 255 }).notNull(),
  actorRole: varchar("actorRole", { length: 24 }).notNull(),
  attribution: varchar("attribution", { length: 255 }).notNull(),
  editDistance: int("editDistance", { unsigned: true }),
  diff: text("diff"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  proposalVersionIdx: uniqueIndex("proposal_versions_proposal_version_unique").on(table.proposalId, table.version),
  projectIdx: index("proposal_versions_project_idx").on(table.projectId),
}));

export const tasks = mysqlTable("tasks", {
  id: varchar("id", { length: 64 }).primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  decisionId: varchar("decisionId", { length: 64 }),
  riskId: varchar("riskId", { length: 64 }),
  title: text("title").notNull(),
  owner: varchar("owner", { length: 255 }).notNull(),
  due: varchar("due", { length: 16 }).notNull(),
  status: varchar("status", { length: 24 }).notNull(),
  source: text("source"),
  result: text("result"),
  completedAt: timestamp("completedAt"),
  completedByName: varchar("completedByName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  projectIdx: index("tasks_project_idx").on(table.projectId),
  decisionIdx: uniqueIndex("tasks_decision_unique").on(table.decisionId),
}));

export const signals = mysqlTable("signals", {
  id: varchar("id", { length: 64 }).primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  channel: varchar("channel", { length: 24 }).notNull(),
  channelId: varchar("channelId", { length: 64 }),
  chatId: varchar("chatId", { length: 64 }).notNull(),
  messageId: bigint("messageId", { mode: "number" }).notNull(),
  authorId: varchar("authorId", { length: 64 }).notNull(),
  authorName: varchar("authorName", { length: 255 }).notNull(),
  content: text("content").notNull(),
  status: mysqlEnum("status", ["processing", "risk_created", "ignored", "error"]).default("processing").notNull(),
  riskId: varchar("riskId", { length: 64 }),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  chatMessageIdx: uniqueIndex("signals_chat_message_unique").on(table.chatId, table.messageId),
  projectIdx: index("signals_project_idx").on(table.projectId),
  channelIdx: index("signals_channel_idx").on(table.channelId),
}));

export const telegramUpdates = mysqlTable("telegram_updates", {
  updateId: bigint("updateId", { mode: "number" }).primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  payload: text("payload").notNull(),
  status: mysqlEnum("status", ["processing", "processed", "ignored", "error"]).default("processing").notNull(),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const telegramPendingResults = mysqlTable("telegram_pending_results", {
  id: serial("id").primaryKey(),
  taskId: varchar("taskId", { length: 64 }).notNull(),
  chatId: varchar("chatId", { length: 64 }).notNull(),
  userId: varchar("userId", { length: 64 }).notNull(),
  promptMessageId: bigint("promptMessageId", { mode: "number" }),
  status: mysqlEnum("status", ["pending", "done", "cancelled"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  userPendingIdx: index("telegram_pending_user_idx").on(table.chatId, table.userId, table.status),
  taskIdx: index("telegram_pending_task_idx").on(table.taskId),
}));

export const telegramPendingEdits = mysqlTable("telegram_pending_edits", {
  id: serial("id").primaryKey(),
  decisionId: varchar("decisionId", { length: 64 }).notNull(),
  chatId: varchar("chatId", { length: 64 }).notNull(),
  userId: varchar("userId", { length: 64 }).notNull(),
  sourceVersion: int("sourceVersion", { unsigned: true }).notNull(),
  instruction: text("instruction"),
  previewTitle: text("previewTitle"),
  previewOwner: varchar("previewOwner", { length: 255 }),
  previewDue: varchar("previewDue", { length: 16 }),
  status: mysqlEnum("status", ["pending", "processing", "preview", "cancelled", "accepted"]).default("pending").notNull(),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  decisionUserUnique: uniqueIndex("telegram_pending_edits_decision_user_unique").on(table.decisionId, table.userId),
  chatStatusIdx: index("telegram_pending_edits_chat_status_idx").on(table.chatId, table.userId, table.status),
}));

export const telegramCompletionChecks = mysqlTable("telegram_completion_checks", {
  id: serial("id").primaryKey(),
  taskId: varchar("taskId", { length: 64 }).notNull(),
  dueVersion: varchar("dueVersion", { length: 16 }).notNull(),
  chatId: varchar("chatId", { length: 64 }).notNull(),
  userId: varchar("userId", { length: 64 }).notNull(),
  promptMessageId: bigint("promptMessageId", { mode: "number" }),
  status: mysqlEnum("status", ["sending", "pending", "done", "not_done", "failed", "unknown"]).default("sending").notNull(),
  effectStatus: mysqlEnum("effectStatus", ["none", "pending", "sending", "sent", "failed", "unknown"]).default("none").notNull(),
  effectMessageId: bigint("effectMessageId", { mode: "number" }),
  error: text("error"),
  respondedAt: timestamp("respondedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  taskDueUserIdx: uniqueIndex("telegram_completion_task_due_user_unique").on(table.taskId, table.dueVersion, table.userId),
  statusIdx: index("telegram_completion_status_idx").on(table.status, table.effectStatus),
}));

export const telegramSlaNotifications = mysqlTable("telegram_sla_notifications", {
  id: serial("id").primaryKey(),
  objectType: mysqlEnum("objectType", ["decision", "task"]).notNull(),
  objectId: varchar("objectId", { length: 64 }).notNull(),
  objectVersion: varchar("objectVersion", { length: 64 }).notNull(),
  step: mysqlEnum("step", ["reminder", "escalation"]).notNull(),
  recipientRole: mysqlEnum("recipientRole", ["rp", "owner", "sponsor"]).notNull(),
  chatId: varchar("chatId", { length: 64 }).notNull().default(""),
  userId: varchar("userId", { length: 64 }).notNull().default(""),
  status: mysqlEnum("status", ["sending", "sent", "failed", "unknown"]).default("sending").notNull(),
  messageId: bigint("messageId", { mode: "number" }),
  error: text("error"),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  objectStepRecipientIdx: uniqueIndex("telegram_sla_object_step_recipient_unique").on(
    table.objectType,
    table.objectId,
    table.objectVersion,
    table.step,
    table.recipientRole,
    table.userId,
  ),
  statusIdx: index("telegram_sla_status_idx").on(table.status, table.createdAt),
}));

export const telegramOnboardings = mysqlTable("telegram_onboardings", {
  id: serial("id").primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  channelId: varchar("channelId", { length: 64 }).notNull(),
  connectedAt: timestamp("connectedAt").notNull(),
  firstDigestDueAt: timestamp("firstDigestDueAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  projectUnique: uniqueIndex("telegram_onboardings_project_unique").on(table.projectId),
  firstDigestIdx: index("telegram_onboardings_first_digest_idx").on(table.firstDigestDueAt),
}));

export const telegramDigestDeliveries = mysqlTable("telegram_digest_deliveries", {
  id: serial("id").primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  kind: mysqlEnum("kind", ["welcome", "first", "daily", "founder"]).notNull(),
  periodKey: varchar("periodKey", { length: 32 }).notNull(),
  recipientRole: mysqlEnum("recipientRole", ["rp", "founder"]).notNull(),
  chatId: varchar("chatId", { length: 64 }).notNull().default(""),
  userId: varchar("userId", { length: 64 }).notNull().default(""),
  status: mysqlEnum("status", ["sending", "sent", "failed", "unknown"]).default("sending").notNull(),
  coverageStart: timestamp("coverageStart"),
  coverageEnd: timestamp("coverageEnd"),
  messageId: bigint("messageId", { mode: "number" }),
  error: text("error"),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  digestRecipientUnique: uniqueIndex("telegram_digest_recipient_unique").on(
    table.projectId,
    table.kind,
    table.periodKey,
    table.recipientRole,
    table.userId,
  ),
  statusIdx: index("telegram_digest_status_idx").on(table.status, table.createdAt),
}));

export const outcomeSources = mysqlTable("outcome_sources", {
  id: varchar("id", { length: 64 }).primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  type: varchar("type", { length: 32 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  connectionRef: varchar("connectionRef", { length: 128 }).notNull(),
  readOnly: boolean("readOnly").default(true).notNull(),
  config: json("config").$type<Record<string, unknown>>().notNull(),
  status: mysqlEnum("status", ["active", "paused", "error", "disabled"]).default("active").notNull(),
  lastAttemptAt: timestamp("lastAttemptAt"),
  lastSuccessAt: timestamp("lastSuccessAt"),
  lastErrorCode: varchar("lastErrorCode", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  projectIdx: index("outcome_sources_project_idx").on(table.projectId),
}));

export const outcomeMetricBindings = mysqlTable("outcome_metric_bindings", {
  id: serial("id").primaryKey(),
  key: varchar("bindingKey", { length: 64 }).notNull(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  sourceId: varchar("sourceId", { length: 64 }).notNull(),
  decisionId: varchar("decisionId", { length: 64 }).notNull(),
  taskId: varchar("taskId", { length: 64 }).notNull(),
  metric: varchar("metric", { length: 64 }).notNull(),
  unit: varchar("unit", { length: 24 }).notNull(),
  direction: mysqlEnum("direction", ["decrease_is_better", "increase_is_better"]).notNull(),
  currencyCode: varchar("currencyCode", { length: 3 }),
  externalKey: varchar("externalKey", { length: 255 }).notNull(),
  selectorConfig: json("selectorConfig").$type<Record<string, unknown>>().notNull(),
  isPrimary: boolean("isPrimary").default(true).notNull(),
  status: mysqlEnum("status", ["draft", "active", "paused", "superseded"]).default("draft").notNull(),
  version: int("version", { unsigned: true }).default(1).notNull(),
  approvedByUserId: bigint("approvedByUserId", { mode: "number", unsigned: true }),
  approvedByName: varchar("approvedByName", { length: 255 }),
  approvedAt: timestamp("approvedAt"),
  collectingAt: timestamp("collectingAt"),
  lastAttemptAt: timestamp("lastAttemptAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  keyVersionUnique: uniqueIndex("outcome_bindings_key_version_unique").on(table.key, table.version),
  taskIdx: index("outcome_bindings_task_idx").on(table.taskId),
  sourceIdx: index("outcome_bindings_source_idx").on(table.sourceId),
  projectIdx: index("outcome_bindings_project_idx").on(table.projectId),
}));

export const outcomeObservations = mysqlTable("outcome_observations", {
  id: serial("id").primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  sourceId: varchar("sourceId", { length: 64 }).notNull(),
  bindingId: bigint("bindingId", { mode: "number", unsigned: true }).notNull(),
  externalObservationId: varchar("externalObservationId", { length: 255 }).notNull(),
  payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
  role: mysqlEnum("role", ["baseline", "target", "actual"]).notNull(),
  value: varchar("value", { length: 32 }),
  unit: varchar("unit", { length: 24 }).notNull(),
  currencyCode: varchar("currencyCode", { length: 3 }),
  observedAt: timestamp("observedAt"),
  collectedAt: timestamp("collectedAt").defaultNow().notNull(),
  dataClass: mysqlEnum("dataClass", ["real", "synthetic", "unknown"]).default("unknown").notNull(),
  validationStatus: mysqlEnum("validationStatus", ["validated", "rejected"]).default("rejected").notNull(),
  validationErrors: json("validationErrors").$type<string[]>().notNull(),
  sourceRecordUrl: text("sourceRecordUrl"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  observationUnique: uniqueIndex("outcome_observations_source_external_role_hash_unique").on(table.sourceId, table.externalObservationId, table.role, table.payloadHash),
  bindingIdx: index("outcome_observations_binding_idx").on(table.bindingId),
  projectIdx: index("outcome_observations_project_idx").on(table.projectId),
}));

export const outcomeMeasurements = mysqlTable("outcome_measurements", {
  id: serial("id").primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  taskId: varchar("taskId", { length: 64 }).notNull(),
  decisionId: varchar("decisionId", { length: 64 }).notNull(),
  metric: varchar("metric", { length: 64 }).notNull(),
  unit: varchar("unit", { length: 24 }).notNull(),
  baselineValue: varchar("baselineValue", { length: 32 }),
  targetValue: varchar("targetValue", { length: 32 }),
  actualValue: varchar("actualValue", { length: 32 }),
  source: text("source").notNull(),
  sourceId: varchar("sourceId", { length: 255 }).notNull(),
  sourceUrl: text("sourceUrl"),
  status: mysqlEnum("status", ["draft", "confirmed", "superseded"]).default("confirmed").notNull(),
  version: int("version", { unsigned: true }).default(1).notNull(),
  previousVersionId: bigint("previousVersionId", { mode: "number", unsigned: true }),
  recordedByUserId: bigint("recordedByUserId", { mode: "number", unsigned: true }).notNull(),
  recordedByName: varchar("recordedByName", { length: 255 }).notNull(),
  recordedByRole: varchar("recordedByRole", { length: 24 }).notNull(),
  origin: mysqlEnum("origin", ["manual", "automatic", "legacy"]).default("legacy").notNull(),
  bindingId: bigint("bindingId", { mode: "number", unsigned: true }),
  baselineObservationId: bigint("baselineObservationId", { mode: "number", unsigned: true }),
  targetObservationId: bigint("targetObservationId", { mode: "number", unsigned: true }),
  actualObservationId: bigint("actualObservationId", { mode: "number", unsigned: true }),
  baselineObservedAt: timestamp("baselineObservedAt"),
  actualObservedAt: timestamp("actualObservedAt"),
  direction: mysqlEnum("direction", ["decrease_is_better", "increase_is_better"]),
  currencyCode: varchar("currencyCode", { length: 3 }),
  dataClass: mysqlEnum("dataClass", ["real", "synthetic", "unknown"]).default("unknown").notNull(),
  comparabilityStatus: mysqlEnum("comparabilityStatus", ["comparable", "incomparable", "unknown"]).default("unknown").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  taskMetricVersionUnique: uniqueIndex("outcome_measurements_task_metric_version_unique").on(table.taskId, table.metric, table.version),
  decisionIdx: index("outcome_measurements_decision_idx").on(table.decisionId),
  projectIdx: index("outcome_measurements_project_idx").on(table.projectId),
  bindingIdx: index("outcome_measurements_binding_idx").on(table.bindingId),
}));

export const learningContextUsages = mysqlTable("learning_context_usages", {
  id: serial("id").primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  proposalId: varchar("proposalId", { length: 64 }).notNull(),
  proposalVersion: int("proposalVersion", { unsigned: true }).notNull(),
  contextHash: varchar("contextHash", { length: 64 }).notNull(),
  modelId: varchar("modelId", { length: 255 }).notNull(),
  measurementRefs: json("measurementRefs").$type<{ measurementId: number; measurementVersion: number }[]>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  proposalContextUnique: uniqueIndex("learning_usage_proposal_version_hash_unique").on(table.proposalId, table.proposalVersion, table.contextHash),
  projectIdx: index("learning_context_usages_project_idx").on(table.projectId),
}));

export const auditEvents = mysqlTable("audit_events", {
  id: serial("id").primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  entityType: varchar("entityType", { length: 32 }).notNull(),
  entityId: varchar("entityId", { length: 64 }).notNull(),
  eventType: varchar("eventType", { length: 48 }).notNull(),
  relatedId: varchar("relatedId", { length: 64 }),
  actorUserId: bigint("actorUserId", { mode: "number", unsigned: true }),
  actorName: varchar("actorName", { length: 255 }).notNull(),
  actorRole: varchar("actorRole", { length: 24 }).notNull(),
  attribution: varchar("attribution", { length: 255 }).notNull(),
  channel: varchar("channel", { length: 24 }),
  version: int("version", { unsigned: true }),
  sourceLinks: json("sourceLinks").$type<AuditSourceLink[]>(),
  diff: text("diff"),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  detail: text("detail").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  projectCreatedIdx: index("audit_project_created_idx").on(table.projectId, table.createdAt),
  entityIdx: index("audit_entity_idx").on(table.entityType, table.entityId),
}));

export type AuditSourceLink = {
  type: "telegram_message";
  sourceId: string;
  status: "available" | "unavailable";
  url: string | null;
};

export type Project = typeof projects.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type ChannelExternalId = typeof channelExternalIds.$inferSelect;
export type Risk = typeof risks.$inferSelect;
export type Decision = typeof decisions.$inferSelect;
export type ProposalVersion = typeof proposalVersions.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Signal = typeof signals.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
