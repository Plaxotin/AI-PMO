import { describe, expect, it, vi } from "vitest";
import { generateObject } from "ai";
import { analyzeCommitmentSignal } from "./commitment";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("./client", () => ({
  listModels: vi.fn().mockResolvedValue({ defaultModelId: "synthetic-model" }),
  classifyAiError: vi.fn((error: unknown) => error),
}));
vi.mock("./provider", () => ({ kimiGw: vi.fn(() => "synthetic-gateway") }));

describe("BL-50 commitment extraction", () => {
  it("returns a structured commitment and forbids invented fields", async () => {
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: {
        isCommitment: true,
        confidence: 0.94,
        title: "Подготовить отчёт для спонсора",
        owner: "Synthetic owner",
        due: "15.11.2026",
        changeType: "create",
        existingTaskId: null,
      },
    } as Awaited<ReturnType<typeof generateObject>>);

    const result = await analyzeCommitmentSignal("Подготовлю отчёт для спонсора до 15.11.2026", "Synthetic author");

    expect(result.isCommitment).toBe(true);
    expect(result.changeType).toBe("create");
    expect(result.existingTaskId).toBeNull();
    const call = vi.mocked(generateObject).mock.calls[0][0];
    expect(call.system).toContain("Не выдумывай действие, ответственного, дату или существующий ID поручения");
  });

  it("returns a structured update without inventing a task ID", async () => {
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: {
        isCommitment: true,
        confidence: 0.96,
        title: "Перенести отчёт для спонсора",
        owner: "Synthetic owner",
        due: "25.11.2026",
        changeType: "update",
        existingTaskId: null,
      },
    } as Awaited<ReturnType<typeof generateObject>>);

    const result = await analyzeCommitmentSignal("Перенесу отчёт для спонсора на 25.11.2026", "Synthetic author");

    expect(result.changeType).toBe("update");
    expect(result.existingTaskId).toBeNull();
  });
});
