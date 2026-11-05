import { getTelegramConfig } from "./config";

export type TelegramButton = { text: string; callback_data: string };

async function call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const config = getTelegramConfig();
  if (!config.token) throw new Error("Telegram-бот не настроен");
  const useGateway = Boolean(config.gatewaySecret);
  const url = useGateway
    ? `${config.apiBaseUrl}/v1/telegram/${method}`
    : `${config.apiBaseUrl}/bot${config.token}/${method}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(useGateway ? { "x-gateway-key": config.gatewaySecret } : {}),
    },
    body: JSON.stringify(useGateway ? { ...payload, token: config.token } : payload),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json() as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || !body.ok) throw new Error(body.description || `Telegram API ${method}: HTTP ${response.status}`);
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
