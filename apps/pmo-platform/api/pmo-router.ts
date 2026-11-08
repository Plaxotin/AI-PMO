import { z } from "zod";
import { authedQuery, createRouter, rpQuery } from "./middleware";
import { decideProposal, getProjectState } from "./queries/pmo";
import { correctPendingProposal } from "./queries/correction";
import { recordOutcome } from "./queries/outcome";

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
      metric: z.enum(["schedule_days", "cost_amount", "quality_defects", "resource_days"]),
      unit: z.enum(["days", "hours", "currency", "count", "percent", "ratio"]),
      baselineValue: z.string().trim().max(32).optional(),
      targetValue: z.string().trim().max(32).optional(),
      actualValue: z.string().trim().min(1).max(32),
      source: z.string().trim().min(1).max(2000),
      sourceId: z.string().trim().min(1).max(255),
      sourceUrl: z.string().url().max(2000).nullable().optional(),
      measurementId: z.number().int().positive().optional(),
    }))
    .mutation(({ ctx, input }) => recordOutcome(input, { userId: ctx.user.id, name: ctx.user.name || "Руководитель проекта" })),
});
