import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { getTelegramConfig } from "../telegram/config";
import { sendTelegramMessage } from "../telegram/client";
import { log } from "../lib/logger";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const attemptsByIp = new Map<string, number[]>();

const contactSchema = z.object({
  name: z.string().trim().max(80).optional().default(""),
  contact: z.string().trim().min(3).max(120).refine(
    (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) || /^@[A-Za-z0-9_]{5,32}$/.test(value),
    { message: "Укажите email или Telegram username" },
  ),
  comment: z.string().trim().max(1000).optional().default(""),
  consent: z.boolean().refine((value) => value, { message: "Требуется согласие" }),
  website: z.string().max(200).optional().default(""),
}).strict();

function clientIp(c: { req: { header: (name: string) => string | undefined } }) {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function rateLimited(ip: string) {
  const now = Date.now();
  const recent = (attemptsByIp.get(ip) || []).filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    attemptsByIp.set(ip, recent);
    return true;
  }
  recent.push(now);
  attemptsByIp.set(ip, recent);
  if (attemptsByIp.size > 1000) {
    for (const [key, timestamps] of attemptsByIp) {
      if (!timestamps.some((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS)) attemptsByIp.delete(key);
    }
  }
  return false;
}

function singleLine(value: string) {
  return value.replace(/[\u0000-\u001F\u007F]+/g, " ").trim();
}

function multiLine(value: string) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+/g, "").trim();
}

function recipientChatId() {
  const explicit = process.env.CONTACT_TELEGRAM_CHAT_ID?.trim();
  if (explicit) return explicit;
  return getTelegramConfig().rpUserIds.values().next().value as string | undefined;
}

export const contactRoutes = new Hono();

contactRoutes.post(
  "/",
  bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ ok: false, error: "Слишком большой запрос" }, 413) }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = contactSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: "Проверьте контакт и согласие на обработку данных" }, 400);
    }

    // Honeypot submissions receive a neutral answer but are never delivered.
    if (parsed.data.website) return c.json({ ok: true });

    if (rateLimited(clientIp(c))) {
      c.header("Retry-After", String(RATE_LIMIT_WINDOW_MS / 1000));
      return c.json({ ok: false, error: "Слишком много отправок. Попробуйте позже" }, 429);
    }

    const chatId = recipientChatId();
    if (!chatId) return c.json({ ok: false, error: "Канал связи временно недоступен" }, 503);

    const { name, contact, comment } = parsed.data;
    const lines = [
      "📮 Новый интерес к AI PMO",
      "",
      `Имя: ${name ? singleLine(name) : "не указано"}`,
      `Контакт: ${singleLine(contact)}`,
      `Комментарий: ${comment ? multiLine(comment) : "нет"}`,
      "",
      "Источник: landing.html",
      `Согласие на обработку контакта: подтверждено`,
    ];

    try {
      await sendTelegramMessage({ chatId, text: lines.join("\n") });
      return c.json({ ok: true });
    } catch (error) {
      log.error("contact delivery failed", { error: error instanceof Error ? error.message : String(error) });
      return c.json({ ok: false, error: "Не удалось доставить сообщение. Попробуйте ещё раз" }, 502);
    }
  },
);
