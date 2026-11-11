import { and, eq, sql } from "drizzle-orm";
import { auditEvents, channelExternalIds, channels, commitmentCandidates, decisions, projectCounters, proposalVersions, risks, signals, tasks, telegramUpdates } from "@db/schema";
import { DEMO_PROJECT_ID } from "./pmo";
import { getDb } from "./connection";
import { telegramSourceLink } from "./proposal-audit";
import { ensureTelegramOnboarding, getTelegramOnboarding } from "./first-value";
import type { RiskAnalysis } from "../ai/risk";

function isDuplicateEntry(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "ER_DUP_ENTRY" || candidate?.cause?.code === "ER_DUP_ENTRY";
}

async function ensureTelegramChatBinding(chatId: string) {
  const db = getDb();
  const channelId = `CH-TG-${chatId}`;
  await db.insert(channels).values({ id: channelId, projectId: DEMO_PROJECT_ID, type: "telegram" })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  await db.insert(channelExternalIds).values({ projectId: DEMO_PROJECT_ID, channelId, externalId: chatId, status: "active" })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });
  const [binding] = await db.select().from(channelExternalIds)
    .where(and(eq(channelExternalIds.projectId, DEMO_PROJECT_ID), eq(channelExternalIds.externalId, chatId)))
    .limit(1);
  if (!binding) throw new Error("Не удалось привязать Telegram-чат к каналу проекта");
  await db.update(signals).set({ channelId: binding.channelId }).where(eq(signals.chatId, chatId));
  const onboarding = await ensureTelegramOnboarding(binding.channelId);
  return { ...binding, onboarding: onboarding.onboarding };
}

export async function resolveTelegramProjectChat(chatId: string, configuredChatIds: Set<string>) {
  const [existing] = await getDb().select().from(channelExternalIds)
    .where(and(eq(channelExternalIds.projectId, DEMO_PROJECT_ID), eq(channelExternalIds.externalId, chatId)))
    .limit(1);
  if (existing) return { ...existing, onboarding: await getTelegramOnboarding() };
  if (!configuredChatIds.has(chatId)) return null;
  return ensureTelegramChatBinding(chatId);
}

export async function migrateTelegramChat(input: { oldChatId: string; newChatId: string; messageChatId: string; messageId: number }) {
  return getDb().transaction(async (tx) => {
    const [oldBinding] = await tx.select().from(channelExternalIds)
      .where(and(eq(channelExternalIds.projectId, DEMO_PROJECT_ID), eq(channelExternalIds.externalId, input.oldChatId)))
      .for("update");
    if (!oldBinding) throw new Error("Исходный Telegram-чат не привязан к проекту");

    const [newBinding] = await tx.select().from(channelExternalIds)
      .where(and(eq(channelExternalIds.projectId, DEMO_PROJECT_ID), eq(channelExternalIds.externalId, input.newChatId)))
      .for("update");
    if (newBinding && newBinding.channelId !== oldBinding.channelId) {
      throw new Error("Новый Telegram-чат уже привязан к другому каналу");
    }
    if (oldBinding.status === "migrated" && newBinding?.status === "active") {
      return { channelId: oldBinding.channelId, alreadyMigrated: true };
    }

    if (!newBinding) {
      await tx.insert(channelExternalIds).values({
        projectId: DEMO_PROJECT_ID,
        channelId: oldBinding.channelId,
        externalId: input.newChatId,
        status: "active",
      });
    } else if (newBinding.status !== "active") {
      await tx.update(channelExternalIds).set({ status: "active" }).where(eq(channelExternalIds.id, newBinding.id));
    }
    await tx.update(channelExternalIds).set({ status: "migrated" }).where(eq(channelExternalIds.id, oldBinding.id));
    await tx.update(signals).set({ channelId: oldBinding.channelId }).where(eq(signals.chatId, input.oldChatId));
    await tx.update(signals).set({ channelId: oldBinding.channelId }).where(eq(signals.chatId, input.newChatId));
    await tx.insert(auditEvents).values({
      projectId: DEMO_PROJECT_ID,
      entityType: "channel",
      entityId: oldBinding.channelId,
      eventType: "channel.migrated",
      relatedId: input.newChatId,
      actorName: "Telegram",
      actorRole: "system",
      attribution: "Telegram · миграция чата",
      channel: "telegram",
      sourceLinks: [telegramSourceLink(input.messageChatId, input.messageId)],
      metadata: { oldChatId: input.oldChatId, newChatId: input.newChatId, channelId: oldBinding.channelId },
      detail: `Telegram-чат ${input.oldChatId} мигрирован в ${input.newChatId}; история сохранена в канале ${oldBinding.channelId}`,
    });
    return { channelId: oldBinding.channelId, alreadyMigrated: false };
  });
}

export async function claimTelegramUpdate(updateId: number, payload: unknown) {
  try {
    await getDb().insert(telegramUpdates).values({ updateId, projectId: DEMO_PROJECT_ID, payload: JSON.stringify(payload) });
    return true;
  } catch (error) {
    if (isDuplicateEntry(error)) return false;
    throw error;
  }
}

export async function finishTelegramUpdate(updateId: number, status: "processed" | "ignored" | "error", error?: string) {
  await getDb().update(telegramUpdates).set({ status, error: error?.slice(0, 4000) }).where(eq(telegramUpdates.updateId, updateId));
}

export async function createTelegramSignal(input: { updateId: number; channelId: string; chatId: string; messageId: number; authorId: string; authorName: string; authorRole: "rp" | "member"; text: string }) {
  const id = `S-TG-${input.updateId}`;
  try {
    await getDb().transaction(async (tx) => {
      await tx.insert(signals).values({
        id,
        projectId: DEMO_PROJECT_ID,
        channel: "telegram",
        channelId: input.channelId,
        chatId: input.chatId,
        messageId: input.messageId,
        authorId: input.authorId,
        authorName: input.authorName,
        content: input.text,
      });
      await tx.insert(auditEvents).values({
        projectId: DEMO_PROJECT_ID,
        entityType: "signal",
        entityId: id,
        eventType: "signal.received",
        relatedId: null,
        actorUserId: Number(input.authorId),
        actorName: input.authorName,
        actorRole: input.authorRole,
        attribution: `Telegram · ${input.authorName}`,
        channel: "telegram",
        sourceLinks: [telegramSourceLink(input.chatId, input.messageId)],
        metadata: { channelId: input.channelId, chatId: input.chatId, messageId: input.messageId },
        detail: input.text.slice(0, 3000),
      });
    });
  } catch (error) {
    if (!isDuplicateEntry(error)) throw error;
    const [existing] = await getDb().select().from(signals).where(and(eq(signals.chatId, input.chatId), eq(signals.messageId, input.messageId)));
    if (existing) return { signal: existing, created: false };
    throw error;
  }
  const [row] = await getDb().select().from(signals).where(eq(signals.id, id));
  return { signal: row, created: true };
}

export async function markTelegramSignal(id: string, status: "ignored" | "error", error?: string) {
  await getDb().update(signals).set({ status, error }).where(eq(signals.id, id));
}

export async function createRiskProposal(signalId: string, updateId: number, analysis: RiskAnalysis) {
  const riskId = `R-TG-${updateId}`;
  let decisionId = "";
  const [signal] = await getDb().select().from(signals).where(eq(signals.id, signalId));
  if (!signal) throw new Error("Сигнал не найден");
  const now = new Date();
  await getDb().transaction(async (tx) => {
    const [existing] = await tx.select().from(decisions).where(eq(decisions.riskId, riskId)).for("update").limit(1);
    if (existing) {
      decisionId = existing.id;
      return;
    }
    await tx.insert(projectCounters).values({ projectId: DEMO_PROJECT_ID, counterName: "decision", nextValue: 1 })
      .onDuplicateKeyUpdate({ set: { nextValue: sql`LAST_INSERT_ID(nextValue) + 1` } });
    const [counter] = await tx.select().from(projectCounters)
      .where(and(eq(projectCounters.projectId, DEMO_PROJECT_ID), eq(projectCounters.counterName, "decision"))).limit(1);
    if (!counter) throw new Error("Не удалось получить следующий номер решения");
    decisionId = `R-${String(counter.nextValue).padStart(2, "0")}`;
    await tx.insert(risks).values({
      id: riskId,
      projectId: DEMO_PROJECT_ID,
      title: analysis.riskTitle,
      recordType: "auto",
      channel: "tg",
      impact: analysis.impact,
      probability: analysis.probability,
      confidence: Math.round(analysis.confidence * 100),
      measure: analysis.measure,
      source: `Telegram · чат ${signal.chatId} · сообщение ${signal.messageId} · ${signal.authorName}`,
    });
    await tx.insert(decisions).values({
      id: decisionId,
      projectId: DEMO_PROJECT_ID,
      riskId,
      title: analysis.proposalTitle,
      rationale: analysis.rationale,
      effect: analysis.effect || "Эффект требует оценки РП",
      status: "wait",
      displayDate: now.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
      proposalOwner: analysis.owner || "Руководитель проекта",
      proposalDue: analysis.due || "—",
    });
    await tx.insert(proposalVersions).values({
      projectId: DEMO_PROJECT_ID,
      proposalId: decisionId,
      version: 1,
      title: analysis.proposalTitle,
      rationale: analysis.rationale,
      effect: analysis.effect || "Эффект требует оценки РП",
      owner: analysis.owner || "Руководитель проекта",
      due: analysis.due || "—",
      actorName: "Пиэмка",
      actorRole: "system",
      attribution: "Пиэмка · автоматически",
    });
    await tx.update(signals).set({ status: "risk_created", riskId }).where(eq(signals.id, signalId));
    const sourceLinks = [telegramSourceLink(signal.chatId, signal.messageId)];
    await tx.insert(auditEvents).values([
      {
        projectId: DEMO_PROJECT_ID,
        entityType: "risk",
        entityId: riskId,
        eventType: "risk.recorded",
        relatedId: signalId,
        actorName: "Пиэмка",
        actorRole: "system",
        attribution: "Пиэмка · автоматически",
        channel: "telegram",
        sourceLinks,
        metadata: { signalId, channelId: signal.channelId, confidence: analysis.confidence },
        detail: analysis.riskTitle,
      },
      {
        projectId: DEMO_PROJECT_ID,
        entityType: "proposal",
        entityId: decisionId,
        eventType: "proposal.created",
        relatedId: riskId,
        actorName: "Пиэмка",
        actorRole: "system",
        attribution: "Пиэмка · автоматически",
        channel: "telegram",
        version: 1,
        sourceLinks,
        metadata: { signalId, channelId: signal.channelId, riskId, confidence: analysis.confidence, proposalVersion: 1 },
        detail: analysis.proposalTitle,
      },
    ]);
  });
  return { riskId, decisionId };
}

export async function getRiskProposal(decisionId: string) {
  const db = getDb();
  const [decision] = await db.select().from(decisions).where(and(eq(decisions.id, decisionId), eq(decisions.projectId, DEMO_PROJECT_ID)));
  if (!decision) return null;
  const [risk] = decision.riskId ? await db.select().from(risks).where(eq(risks.id, decision.riskId)) : [];
  let signal = decision.riskId
    ? (await db.select().from(signals).where(eq(signals.riskId, decision.riskId)).limit(1))[0]
    : undefined;
  if (!signal) {
    const [candidate] = await db.select().from(commitmentCandidates)
      .where(and(eq(commitmentCandidates.projectId, DEMO_PROJECT_ID), eq(commitmentCandidates.decisionId, decisionId))).limit(1);
    if (candidate) signal = (await db.select().from(signals).where(eq(signals.id, candidate.signalId)).limit(1))[0];
  }
  return { decision, risk, signal };
}

export async function getRiskProposalByRiskId(riskId: string) {
  const [decision] = await getDb().select().from(decisions)
    .where(and(eq(decisions.riskId, riskId), eq(decisions.projectId, DEMO_PROJECT_ID))).limit(1);
  if (!decision) return null;
  return getRiskProposal(decision.id);
}

export async function getTaskWithDecision(taskId: string) {
  const db = getDb();
  const [task] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, DEMO_PROJECT_ID)));
  if (!task) return null;
  const [decision] = task.decisionId ? await db.select().from(decisions).where(eq(decisions.id, task.decisionId)) : [];
  return { task, decision };
}
