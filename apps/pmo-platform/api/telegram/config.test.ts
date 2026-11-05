import { afterEach, describe, expect, it, vi } from "vitest";
import { getTelegramConfig, telegramRole } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Telegram configuration", () => {
  it("loads a multi-chat allowlist from the server environment", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
    vi.stubEnv("TELEGRAM_PROJECT_CHAT_IDS", "-1001, -1002,-1001");

    const config = getTelegramConfig();

    expect(config.configured).toBe(true);
    expect([...config.projectChatIds]).toEqual(["-1001", "-1002"]);
  });

  it("is not configured without a webhook secret", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    vi.stubEnv("TELEGRAM_PROJECT_CHAT_IDS", "-1001");

    expect(getTelegramConfig().configured).toBe(false);
  });
});

describe("Telegram roles", () => {
  it("allows only the RP to approve and keeps RP membership implicit", () => {
    const config = {
      rpUserIds: new Set(["10"]),
      memberUserIds: new Set(["20"]),
    };

    expect(telegramRole(10, config as ReturnType<typeof getTelegramConfig>)).toBe("rp");
    expect(telegramRole(20, config as ReturnType<typeof getTelegramConfig>)).toBe("member");
    expect(telegramRole(30, config as ReturnType<typeof getTelegramConfig>)).toBeNull();
  });
});
