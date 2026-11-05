import type { AuditSourceLink } from "@db/schema";

export type ProposalSnapshot = {
  title: string;
  rationale: string;
  effect: string;
  owner: string;
  due: string;
};

const fieldLabels = {
  title: "Предложение",
  rationale: "Обоснование",
  effect: "Эффект",
  owner: "Ответственный",
  due: "Срок",
} as const;

type ProposalField = keyof typeof fieldLabels;

export function levenshteinDistance(before: string, after: string) {
  if (before === after) return 0;
  if (!before.length) return after.length;
  if (!after.length) return before.length;

  let previous = Array.from({ length: after.length + 1 }, (_, index) => index);
  let current = new Array<number>(after.length + 1);
  for (let i = 1; i <= before.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= after.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (before[i - 1] === after[j - 1] ? 0 : 1),
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[after.length];
}

export function buildProposalDiff(before: ProposalSnapshot, after: ProposalSnapshot) {
  const changedFields: ProposalField[] = [];
  const sections: string[] = [];
  let editDistance = 0;

  for (const field of Object.keys(fieldLabels) as ProposalField[]) {
    if (before[field] === after[field]) continue;
    changedFields.push(field);
    editDistance += levenshteinDistance(before[field], after[field]);
    sections.push(`## ${fieldLabels[field]}\n- ${before[field] || "—"}\n+ ${after[field] || "—"}`);
  }

  return {
    changed: changedFields.length > 0,
    changedFields,
    editDistance,
    diff: sections.join("\n\n"),
  };
}

export function telegramSourceLink(chatId: string, messageId: number): AuditSourceLink {
  const sourceId = `Telegram · чат ${chatId} · сообщение ${messageId}`;
  const supergroupPrefix = "-100";
  const url = chatId.startsWith(supergroupPrefix) && /^\d+$/.test(chatId.slice(supergroupPrefix.length))
    ? `https://t.me/c/${chatId.slice(supergroupPrefix.length)}/${messageId}`
    : null;

  return {
    type: "telegram_message",
    sourceId,
    status: url ? "available" : "unavailable",
    url,
  };
}
