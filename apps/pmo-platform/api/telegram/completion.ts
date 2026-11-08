export const DEFAULT_PROJECT_TIME_ZONE = "Europe/Moscow";
export const COMPLETION_CHECK_MINUTE = 9 * 60;

export type TaskDueDate = {
  key: string;
  year: number;
  month: number;
  day: number;
};

export type EffectAssessment = {
  expectedEffect: string;
  status: "confirmed" | "unconfirmed";
  text: string;
  basis: string;
};

function validDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseTaskDue(value: string): TaskDueDate | null {
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const year = Number(ru?.[3] ?? iso?.[1]);
  const month = Number(ru?.[2] ?? iso?.[2]);
  const day = Number(ru?.[1] ?? iso?.[3]);
  if ((!ru && !iso) || !validDate(year, month, day)) return null;
  return {
    key: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    year,
    month,
    day,
  };
}

export function projectParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return {
    dayKey: `${year}-${month}-${day}`,
    minuteOfDay: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function shouldAskForCompletion(due: string, now: Date, timeZone = DEFAULT_PROJECT_TIME_ZONE) {
  const parsed = parseTaskDue(due);
  if (!parsed || Number.isNaN(now.getTime())) return false;
  const projectNow = projectParts(now, timeZone);
  return parsed.key === projectNow.dayKey && projectNow.minuteOfDay >= COMPLETION_CHECK_MINUTE;
}

export function formatProjectDateTime(date: Date, timeZone = DEFAULT_PROJECT_TIME_ZONE) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function completionPromptText(input: {
  taskId: string;
  title: string;
  author: string;
  owner: string;
  createdAt: Date;
  due: string;
  source?: { url: string | null; sourceId: string };
  timeZone?: string;
}) {
  return [
    "Поручение выполнено?",
    "",
    `Поручение ${input.taskId}: ${input.title}`,
    `Автор исходного сигнала: ${input.author || "—"}`,
    `Ответственный: ${input.owner || "—"}`,
    `Источник: ${input.source?.url || (input.source ? `недоступен; сохранён sourceId ${input.source.sourceId}` : "не связан")}`,
    `Дата создания: ${formatProjectDateTime(input.createdAt, input.timeZone)}`,
    `Срок: ${input.due || "—"}`,
  ].join("\n");
}

export function assessTaskEffect(
  expectedEffect: string,
  confirmed?: { text: string; basis: string },
): EffectAssessment {
  const expected = expectedEffect.trim() || "—";
  if (confirmed?.text.trim() && confirmed.basis.trim()) {
    return {
      expectedEffect: expected,
      status: "confirmed",
      text: confirmed.text.trim(),
      basis: confirmed.basis.trim(),
    };
  }
  return {
    expectedEffect: expected,
    status: "unconfirmed",
    text: "Эффект пока не подтверждён фактическими данными.",
    basis: "В реестре нет фактических параметров проекта, достаточных для подтверждения изменения.",
  };
}

export function effectNotificationText(input: {
  taskId: string;
  title: string;
  actorName: string;
  assessment: EffectAssessment;
}) {
  return [
    `✅ Поручение ${input.taskId} выполнено.`,
    input.title,
    "",
    `Результат: выполнение подтверждено РП ${input.actorName}.`,
    `Ожидаемый эффект: ${input.assessment.expectedEffect}`,
    `${input.assessment.status === "confirmed" ? "Достигнутый эффект" : "Подтверждённый эффект"}: ${input.assessment.text}`,
    `Основание: ${input.assessment.basis}`,
  ].join("\n");
}
