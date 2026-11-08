import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { contactRoutes } from "./contact";
import { sendTelegramMessage } from "../telegram/client";

vi.mock("../telegram/client", () => ({ sendTelegramMessage: vi.fn() }));

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
    process.env.CONTACT_TELEGRAM_CHAT_ID = "test-recipient";
    mockSend.mockResolvedValue({ message_id: 1 });
  });

  it("delivers a valid contact to the configured Telegram recipient", async () => {
    const response = await post(validBody);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "test-recipient",
      text: expect.stringContaining("test@example.com"),
    }));
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

  it("requires consent", async () => {
    const response = await post({ ...validBody, consent: false });
    expect(response.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not deliver honeypot submissions", async () => {
    const response = await post({ ...validBody, website: "spam.example" });
    expect(response.status).toBe(200);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns an honest error when Telegram delivery fails", async () => {
    mockSend.mockRejectedValueOnce(new Error("Telegram unavailable"));
    const response = await post(validBody);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Не удалось доставить сообщение. Попробуйте ещё раз",
    });
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
