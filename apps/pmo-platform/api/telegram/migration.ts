export type TelegramMigrationMessage = {
  chat: { id: number };
  migrate_to_chat_id?: number;
  migrate_from_chat_id?: number;
};

export function getTelegramChatMigration(message?: TelegramMigrationMessage) {
  if (!message) return null;
  const hasTarget = message.migrate_to_chat_id !== undefined;
  const hasSource = message.migrate_from_chat_id !== undefined;
  if (hasTarget === hasSource) return null;

  const oldChatId = String(hasTarget ? message.chat.id : message.migrate_from_chat_id);
  const newChatId = String(hasTarget ? message.migrate_to_chat_id : message.chat.id);
  if (oldChatId === newChatId) return null;

  return {
    oldChatId,
    newChatId,
    direction: hasTarget ? "to" as const : "from" as const,
  };
}
