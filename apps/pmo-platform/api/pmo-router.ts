import { z } from "zod";
import { adminQuery, authedQuery, createRouter } from "./middleware";
import { decideProposal, getProjectState } from "./queries/pmo";

export const pmoRouter = createRouter({
  state: authedQuery.query(({ ctx }) => getProjectState(ctx.user)),
  decide: adminQuery
    .input(z.object({
      projectId: z.literal("PRJ-01"),
      decisionId: z.string().regex(/^D-(?:[0-9]{2,}|TG-[0-9]+)$/),
      action: z.enum(["ok", "no"]),
      title: z.string().trim().min(1).max(5000).optional(),
      owner: z.string().trim().min(1).max(255).optional(),
      due: z.string().trim().min(1).max(16).optional(),
    }))
    .mutation(({ ctx, input }) => decideProposal(input, ctx.user)),
});
