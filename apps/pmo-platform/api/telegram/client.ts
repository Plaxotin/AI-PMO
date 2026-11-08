import { getTelegramConfig } from "./config";

export type TelegramButton = { text: string; callback_data: string };
export type TelegramDeliveryOutcome = "failed" | "unknown";

export class TelegramDeliveryError extends Error {
  readonly outcome: TelegramDeliveryOutcome;

  constructor(message: string, outcome: TelegramDeliveryOutcome) {
    super(message);
    this.name = "TelegramDeliveryError";
    this.outcome = outcome;
  }
}

export function telegramDeliveryOutcome(error: unknown): TelegramDeliveryOutcome {
  return error instanceof TelegramDeliveryError ? error.outcome : "unknown";
}

async function call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const config = getTelegramConfig();
  if (!config.token) throw new TelegramDeliveryError("Telegram-бот не настроен", "failed");
  const useGateway = Boolean(config.gatewaySecret);
  const url = useGateway
    ? `${config.apiBaseUrl}/v1/telegram/${method}`
    : `${config.apiBaseUrl}/bot${config.token}/${method}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(useGateway ? { "x-gateway-key": config.gatewaySecret } : {}),
      },
      body: JSON.stringify(useGateway ? { ...payload, token: config.token } : payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new TelegramDeliveryError(error instanceof Error ? error.message : String(error), "unknown");
  }
  let body: { ok?: boolean; result?: T; description?: string };
  try {
    body = await response.json() as { ok?: boolean; result?: T; description?: string };
  } catch {
    throw new TelegramDeliveryError(`Telegram API ${method}: нечитаемый ответ HTTP ${response.status}`, "unknown");
  }
  if (!response.ok || !body.ok) {
    const outcome = response.status >= 400 && response.status < 500 ? "failed" : "unknown";
    throw new TelegramDeliveryError(body.description || `Telegram API ${method}: HTTP ${response.status}`, outcome);
  }
  return body.result as T;
}

export function sendTelegramMessage(input: { chatId: string | number; text: string; replyToMessageId?: number; buttons?: TelegramButton[][]; forceReply?: boolean }) {
  return call<{ message_id: number }>("sendMessage", {
    chat_id: input.chatId,
    text: input.text.slice(0, 4000),
    ...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {}),
    ...(input.buttons ? { reply_markup: { inline_keyboard: input.buttons.map((row) => row.map((button) => ({ text: button.text, callback_data: button.callback_data }))) } } : {}),
    ...(input.forceReply ? { reply_markup: { force_reply: true, input_field_placeholder: "Опишите результат выполнения" } } : {}),
  });
}

export function editTelegramMessage(input: { chatId: string | number; messageId: number; text: string; buttons?: TelegramButton[][] }) {
  return call<boolean>("editMessageText", {
    chat_id: input.chatId,
    message_id: input.messageId,
    text: input.text.slice(0, 4000),
    ...(input.buttons ? { reply_markup: { inline_keyboard: input.buttons.map((row) => row.map((button) => ({ text: button.text, callback_data: button.callback_data }))) } } : {}),
  });
}

export function answerTelegramCallback(callbackQueryId: string, text: string) {
  return call<boolean>("answerCallbackQuery", { callback_query_id: callbackQueryId, text: text.slice(0, 190) });
}

export async function configureTelegramWebhook(webhookUrl: string) {
  const config = getTelegramConfig();
  if (!config.configured) throw new Error("Заполните серверные настройки Telegram");
  const me = await call<{ id: number; username?: string }>("getMe", {});
  await call<boolean>("setWebhook", {
    url: webhookUrl,
    secret_token: config.webhookSecret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  return { bot: me, webhookUrl };
}

export function getTelegramWebhookInfo() {
  return call<{ url?: string; pending_update_count?: number; last_error_message?: string }>("getWebhookInfo", {});
}
