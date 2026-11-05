import "dotenv/config";
import { config as loadCredentials } from "dotenv";

// Local development only. Production secrets must come from the server environment.
// Never commit .env, .credentials, tokens, passwords, or encrypted production payloads.
loadCredentials({ path: ".credentials/telegram.env", quiet: true });
const localCredentialsLoaded = Boolean(process.env.TELEGRAM_BOT_TOKEN);

export function telegramCredentialDiagnostics() {
  return {
    revision: "env-v1",
    localCredentialsLoaded,
    appSecretAvailable: Boolean(process.env.APP_SECRET),
    encryptedFound: false,
    decrypted: false,
    error: "",
  };
}

function ids(value: string | undefined) {
  return new Set((value || "").split(",").map((x) => x.trim()).filter(Boolean));
}

export function getTelegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const projectChatIds = ids(process.env.TELEGRAM_PROJECT_CHAT_IDS || process.env.TELEGRAM_PROJECT_CHAT_ID);
  return {
    configured: Boolean(token && process.env.TELEGRAM_WEBHOOK_SECRET && projectChatIds.size > 0),
    token,
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
    gatewaySecret: process.env.TELEGRAM_GATEWAY_SECRET || "",
    projectChatIds,
    rpUserIds: ids(process.env.TELEGRAM_RP_USER_IDS),
    memberUserIds: ids(process.env.TELEGRAM_MEMBER_USER_IDS),
    apiBaseUrl: (process.env.TELEGRAM_API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, ""),
  };
}

export function telegramRole(userId: number | string, config = getTelegramConfig()) {
  const id = String(userId);
  if (config.rpUserIds.has(id)) return "rp" as const;
  if (config.memberUserIds.has(id) || config.rpUserIds.has(id)) return "member" as const;
  return null;
}

export function publicTelegramStatus() {
  const config = getTelegramConfig();
  return {
    configured: config.configured,
    chatBound: config.projectChatIds.size > 0,
    chatCount: config.projectChatIds.size,
    rpBound: config.rpUserIds.size > 0,
    membersBound: config.memberUserIds.size > 0,
  };
}
