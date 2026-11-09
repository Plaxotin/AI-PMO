import { z } from "zod";
import { authedQuery, createRouter, rpQuery } from "./middleware";
import { decideProposal, getProjectState } from "./queries/pmo";
import { correctPendingProposal } from "./queries/correction";
import { recordOutcome } from "./queries/outcome";
import { approveOutcomeMetricBinding, collectOutcomeMetricBinding, configureOutcomeSource } from "./queries/outcome-kpi";
import { applyLogicChange, approveLogicChange, createGoldenRegressionCase, proposeLogicChange, rollbackLogicChange, runLogicRegression } from "./queries/learning-metrics";

const metricSchema = z.enum(["schedule_days", "cost_amount", "quality_defects", "resource_days"]);
const unitSchema = z.enum(["days", "hours", "currency", "count", "percent", "ratio"]);

export const pmoRouter = createRouter({
  state: authedQuery.query(({ ctx }) => getProjectState(ctx.user)),
  correct: rpQuery
    .input(z.object({
      projectId: z.literal("PRJ-01"),
      decisionId: z.string().regex(/^(?:D-(?:[0-9]{2,}|TG-[0-9]+)|R-[0-9]{2,})$/),
      title: z.string().trim().min(1).max(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      await correctPendingProposal(input, { userId: ctx.user.id, name: ctx.user.name || "Руководитель проекта" });
      return getProjectState(ctx.user);
    }),
  decide: rpQuery
    .input(z.object({
      projectId: z.literal("PRJ-01"),
      decisionId: z.string().regex(/^(?:D-(?:[0-9]{2,}|TG-[0-9]+)|R-[0-9]{2,})$/),
      action: z.enum(["ok", "no"]),
      title: z.string().trim().min(1).max(5000).optional(),
      owner: z.string().trim().min(1).max(255).optional(),
      due: z.string().trim().min(1).max(16).optional(),
    }))
    .mutation(({ ctx, input }) => decideProposal(input, ctx.user)),
  recordOutcome: rpQuery
    .input(z.object({
      taskId: z.string().trim().min(1).max(64),
      metric: metricSchema,
      unit: unitSchema,
      baselineValue: z.string().trim().max(32).optional(),
      targetValue: z.string().trim().max(32).optional(),
      actualValue: z.string().trim().min(1).max(32),
      source: z.string().trim().min(1).max(2000),
      sourceId: z.string().trim().min(1).max(255),
      sourceUrl: z.string().url().max(2000).nullable().optional(),
      measurementId: z.number().int().positive().optional(),
      direction: z.enum(["decrease_is_better", "increase_is_better"]).optional(),
      currencyCode: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
      baselineObservedAt: z.string().datetime().transform((value) => new Date(value)).optional(),
      actualObservedAt: z.string().datetime().transform((value) => new Date(value)).optional(),
      dataClass: z.enum(["real", "synthetic", "unknown"]).optional(),
    }))
    .mutation(({ ctx, input }) => recordOutcome(input, { userId: ctx.user.id, name: ctx.user.name || "Руководитель проекта" })),
  configureOutcomeSource: rpQuery
    .input(z.object({
      id: z.string().trim().min(1).max(64),
      type: z.string().trim().min(1).max(32),
      name: z.string().trim().min(1).max(255),
      connectionRef: z.string().regex(/^[A-Z0-9_]{3,128}$/),
      config: z.record(z.string(), z.unknown()).optional(),
      status: z.enum(["active", "paused", "disabled"]).optional(),
    }))
    .mutation(({ ctx, input }) => configureOutcomeSource(input, { userId: ctx.user.id, name: ctx.user.name || "Руководитель проекта" })),
  approveOutcomeBinding: rpQuery
    .input(z.object({
      key: z.string().trim().min(1).max(64),
      sourceId: z.string().trim().min(1).max(64),
      decisionId: z.string().trim().min(1).max(64),
      taskId: z.string().trim().min(1).max(64),
      metric: metricSchema,
      unit: unitSchema,
      direction: z.enum(["decrease_is_better", "increase_is_better"]),
      currencyCode: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
      externalKey: z.string().trim().min(1).max(255),
      selectorConfig: z.record(z.string(), z.unknown()).optional(),
      isPrimary: z.boolean().optional(),
    }))
    .mutation(({ ctx, input }) => approveOutcomeMetricBinding(input, { userId: ctx.user.id, name: ctx.user.name || "Руководитель проекта" })),
  collectOutcome: rpQuery
    .input(z.object({ key: z.string().trim().min(1).max(64) }))
    .mutation(({ input }) => collectOutcomeMetricBinding(input.key)),
  proposeLogic: rpQuery
    .input(z.object({
      id: z.string().trim().min(1).max(64),
      cluster: z.string().trim().min(1).max(64),
      question: z.string().trim().min(1).max(5000),
      currentVersion: z.string().trim().min(1).max(64),
      proposedVersion: z.string().trim().min(1).max(64),
      changeType: z.enum(["prompt", "threshold", "rule", "model"]),
      rationale: z.string().trim().min(1).max(5000),
      evidenceRefs: z.array(z.record(z.string(), z.unknown())),
      expectedMetric: z.string().trim().min(1).max(64),
    }))
    .mutation(({ ctx, input }) => proposeLogicChange(input, { userId: ctx.user.id, name: ctx.user.name || "Руководитель проекта" })),
  approveLogic: rpQuery
    .input(z.object({ id: z.string().trim().min(1).max(64) }))
    .mutation(({ ctx, input }) => approveLogicChange(input.id, { userId: ctx.user.id, name: ctx.user.name || "Руководитель проекта" })),
  regressLogic: rpQuery
    .input(z.object({ id: z.string().trim().min(1).max(64), evaluator: z.enum(["default", "degrade"]).optional() }))
    .mutation(({ input }) => runLogicRegression(input.id, input.evaluator)),
  applyLogic: rpQuery
    .input(z.object({ id: z.string().trim().min(1).max(64) }))
    .mutation(({ ctx, input }) => applyLogicChange(input.id, { userId: ctx.user.id, name: ctx.user.name || "Руководитель проекта" })),
  rollbackLogic: rpQuery
    .input(z.object({ id: z.string().trim().min(1).max(64) }))
    .mutation(({ ctx, input }) => rollbackLogicChange(input.id, { userId: ctx.user.id, name: ctx.user.name || "Руководитель проекта" })),
  goldenCase: rpQuery
    .input(z.object({
      id: z.string().trim().min(1).max(64),
      question: z.string().trim().min(1).max(5000),
      input: z.string().trim().min(1).max(20000),
      expected: z.record(z.string(), z.unknown()),
      sourceCorrectionId: z.string().trim().min(1).max(64),
      modelId: z.string().trim().min(1).max(255),
      version: z.string().trim().min(1).max(64),
    }))
    .mutation(({ ctx, input }) => createGoldenRegressionCase(input, { userId: ctx.user.id, name: ctx.user.name || "Руководитель проекта" })),
});
