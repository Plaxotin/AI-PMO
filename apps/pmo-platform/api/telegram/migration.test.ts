import { describe, expect, it } from "vitest";
import { getTelegramChatMigration } from "./migration";

describe("BL-36 Telegram chat migration", () => {
  it("accepts the service message in the old group", () => {
    expect(getTelegramChatMigration({ chat: { id: -900 }, migrate_to_chat_id: -100900 })).toEqual({
      oldChatId: "-900",
      newChatId: "-100900",
      direction: "to",
    });
  });

  it("accepts the service message in the new supergroup", () => {
    expect(getTelegramChatMigration({ chat: { id: -100900 }, migrate_from_chat_id: -900 })).toEqual({
      oldChatId: "-900",
      newChatId: "-100900",
      direction: "from",
    });
  });

  it("does not mistake ordinary messages for a migration", () => {
    expect(getTelegramChatMigration({ chat: { id: -900 } })).toBeNull();
    expect(getTelegramChatMigration()).toBeNull();
  });

  it("rejects ambiguous or self-migration payloads", () => {
    expect(getTelegramChatMigration({ chat: { id: -900 }, migrate_to_chat_id: -900 })).toBeNull();
    expect(getTelegramChatMigration({ chat: { id: -900 }, migrate_to_chat_id: -100900, migrate_from_chat_id: -800 })).toBeNull();
  });
});
