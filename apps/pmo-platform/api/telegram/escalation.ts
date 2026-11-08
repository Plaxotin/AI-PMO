import { parseTaskDue, projectParts } from "./completion";

export const DECISION_REMINDER_HOURS = 24;
export const DECISION_ESCALATION_HOURS = 48;
export const TASK_ESCALATION_HOURS = 24;

export type SlaObjectType = "decision" | "task";
export type SlaStep = "reminder" | "escalation";
export type SlaRecipientRole = "rp" | "owner" | "sponsor";

export function decisionSlaSteps(pendingSince: Date, now: Date): SlaStep[] {
  const hours = (now.getTime() - pendingSince.getTime()) / 3_600_000;
  const steps: SlaStep[] = [];
  if (hours >= DECISION_REMINDER_HOURS) steps.push("reminder");
  if (hours >= DECISION_ESCALATION_HOURS) steps.push("escalation");
  return steps;
}

export function taskOverdueHours(due: string, now: Date, timeZone: string): number | null {
  const parsed = parseTaskDue(due);
  if (!parsed || Number.isNaN(now.getTime())) return null;
  const current = projectParts(now, timeZone);
  const currentDay = Date.UTC(Number(current.dayKey.slice(0, 4)), Number(current.dayKey.slice(5, 7)) - 1, Number(current.dayKey.slice(8, 10)));
  const dueDay = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  return (currentDay - dueDay) / 3_600_000 - 24 + current.minuteOfDay / 60;
}

export function taskSlaSteps(due: string, now: Date, timeZone: string): SlaStep[] {
  const hours = taskOverdueHours(due, now, timeZone);
  if (hours === null || hours < 0) return [];
  return hours >= TASK_ESCALATION_HOURS ? ["reminder", "escalation"] : ["reminder"];
}

function sourceText(source?: { status: "available" | "unavailable"; url: string | null; sourceId: string } | null) {
  if (!source) return "Источник: недоступен";
  return source.status === "available" && source.url
    ? `Источник: ${source.url}`
    : `Источник недоступен; сохранён sourceId ${source.sourceId}`;
}

export function decisionNotificationText(input: {
  step: SlaStep;
  decisionId: string;
  title: string;
  riskTitle: string;
  owner: string;
  due: string;
  pendingHours: number;
  history: string[];
  source?: { status: "available" | "unavailable"; url: string | null; sourceId: string } | null;
}) {
  const heading = input.step === "reminder"
    ? "Напоминание: предложение ожидает решения РП более 24 часов."
    : "Эскалация спонсору: предложение ожидает решения более 48 часов.";
  return [
    heading,
    "",
    `Риск: ${input.riskTitle}`,
    `Предложение ${input.decisionId}: ${input.title}`,
    `Ответственный: ${input.owner || "—"}`,
    `Срок: ${input.due || "—"}`,
    `Ожидание решения: ${Math.floor(input.pendingHours)} ч.`,
    sourceText(input.source),
    `История событий: ${input.history.length ? input.history.join(" → ") : "пока нет событий"}`,
    input.step === "escalation" ? "Режим спонсора: только чтение, без действий утверждения." : "Решение остаётся за РП; автоматического принятия нет.",
  ].join("\n");
}

export function taskNotificationText(input: {
  step: SlaStep;
  recipientRole: SlaRecipientRole;
  taskId: string;
  title: string;
  riskTitle: string;
  owner: string;
  due: string;
  overdueHours: number;
  history: string[];
  source?: { status: "available" | "unavailable"; url: string | null; sourceId: string } | null;
}) {
  const heading = input.step === "reminder"
    ? "Напоминание ответственному: поручение просрочено."
    : input.recipientRole === "sponsor"
      ? "Эскалация спонсору: поручение просрочено более чем на 24 часа."
      : "Копия РП: поручение эскалировано после 24 часов просрочки.";
  return [
    heading,
    "",
    `Поручение ${input.taskId}: ${input.title}`,
    `Риск: ${input.riskTitle}`,
    `Ответственный: ${input.owner || "—"}`,
    `Срок: ${input.due || "—"}`,
    `Просрочка: ${Math.max(0, Math.floor(input.overdueHours))} ч.`,
    sourceText(input.source),
    `История событий: ${input.history.length ? input.history.join(" → ") : "пока нет событий"}`,
    input.step === "escalation" ? "Автоматического закрытия нет; действия утверждения спонсору недоступны." : "Поручение остаётся открытым.",
  ].join("\n");
}
