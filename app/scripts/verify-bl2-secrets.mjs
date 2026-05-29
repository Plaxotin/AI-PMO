#!/usr/bin/env node
/**
 * BL2-0: проверка GOOGLE_* (Service Account) и SALUTESPEECH_* из env.
 * Запуск: npm run verify:bl2-secrets  (читает app/.env.local если есть)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envLocal = resolve(__dirname, "../.env.local");

function loadEnvLocal() {
  if (!existsSync(envLocal)) return;
  const text = readFileSync(envLocal, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvLocal();


const SALUTE_OAUTH_URL =
  "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";

function ok(msg) {
  console.log(`✓ ${msg}`);
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) fail(`Missing env: ${name}`);
  return v;
}

function normalizePrivateKey(raw) {
  return raw.replace(/\\n/g, "\n");
}

async function verifySaluteSpeech() {
  const clientId = requireEnv("SALUTESPEECH_CLIENT_ID");
  const clientSecret = requireEnv("SALUTESPEECH_SECRET");
  const scope =
    process.env.SALUTESPEECH_SCOPE?.trim() || "SALUTE_SPEECH_PERS";
  const authKey = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  const res = await fetch(SALUTE_OAUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${authKey}`,
      RqUID: randomUUID(),
    },
    body: new URLSearchParams({ scope }),
  });

  const body = await res.text();
  if (!res.ok) {
    fail(`SaluteSpeech OAuth HTTP ${res.status}: ${body.slice(0, 200)}`);
    return;
  }

  let json;
  try {
    json = JSON.parse(body);
  } catch {
    fail("SaluteSpeech: invalid JSON in token response");
    return;
  }

  if (!json.access_token) {
    fail("SaluteSpeech: no access_token in response");
    return;
  }

  ok(`SaluteSpeech: access token OK (scope=${scope})`);
}

async function verifyGoogleServiceAccount() {
  const email = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = normalizePrivateKey(requireEnv("GOOGLE_PRIVATE_KEY"));

  const { JWT } = await import("google-auth-library");
  const client = new JWT({
    email,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
  });

  const token = await client.getAccessToken();
  if (!token.token) {
    fail("Google SA: empty access token");
    return;
  }
  ok(`Google SA: access token OK (${email})`);

  const sheetId = process.env.GOOGLE_SHEET_ID?.trim();
  if (!sheetId) {
    console.log(
      "  (optional) Set GOOGLE_SHEET_ID to test read access to a shared sheet",
    );
    return;
  }

  const { google } = await import("googleapis");
  const sheets = google.sheets({ version: "v4", auth: client });
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "properties.title",
  });
  ok(`Google Sheet read OK: "${meta.data.properties?.title ?? sheetId}"`);
}

async function main() {
  console.log("BL2-0 secrets verification\n");

  const hasGoogle =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY;
  const hasSalute =
    process.env.SALUTESPEECH_CLIENT_ID && process.env.SALUTESPEECH_SECRET;

  if (!hasSalute && !hasGoogle) {
    fail(
      "No BL2 secrets found. Copy app/.env.example → app/.env.local and fill values.",
    );
    return;
  }

  if (hasSalute) {
    try {
      await verifySaluteSpeech();
    } catch (e) {
      fail(`SaluteSpeech: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    console.log("⊘ SaluteSpeech: skipped (SALUTESPEECH_* not set)");
  }

  if (hasGoogle) {
    try {
      await verifyGoogleServiceAccount();
    } catch (e) {
      fail(`Google SA: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    console.log("⊘ Google SA: skipped (GOOGLE_SERVICE_ACCOUNT_* not set)");
  }

  if (process.exitCode) {
    console.log("\nFix errors above, then re-run: npm run verify:bl2-secrets");
  } else {
    console.log("\nAll configured checks passed.");
  }
}

main();
