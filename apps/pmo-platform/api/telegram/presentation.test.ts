import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commitmentRationale, taskRegistryUrl } from "./presentation";

afterEach(() => vi.unstubAllEnvs());

describe("BL-57 Telegram presentation", () => {
  it("uses source author, text, received time and link instead of an internal signal ID", () => {
    vi.stubEnv("PROJECT_TIME_ZONE", "Europe/Moscow");
    const rationale = commitmentRationale({
      authorName: "Synthetic member",
      content: "Подготовить отчёт до 15.11.2026",
      createdAt: new Date("2026-11-11T18:30:00.000Z"),
      chatId: "-100500",
      messageId: 501,
    });
    expect(rationale).toContain("Synthetic member");
    expect(rationale).toContain("Подготовить отчёт до 15.11.2026");
    expect(rationale).toContain("Получено:");
    expect(rationale).toContain("https://t.me/c/500/501");
    expect(rationale).not.toContain("S-BL50-NEW");
  });

  it("links task creation responses to the workspace tasks view", () => {
    vi.stubEnv("PMO_WORKSPACE_URL", "https://workspace.example/workspace.html");
    expect(taskRegistryUrl()).toBe("https://workspace.example/workspace.html?view=tasks");
    const workspace = readFileSync(new URL("../../public/workspace.html", import.meta.url), "utf8");
    expect(workspace).toContain("get('view')==='tasks') tasksCard()");
  });
});
