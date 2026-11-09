import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contactRoutes } from "./contact";
import { sendTelegramMessage, TelegramDeliveryError } from "../telegram/client";

vi.mock("../telegram/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../telegram/client")>();
  return { ...actual, sendTelegramMessage: vi.fn() };
});

const mockSend = vi.mocked(sendTelegramMessage);
const app = new Hono();
app.route("/api/contact", contactRoutes);

const validBody = {
  name: "Тест",
  contact: "test@example.com",
  comment: "Интересен пилот",
  consent: true,
  website: "",
};

function post(body: unknown, ip = `test-${crypto.randomUUID()}`) {
  return app.request("/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("POST /api/contact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CONTACT_TELEGRAM_CHAT_ID", "test-recipient");
    vi.stubEnv("TELEGRAM_FOUNDER_USER_IDS", "");
    vi.stubEnv("TELEGRAM_RP_USER_IDS", "");
    mockSend.mockResolvedValue({ message_id: 1 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("delivers a valid contact to the explicit Telegram recipient", async () => {
    vi.stubEnv("TELEGRAM_FOUNDER_USER_IDS", "founder-recipient");
    vi.stubEnv("TELEGRAM_RP_USER_IDS", "rp-recipient");
    const response = await post(validBody);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, outcome: "sent" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "test-recipient",
      text: expect.stringContaining("test@example.com"),
    }));
  });

  it("uses the first founder as the default contact recipient", async () => {
    vi.stubEnv("CONTACT_TELEGRAM_CHAT_ID", "");
    vi.stubEnv("TELEGRAM_FOUNDER_USER_IDS", "founder-recipient, second-founder");
    vi.stubEnv("TELEGRAM_RP_USER_IDS", "rp-recipient");
    const response = await post(validBody);
    expect(response.status).toBe(200);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ chatId: "founder-recipient" }));
  });

  it("keeps the legacy RP fallback when no contact or founder recipient exists", async () => {
    vi.stubEnv("CONTACT_TELEGRAM_CHAT_ID", "");
    vi.stubEnv("TELEGRAM_RP_USER_IDS", "rp-recipient");
    const response = await post(validBody);
    expect(response.status).toBe(200);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ chatId: "rp-recipient" }));
  });

  it("returns an honest configuration error without a recipient", async () => {
    vi.stubEnv("CONTACT_TELEGRAM_CHAT_ID", "");
    const response = await post(validBody);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      outcome: "failed",
      error: "Канал связи временно недоступен",
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("accepts a Telegram username as contact", async () => {
    const response = await post({ ...validBody, contact: "@test_user" });
    expect(response.status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid contact without Telegram delivery", async () => {
    const response = await post({ ...validBody, contact: "not-a-contact" });
    expect(response.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without Telegram delivery", async () => {
    const response = await app.request("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `json-${crypto.randomUUID()}` },
      body: "{not-json",
    });
    expect(response.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("requires consent", async () => {
    const response = await post({ ...validBody, consent: false });
    expect(response.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not deliver honeypot submissions", async () => {
    const response = await post({ ...validBody, website: "spam.example" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("reports a definite Telegram failure without recommending a retry", async () => {
    mockSend.mockRejectedValueOnce(new TelegramDeliveryError("Bad Request: chat not found", "failed"));
    const response = await post(validBody);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      outcome: "failed",
      error: "Сообщение не отправлено. Канал связи временно недоступен",
    });
  });

  it("reports an unknown delivery outcome and warns against a duplicate", async () => {
    mockSend.mockRejectedValueOnce(new TelegramDeliveryError("network timeout", "unknown"));
    const response = await post(validBody);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      outcome: "unknown",
      error: "Статус доставки не подтверждён. Не отправляйте форму повторно: сообщение могло быть доставлено",
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("classifies an unexpected exception as unknown", async () => {
    mockSend.mockRejectedValueOnce(new Error("unexpected transport failure"));
    const response = await post(validBody);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ ok: false, outcome: "unknown" }));
  });

  it("rate-limits repeated submissions from one client", async () => {
    const ip = `rate-${crypto.randomUUID()}`;
    for (let index = 0; index < 5; index += 1) {
      expect((await post(validBody, ip)).status).toBe(200);
    }
    expect((await post(validBody, ip)).status).toBe(429);
    expect(mockSend).toHaveBeenCalledTimes(5);
  });
});
