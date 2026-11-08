import { z } from "zod";
import { createRouter, rpQuery } from "./middleware";
import { publicTelegramStatus } from "./telegram/config";
import { configureTelegramWebhook, getTelegramWebhookInfo } from "./telegram/client";
import { getFirstValueMetrics } from "./queries/first-value";

export const telegramRouter = createRouter({
  status: rpQuery.query(async () => {
    const status = publicTelegramStatus();
    const firstValue = await getFirstValueMetrics();
    if (!status.configured) return { ...status, connected: false, webhookUrl: null, pendingUpdates: null, lastError: null, firstValue };
    try {
      const info = await getTelegramWebhookInfo();
      return { ...status, connected: Boolean(info.url), webhookUrl: info.url || null, pendingUpdates: info.pending_update_count ?? null, lastError: info.last_error_message || null, firstValue };
    } catch (error) {
      return { ...status, connected: false, webhookUrl: null, pendingUpdates: null, lastError: error instanceof Error ? error.message : "Telegram API недоступен", firstValue };
    }
  }),
  configure: rpQuery
    .input(z.object({ webhookUrl: z.string().url().startsWith("https://").refine((value) => new URL(value).pathname === "/api/telegram/webhook", "URL должен заканчиваться на /api/telegram/webhook") }))
    .mutation(({ input }) => configureTelegramWebhook(input.webhookUrl)),
});
