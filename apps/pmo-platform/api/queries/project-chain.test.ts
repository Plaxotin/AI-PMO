import { describe, expect, it } from "vitest";
import type { Decision, Risk, Signal, Task } from "@db/schema";
import { buildProjectChain } from "./project-chain";

const at = (value: string) => new Date(`${value}T12:00:00.000Z`);

function signal(overrides: Partial<Signal>): Signal {
  return {
    id: "S-1",
    projectId: "PRJ-01",
    channel: "telegram",
    channelId: "CH-1",
    chatId: "-1001234567890",
    messageId: 900,
    authorId: "author",
    authorName: "Участник",
    content: "Сигнал из переписки",
    status: "risk_created",
    riskId: "R-1",
    error: null,
    createdAt: at("2026-11-07"),
    updatedAt: at("2026-11-07"),
    ...overrides,
  };
}

const risk = { id: "R-1" } as Risk;
const decision = { id: "D-1", riskId: "R-1" } as Decision;
const task = { id: "P-1", decisionId: "D-1", riskId: null } as Task;

describe("BL-35 project audit chain", () => {
  it("connects task through decision and risk to the primary signal", () => {
    const chain = buildProjectChain([signal({})], [risk], [decision], [task]);

    expect(chain.riskSources.get("R-1")?.signalId).toBe("S-1");
    expect(chain.decisionSources.get("D-1")?.signalId).toBe("S-1");
    expect(chain.taskSources.get("P-1")?.signalId).toBe("S-1");
    expect(chain.taskSources.get("P-1")?.sourceLink.url).toBe("https://t.me/c/1234567890/900");
    expect(chain.signals[0]).toMatchObject({ id: "S-1", riskId: "R-1", content: "Сигнал из переписки" });
  });

  it("uses the newest linked signal and preserves an unavailable source identifier", () => {
    const older = signal({ id: "S-old", messageId: 10, createdAt: at("2026-11-06") });
    const newer = signal({ id: "S-new", chatId: "123456789", messageId: 11, createdAt: at("2026-11-07") });
    const chain = buildProjectChain([older, newer], [risk], [decision], [task]);

    expect(chain.riskSources.get("R-1")?.signalId).toBe("S-new");
    expect(chain.riskSources.get("R-1")?.sourceLink).toMatchObject({
      status: "unavailable",
      url: null,
      sourceId: "Telegram · чат 123456789 · сообщение 11",
    });
  });

  it("keeps disconnected records honest instead of inventing a source", () => {
    const chain = buildProjectChain(
      [signal({ riskId: "R-other" })],
      [{ id: "R-2" } as Risk],
      [{ id: "D-2", riskId: "R-2" } as Decision],
      [{ id: "P-2", decisionId: "D-2", riskId: null } as Task],
    );

    expect(chain.riskSources.has("R-2")).toBe(false);
    expect(chain.decisionSources.has("D-2")).toBe(false);
    expect(chain.taskSources.has("P-2")).toBe(false);
  });
});
