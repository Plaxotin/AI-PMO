import { describe, expect, it } from "vitest";
import { buildProposalDiff, levenshteinDistance, telegramSourceLink, type ProposalSnapshot } from "./proposal-audit";

const original: ProposalSnapshot = {
  title: "Запросить у поставщика новую дату поставки",
  rationale: "Поставка позже начала тестирования",
  effect: "Снижение риска сдвига приёмки",
  owner: "Бессонов К.",
  due: "30.09",
};

describe("BL-40 proposal versions", () => {
  it("keeps an unchanged proposal without a new diff", () => {
    expect(buildProposalDiff(original, { ...original })).toEqual({
      changed: false,
      changedFields: [],
      editDistance: 0,
      diff: "",
    });
  });

  it("stores field-level diff and edit distance for an edited proposal", () => {
    const edited = { ...original, title: "Перенести тестирование после поставки", owner: "Давыдова Е." };
    const result = buildProposalDiff(original, edited);

    expect(result.changed).toBe(true);
    expect(result.changedFields).toEqual(["title", "owner"]);
    expect(result.editDistance).toBe(
      levenshteinDistance(original.title, edited.title) + levenshteinDistance(original.owner, edited.owner),
    );
    expect(result.diff).toContain("## Предложение");
    expect(result.diff).toContain(`- ${original.title}`);
    expect(result.diff).toContain(`+ ${edited.title}`);
    expect(result.diff).toContain("## Ответственный");
    expect(result.diff).not.toContain("## Обоснование");
  });

  it("calculates Cyrillic edits symmetrically", () => {
    expect(levenshteinDistance("срок", "сток")).toBe(1);
    expect(levenshteinDistance("поставка", "поставки")).toBe(1);
    expect(levenshteinDistance("поставки", "поставка")).toBe(1);
    expect(levenshteinDistance("", "риск")).toBe(4);
  });
});

describe("BL-40 primary source links", () => {
  it("builds a clickable private supergroup message link", () => {
    expect(telegramSourceLink("-1001234567890", 900)).toEqual({
      type: "telegram_message",
      sourceId: "Telegram · чат -1001234567890 · сообщение 900",
      status: "available",
      url: "https://t.me/c/1234567890/900",
    });
  });

  it("keeps the source identifier when a clickable link is unavailable", () => {
    expect(telegramSourceLink("123456789", 42)).toEqual({
      type: "telegram_message",
      sourceId: "Telegram · чат 123456789 · сообщение 42",
      status: "unavailable",
      url: null,
    });
  });
});
