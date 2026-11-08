import { describe, expect, it } from "vitest";
import {
  assessTaskEffect,
  completionPromptText,
  effectNotificationText,
  parseTaskDue,
  shouldAskForCompletion,
} from "./completion";

describe("BL-42 completion due dates", () => {
  it("accepts both canonical full-date formats", () => {
    expect(parseTaskDue("07.11.2026")?.key).toBe("2026-11-07");
    expect(parseTaskDue("2026-11-07")?.key).toBe("2026-11-07");
    expect(parseTaskDue("29.02.2028")?.key).toBe("2028-02-29");
  });

  it("rejects incomplete and impossible dates", () => {
    for (const value of ["", "—", "30.09", "2026-11", "31.02.2026", "2026-02-31", "07/11/2026"]) {
      expect(parseTaskDue(value)).toBeNull();
    }
  });

  it("starts the check at 09:00 in the project timezone on the due date", () => {
    expect(shouldAskForCompletion("07.11.2026", new Date("2026-11-07T05:59:00.000Z"))).toBe(false);
    expect(shouldAskForCompletion("07.11.2026", new Date("2026-11-07T06:00:00.000Z"))).toBe(true);
    expect(shouldAskForCompletion("2026-11-07", new Date("2026-11-07T08:30:00.000Z"))).toBe(true);
  });

  it("does not fire before the due date or on a later date", () => {
    expect(shouldAskForCompletion("07.11.2026", new Date("2026-11-06T20:00:00.000Z"))).toBe(false);
    expect(shouldAskForCompletion("07.11.2026", new Date("2026-11-08T06:00:00.000Z"))).toBe(false);
  });
});

describe("BL-42 completion and L3 messages", () => {
  it("includes the task context required by SPEC-P0", () => {
    const text = completionPromptText({
      taskId: "P-01",
      title: "Подтвердить поставку",
      author: "Участник",
      owner: "Бессонов К.",
      source: { url: "https://t.me/c/900/900", sourceId: "Telegram · чат -100900 · сообщение 900" },
      createdAt: new Date("2026-11-06T12:00:00.000Z"),
      due: "07.11.2026",
    });
    expect(text).toContain("Поручение выполнено?");
    expect(text).toContain("P-01");
    expect(text).toContain("Подтвердить поставку");
    expect(text).toContain("Автор исходного сигнала: Участник");
    expect(text).toContain("Ответственный: Бессонов К.");
    expect(text).toContain("Источник: https://t.me/c/900/900");
    expect(text).toContain("Срок: 07.11.2026");
  });

  it("reports a confirmed effect only with evidence", () => {
    const assessment = assessTaskEffect("Сохранить срок", { text: "Срок сохранён", basis: "Контрольная дата не изменилась" });
    expect(assessment.status).toBe("confirmed");
    const text = effectNotificationText({ taskId: "P-01", title: "Задача", actorName: "РП", assessment });
    expect(text).toContain("Достигнутый эффект: Срок сохранён");
    expect(text).toContain("Основание: Контрольная дата не изменилась");
  });

  it("never turns task completion into an unsupported effect claim", () => {
    const assessment = assessTaskEffect("Сохранить срок");
    expect(assessment.status).toBe("unconfirmed");
    expect(assessment.text).toContain("не подтверждён");
    expect(assessment.basis).toContain("нет фактических параметров");
  });
});
