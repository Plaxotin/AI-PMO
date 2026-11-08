import type { AuditEvent, Decision, Risk, Signal, Task } from "@db/schema";
import type { buildProjectChain } from "./project-chain";

export type AuditConflict = {
  type: "missing_risk" | "missing_decision";
  entityType: "signal" | "decision" | "task";
  entityId: string;
  relatedId: string;
};

export type AuditReviewItem = {
  entityType: "risk" | "decision" | "task" | "delivery";
  entityId: string;
  reason: string;
};

type OverviewInput = {
  signals: Signal[];
  risks: Risk[];
  decisions: Decision[];
  tasks: Task[];
  events: AuditEvent[];
};

function latestDate(rows: Array<{ updatedAt?: Date; createdAt: Date }>) {
  const timestamps = rows.flatMap((row) => [row.updatedAt, row.createdAt])
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.getTime());
  return timestamps.length ? new Date(Math.max(...timestamps)) : null;
}

export function buildAuditOverview(
  input: OverviewInput,
  chain: ReturnType<typeof buildProjectChain>,
  now = new Date(),
) {
  const riskIds = new Set(input.risks.map((risk) => risk.id));
  const decisionIds = new Set(input.decisions.map((decision) => decision.id));
  const conflicts: AuditConflict[] = [];
  for (const signal of input.signals) {
    if (signal.riskId && !riskIds.has(signal.riskId)) {
      conflicts.push({ type: "missing_risk", entityType: "signal", entityId: signal.id, relatedId: signal.riskId });
    }
  }
  for (const decision of input.decisions) {
    if (decision.riskId && !riskIds.has(decision.riskId)) {
      conflicts.push({ type: "missing_risk", entityType: "decision", entityId: decision.id, relatedId: decision.riskId });
    }
  }
  for (const task of input.tasks) {
    if (task.decisionId && !decisionIds.has(task.decisionId)) {
      conflicts.push({ type: "missing_decision", entityType: "task", entityId: task.id, relatedId: task.decisionId });
    }
    if (task.riskId && !riskIds.has(task.riskId)) {
      conflicts.push({ type: "missing_risk", entityType: "task", entityId: task.id, relatedId: task.riskId });
    }
  }

  const review = new Map<string, AuditReviewItem>();
  const addReview = (item: AuditReviewItem) => review.set(`${item.entityType}:${item.entityId}:${item.reason}`, item);
  for (const decision of input.decisions) {
    if (decision.status === "wait") {
      addReview({ entityType: "decision", entityId: decision.id, reason: "Ожидает решения РП" });
    }
  }

  const sources = { available: 0, unavailable: 0, missing: 0 };
  for (const risk of input.risks.filter((item) => item.recordType === "auto")) {
    const source = chain.riskSources.get(risk.id);
    if (!source) {
      sources.missing += 1;
      addReview({ entityType: "risk", entityId: risk.id, reason: "Нет первичного сигнала" });
    } else if (source.sourceLink.status === "available") {
      sources.available += 1;
    } else {
      sources.unavailable += 1;
      addReview({ entityType: "risk", entityId: risk.id, reason: "Источник недоступен; идентификатор сохранён" });
    }
  }
  for (const event of input.events.filter((item) => item.eventType === "delivery.failed")) {
    addReview({ entityType: "delivery", entityId: event.entityId, reason: "Ошибка или неизвестный результат доставки" });
  }
  for (const conflict of conflicts) {
    addReview({
      entityType: conflict.entityType === "signal" ? "risk" : conflict.entityType,
      entityId: conflict.entityId,
      reason: `Конфликт связи: отсутствует ${conflict.relatedId}`,
    });
  }

  const latestAt = latestDate([
    ...input.signals,
    ...input.risks,
    ...input.decisions,
    ...input.tasks,
    ...input.events,
  ]);
  const ageHours = latestAt ? (now.getTime() - latestAt.getTime()) / 3_600_000 : null;

  return {
    freshness: {
      latestAt,
      status: !latestAt ? "empty" as const : ageHours! <= 24 ? "fresh" as const : "stale" as const,
    },
    sources,
    recentChains: input.tasks.slice(0, 5).map((task) => ({
      taskId: task.id,
      decisionId: task.decisionId,
      riskId: task.riskId || input.decisions.find((decision) => decision.id === task.decisionId)?.riskId || null,
      signalId: chain.taskSources.get(task.id)?.signalId || null,
      sourceLink: chain.taskSources.get(task.id)?.sourceLink || null,
      updatedAt: task.updatedAt,
    })),
    conflicts,
    requiresReview: [...review.values()],
  };
}
