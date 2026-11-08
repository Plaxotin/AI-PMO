import { and, eq, inArray } from "drizzle-orm";
import { decisions, telegramPendingEdits } from "@db/schema";
import { getDb } from "./connection";
import { DEMO_PROJECT_ID } from "./pmo";

export async function startTelegramProposalEdit(input: { decisionId: string; chatId: string; userId: string }) {
  return getDb().transaction(async (tx) => {
    const [decision] = await tx.select().from(decisions)
      .where(and(eq(decisions.projectId, DEMO_PROJECT_ID), eq(decisions.id, input.decisionId)))
      .for("update");
    if (!decision || decision.status !== "wait") return null;
    await tx.insert(telegramPendingEdits).values({
      decisionId: input.decisionId,
      chatId: input.chatId,
      userId: input.userId,
      sourceVersion: decision.proposalVersion,
      status: "pending",
    }).onDuplicateKeyUpdate({
      set: {
        chatId: input.chatId,
        sourceVersion: decision.proposalVersion,
        instruction: null,
        previewTitle: null,
        previewOwner: null,
        previewDue: null,
        status: "pending",
        error: null,
      },
    });
    const [edit] = await tx.select().from(telegramPendingEdits)
      .where(and(eq(telegramPendingEdits.decisionId, input.decisionId), eq(telegramPendingEdits.userId, input.userId))).limit(1);
    return { edit, decision };
  });
}

export async function getActiveTelegramProposalEdit(input: { decisionId: string; chatId: string; userId: string }) {
  const [edit] = await getDb().select().from(telegramPendingEdits)
    .where(and(
      eq(telegramPendingEdits.decisionId, input.decisionId),
      eq(telegramPendingEdits.chatId, input.chatId),
      eq(telegramPendingEdits.userId, input.userId),
      inArray(telegramPendingEdits.status, ["pending", "processing", "preview"]),
    )).limit(1);
  return edit || null;
}

export async function claimTelegramEditInstruction(input: { chatId: string; userId: string; instruction: string }) {
  return getDb().transaction(async (tx) => {
    const [edit] = await tx.select().from(telegramPendingEdits)
      .where(and(
        eq(telegramPendingEdits.chatId, input.chatId),
        eq(telegramPendingEdits.userId, input.userId),
        eq(telegramPendingEdits.status, "pending"),
      )).for("update").limit(1);
    if (!edit) return null;
    const [decision] = await tx.select().from(decisions)
      .where(and(eq(decisions.projectId, DEMO_PROJECT_ID), eq(decisions.id, edit.decisionId))).for("update");
    if (!decision || decision.status !== "wait" || decision.proposalVersion !== edit.sourceVersion) {
      await tx.update(telegramPendingEdits).set({ status: "cancelled", error: "Исходная версия предложения изменилась" })
        .where(eq(telegramPendingEdits.id, edit.id));
      return null;
    }
    await tx.update(telegramPendingEdits).set({ status: "processing", instruction: input.instruction, error: null })
      .where(eq(telegramPendingEdits.id, edit.id));
    return { edit, decision };
  });
}

export async function saveTelegramProposalPreview(input: {
  editId: number;
  title: string;
  owner: string;
  due: string;
}) {
  await getDb().update(telegramPendingEdits).set({
    previewTitle: input.title,
    previewOwner: input.owner,
    previewDue: input.due,
    status: "preview",
    error: null,
  }).where(and(eq(telegramPendingEdits.id, input.editId), eq(telegramPendingEdits.status, "processing")));
  const [edit] = await getDb().select().from(telegramPendingEdits).where(eq(telegramPendingEdits.id, input.editId)).limit(1);
  return edit?.status === "preview" ? edit : null;
}

export async function failTelegramProposalPreview(editId: number, error: string) {
  await getDb().update(telegramPendingEdits).set({ status: "pending", error: error.slice(0, 4000) })
    .where(and(eq(telegramPendingEdits.id, editId), eq(telegramPendingEdits.status, "processing")));
}

export async function cancelTelegramProposalEdit(input: { decisionId: string; chatId: string; userId: string }) {
  await getDb().update(telegramPendingEdits).set({ status: "cancelled", error: null })
    .where(and(
      eq(telegramPendingEdits.decisionId, input.decisionId),
      eq(telegramPendingEdits.chatId, input.chatId),
      eq(telegramPendingEdits.userId, input.userId),
      inArray(telegramPendingEdits.status, ["pending", "processing", "preview"]),
    ));
  const [edit] = await getDb().select().from(telegramPendingEdits)
    .where(and(eq(telegramPendingEdits.decisionId, input.decisionId), eq(telegramPendingEdits.userId, input.userId))).limit(1);
  return edit?.status === "cancelled" ? edit : null;
}

export async function completeTelegramProposalEdit(input: { decisionId: string; chatId: string; userId: string }) {
  await getDb().update(telegramPendingEdits).set({ status: "accepted", error: null })
    .where(and(
      eq(telegramPendingEdits.decisionId, input.decisionId),
      eq(telegramPendingEdits.chatId, input.chatId),
      eq(telegramPendingEdits.userId, input.userId),
      eq(telegramPendingEdits.status, "preview"),
    ));
}
