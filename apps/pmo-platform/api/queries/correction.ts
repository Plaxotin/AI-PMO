import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { auditEvents, decisions, proposalVersions, signals } from "@db/schema";
import { getDb } from "./connection";
import { buildProposalDiff, telegramSourceLink, type ProposalSnapshot } from "./proposal-audit";

export async function correctPendingProposal(
  input: { decisionId: string; title: string },
  actor: { userId: number; name: string },
) {
  const title = input.title.trim();
  if (!title) throw new TRPCError({ code: "BAD_REQUEST", message: "Текст предложения не может быть пустым" });

  return getDb().transaction(async (tx) => {
    const [decision] = await tx.select().from(decisions)
      .where(and(eq(decisions.projectId, "PRJ-01"), eq(decisions.id, input.decisionId)))
      .for("update");
    if (!decision) throw new TRPCError({ code: "NOT_FOUND", message: "Предложение не найдено" });
    if (decision.status !== "wait") {
      throw new TRPCError({ code: "CONFLICT", message: "Исправление решённого предложения в этом срезе недоступно" });
    }

    const before: ProposalSnapshot = {
      title: decision.title,
      rationale: decision.rationale,
      effect: decision.effect,
      owner: decision.proposalOwner || actor.name,
      due: decision.proposalDue || "—",
    };
    const after = { ...before, title };
    const change = buildProposalDiff(before, after);
    if (!change.changed) {
      return { decisionId: decision.id, version: decision.proposalVersion, changed: false };
    }

    let [sourceVersion] = await tx.select().from(proposalVersions)
      .where(and(eq(proposalVersions.proposalId, decision.id), eq(proposalVersions.version, decision.proposalVersion)))
      .limit(1);
    if (!sourceVersion) {
      const [inserted] = await tx.insert(proposalVersions).values({
        projectId: decision.projectId,
        proposalId: decision.id,
        version: decision.proposalVersion,
        ...before,
        actorName: "Пиэмка",
        actorRole: "system",
        attribution: "Пиэмка · автоматически",
      }).$returningId();
      [sourceVersion] = await tx.select().from(proposalVersions).where(eq(proposalVersions.id, inserted.id)).limit(1);
    }

    const nextVersion = decision.proposalVersion + 1;
    const attribution = `Пиэмка от имени ${actor.name}`;
    await tx.insert(proposalVersions).values({
      projectId: decision.projectId,
      proposalId: decision.id,
      version: nextVersion,
      ...after,
      sourceVersionId: sourceVersion.id,
      actorUserId: actor.userId,
      actorName: actor.name,
      actorRole: "rp",
      attribution,
      editDistance: change.editDistance,
      diff: change.diff,
    });

    const [signal] = decision.riskId
      ? await tx.select().from(signals).where(eq(signals.riskId, decision.riskId)).limit(1)
      : [];
    await tx.update(decisions).set({
      title,
      proposalVersion: nextVersion,
    }).where(eq(decisions.id, decision.id));
    await tx.insert(auditEvents).values({
      projectId: decision.projectId,
      entityType: "proposal",
      entityId: decision.id,
      eventType: "record.corrected",
      relatedId: decision.riskId,
      actorUserId: actor.userId,
      actorName: actor.name,
      actorRole: "rp",
      attribution,
      channel: "web",
      version: nextVersion,
      sourceLinks: signal ? [telegramSourceLink(signal.chatId, signal.messageId)] : undefined,
      diff: change.diff,
      metadata: {
        sourceVersion: decision.proposalVersion,
        changedFields: change.changedFields,
        editDistance: change.editDistance,
        correctionScope: "pending_proposal_title",
      },
      detail: `РП исправил предложение ${decision.id}: версия ${decision.proposalVersion} → ${nextVersion}`,
    });

    return { decisionId: decision.id, version: nextVersion, changed: true };
  });
}
