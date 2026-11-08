import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auditEvents, decisions, learningContextUsages, outcomeMeasurements, tasks } from "@db/schema";
import { getDb } from "./connection";
import { DEMO_PROJECT_ID } from "./pmo";
import { assessmentForMeasurement } from "./outcome";

const LEARNING_CONTEXT_LIMIT = 5;

export async function buildLearningContext(metric?: string, projectId = DEMO_PROJECT_ID) {
  const db = getDb();
  const rows = await db.select().from(outcomeMeasurements).where(and(
    eq(outcomeMeasurements.projectId, projectId),
    eq(outcomeMeasurements.status, "confirmed"),
    eq(outcomeMeasurements.dataClass, "real"),
    eq(outcomeMeasurements.comparabilityStatus, "comparable"),
    inArray(outcomeMeasurements.origin, ["manual", "automatic"]),
  )).orderBy(desc(outcomeMeasurements.actualObservedAt), desc(outcomeMeasurements.createdAt), desc(outcomeMeasurements.id)).limit(50);
  rows.sort((a, b) => Number(Boolean(metric) && b.metric === metric) - Number(Boolean(metric) && a.metric === metric));
  const selected = rows.slice(0, LEARNING_CONTEXT_LIMIT);
  const items = [];
  for (const measurement of selected) {
    const [decision] = await db.select().from(decisions).where(eq(decisions.id, measurement.decisionId)).limit(1);
    const [task] = await db.select().from(tasks).where(eq(tasks.id, measurement.taskId)).limit(1);
    if (!decision || !task || task.decisionId !== decision.id) continue;
    const assessment = assessmentForMeasurement(measurement, decision.effect);
    if (assessment.status !== "confirmed") continue;
    items.push({ measurement, decision, task, assessment });
  }
  const measurementRefs = items.map(({ measurement }) => ({ measurementId: measurement.id, measurementVersion: measurement.version }));
  const text = items.length ? [
    "Проверяемые прецеденты этого проекта. Это исторические ассоциации, а не доказательство причинности. Не переноси численный эффект на новый сигнал без основания и не повышай confidence из-за одного прецедента.",
    ...items.map(({ measurement, decision, task, assessment }) => [
      `Task ${task.id}; Decision ${decision.id}; metric ${measurement.metric}.`,
      `Ожидаемый эффект: ${decision.effect}`,
      `Фактический эффект: ${assessment.text}`,
      `Достижение цели: ${assessment.targetStatus}.`,
      `Основание: ${assessment.basis}`,
    ].join(" ")),
  ].join("\n\n") : "";
  const contextHash = createHash("sha256").update(JSON.stringify({ measurementRefs, text })).digest("hex");
  return { text, measurementRefs, contextHash, count: items.length };
}

export type LearningContext = Awaited<ReturnType<typeof buildLearningContext>>;

export async function recordLearningContextUsage(input: {
  proposalId: string;
  proposalVersion: number;
  modelId: string;
  context: LearningContext;
  projectId?: string;
}) {
  const projectId = input.projectId || DEMO_PROJECT_ID;
  if (!input.context.measurementRefs.length) return { created: false };
  return getDb().transaction(async (tx) => {
    const [existing] = await tx.select().from(learningContextUsages).where(and(
      eq(learningContextUsages.proposalId, input.proposalId),
      eq(learningContextUsages.proposalVersion, input.proposalVersion),
      eq(learningContextUsages.contextHash, input.context.contextHash),
    )).limit(1);
    if (existing) return { usage: existing, created: false };
    const [inserted] = await tx.insert(learningContextUsages).values({
      projectId,
      proposalId: input.proposalId,
      proposalVersion: input.proposalVersion,
      contextHash: input.context.contextHash,
      modelId: input.modelId,
      measurementRefs: input.context.measurementRefs,
    }).$returningId();
    const [usage] = await tx.select().from(learningContextUsages).where(eq(learningContextUsages.id, inserted.id)).limit(1);
    await tx.insert(auditEvents).values({
      projectId,
      entityType: "learning_context",
      entityId: input.proposalId,
      eventType: "learning.context.used",
      actorName: "Пиэмка",
      actorRole: "system",
      attribution: "Пиэмка · проверяемый контекст эффектов",
      channel: "system",
      version: input.proposalVersion,
      metadata: {
        contextHash: input.context.contextHash,
        modelId: input.modelId,
        measurementRefs: input.context.measurementRefs,
        limitation: "Историческая ассоциация, не доказательство причинности",
      },
      detail: "Подтверждённые эффекты использованы в контексте нового предложения",
    });
    return { usage, created: true };
  });
}
