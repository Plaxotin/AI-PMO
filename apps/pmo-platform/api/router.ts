import { authRouter } from "./auth-router";
import { pmoRouter } from "./pmo-router";
import { telegramRouter } from "./telegram-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  pmo: pmoRouter,
  telegram: telegramRouter,
});

export type AppRouter = typeof appRouter;
