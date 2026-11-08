import type { AuditSourceLink, Decision, Risk, Signal, Task } from "@db/schema";
import { telegramSourceLink } from "./proposal-audit";

export type ChainSource = {
  signalId: string;
  sourceLink: AuditSourceLink;
};

export type ProjectSignalView = {
  id: string;
  riskId?: string;
  authorName: string;
  content: string;
  createdAt: Date;
  sourceLink: AuditSourceLink;
};

function byNewest(a: Signal, b: Signal) {
  const time = b.createdAt.getTime() - a.createdAt.getTime();
  return time || b.id.localeCompare(a.id);
}

export function buildProjectChain(
  signalRows: Signal[],
  riskRows: Risk[],
  decisionRows: Decision[],
  taskRows: Task[],
) {
  const orderedSignals = [...signalRows].sort(byNewest);
  const sourceBySignal = new Map<string, ChainSource>();
  const latestByRisk = new Map<string, ChainSource>();

  for (const signal of orderedSignals) {
    const source = {
      signalId: signal.id,
      sourceLink: telegramSourceLink(signal.chatId, signal.messageId),
    };
    sourceBySignal.set(signal.id, source);
    if (signal.riskId && !latestByRisk.has(signal.riskId)) {
      latestByRisk.set(signal.riskId, source);
    }
  }

  const riskSources = new Map<string, ChainSource>();
  for (const risk of riskRows) {
    const source = latestByRisk.get(risk.id);
    if (source) riskSources.set(risk.id, source);
  }

  const decisionSources = new Map<string, ChainSource>();
  const decisionRisk = new Map(decisionRows.map((decision) => [decision.id, decision.riskId]));
  for (const decision of decisionRows) {
    const source = decision.riskId ? riskSources.get(decision.riskId) : undefined;
    if (source) decisionSources.set(decision.id, source);
  }

  const taskSources = new Map<string, ChainSource>();
  for (const task of taskRows) {
    const riskId = task.riskId || (task.decisionId ? decisionRisk.get(task.decisionId) : null);
    const source = riskId ? riskSources.get(riskId) : undefined;
    if (source) taskSources.set(task.id, source);
  }

  const signals: ProjectSignalView[] = orderedSignals.map((signal) => ({
    id: signal.id,
    riskId: signal.riskId || undefined,
    authorName: signal.authorName,
    content: signal.content,
    createdAt: signal.createdAt,
    sourceLink: sourceBySignal.get(signal.id)!.sourceLink,
  }));

  return { signals, riskSources, decisionSources, taskSources };
}
