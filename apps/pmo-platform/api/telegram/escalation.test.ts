import { describe, expect, it } from "vitest";
import { decisionNotificationText, decisionSlaSteps, taskNotificationText, taskOverdueHours, taskSlaSteps } from "./escalation";

describe("BL-42 pending decision SLA", () => {
  it("fires reminder at 24 hours and escalation at 48 hours", () => {
    const since = new Date("2026-11-05T04:00:00.000Z");
    expect(decisionSlaSteps(since, new Date("2026-11-06T03:59:00.000Z"))).toEqual([]);
    expect(decisionSlaSteps(since, new Date("2026-11-06T04:00:00.000Z"))).toEqual(["reminder"]);
    expect(decisionSlaSteps(since, new Date("2026-11-07T04:00:00.000Z"))).toEqual(["reminder", "escalation"]);
  });
});

describe("BL-42 overdue task SLA", () => {
  it("starts after the calendar due date and escalates at 24 overdue hours", () => {
    expect(taskSlaSteps("07.11.2026", new Date("2026-11-07T06:00:00.000Z"), "Europe/Moscow")).toEqual([]);
    expect(taskOverdueHours("07.11.2026", new Date("2026-11-07T21:00:00.000Z"), "Europe/Moscow")).toBe(0);
    expect(taskSlaSteps("2026-11-07", new Date("2026-11-08T20:59:00.000Z"), "Europe/Moscow")).toEqual(["reminder"]);
    expect(taskSlaSteps("2026-11-07", new Date("2026-11-08T21:00:00.000Z"), "Europe/Moscow")).toEqual(["reminder", "escalation"]);
  });

  it("ignores invalid dates", () => {
    expect(taskSlaSteps("07.11", new Date("2026-11-08T21:00:00.000Z"), "Europe/Moscow")).toEqual([]);
  });
});

describe("BL-42 read-only escalation messages", () => {
  it("gives sponsor decision context without offering approval", () => {
    const text = decisionNotificationText({
      step: "escalation", decisionId: "D-1", title: "Предложение", riskTitle: "Риск",
      owner: "Владелец", due: "09.11.2026", pendingHours: 49,
      history: ["proposal.created"], source: { status: "unavailable", url: null, sourceId: "message-1" },
    });
    expect(text).toContain("История событий: proposal.created");
    expect(text).toContain("sourceId message-1");
    expect(text).toContain("только чтение");
    expect(text).not.toContain("Принять");
  });

  it("addresses task reminder to owner and escalation copy to RP", () => {
    const reminder = taskNotificationText({ step: "reminder", recipientRole: "owner", taskId: "P-1", title: "Задача", riskTitle: "Риск", owner: "Владелец", due: "07.11.2026", overdueHours: 1, history: [] });
    const copy = taskNotificationText({ step: "escalation", recipientRole: "rp", taskId: "P-1", title: "Задача", riskTitle: "Риск", owner: "Владелец", due: "07.11.2026", overdueHours: 25, history: [] });
    expect(reminder).toContain("Напоминание ответственному");
    expect(copy).toContain("Копия РП");
    expect(copy).toContain("Автоматического закрытия нет");
  });
});
