import { telegramSourceLink } from "../queries/proposal-audit";

type SignalSource = {
  authorName: string;
  content: string;
  createdAt: Date;
  chatId: string;
  messageId: number;
};

export function commitmentRationale(signal: SignalSource) {
  const receivedAt = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: process.env.PROJECT_TIME_ZONE || "Europe/Moscow",
  }).format(signal.createdAt);
  const source = telegramSourceLink(signal.chatId, signal.messageId);
  return [
    `Автор: ${signal.authorName}`,
    `Текст: «${signal.content}»`,
    `Получено: ${receivedAt}`,
    source.url ? `Источник: ${source.url}` : null,
  ].filter(Boolean).join("\n");
}

export function taskRegistryUrl() {
  const url = new URL(process.env.PMO_WORKSPACE_URL || "https://pmo.195.133.14.151.sslip.io/workspace.html");
  url.searchParams.set("view", "tasks");
  return url.toString();
}
