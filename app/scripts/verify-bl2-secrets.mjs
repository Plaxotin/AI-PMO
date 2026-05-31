#!/usr/bin/env node
/**
 * BL2-0: проверка GOOGLE_* (OAuth client) и SALUTESPEECH_* из env.
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

function verifyGoogleOAuthConfig() {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  requireEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = requireEnv("GOOGLE_REDIRECT_URI");

  if (!clientId.includes(".apps.googleusercontent.com")) {
    console.log(
      "  (warn) GOOGLE_CLIENT_ID does not look like a Google OAuth client id",
    );
  }

  try {
    const url = new URL(redirectUri);
    if (!["http:", "https:"].includes(url.protocol)) {
      fail("GOOGLE_REDIRECT_URI must be http or https");
      return;
    }
  } catch {
    fail("GOOGLE_REDIRECT_URI is not a valid URL");
    return;
  }

  ok(
    `Google OAuth: env OK (client=${clientId.slice(0, 20)}…, redirect=${redirectUri})`,
  );
  console.log(
    "  (note) Full OAuth consent is verified after BL2-0 implements /api/auth/google",
  );
}

async function main() {
  console.log("BL2-0 secrets verification\n");

  const hasGoogleOAuth =
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI;
  const hasLegacySa =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY;
  const hasSalute =
    process.env.SALUTESPEECH_CLIENT_ID && process.env.SALUTESPEECH_SECRET;

  if (hasLegacySa) {
    fail(
      "GOOGLE_SERVICE_ACCOUNT_* is deprecated. Use GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI (see docs/plans/BL2-0_SECRETS_SETUP.md).",
    );
  }

  if (!hasSalute && !hasGoogleOAuth) {
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

  if (hasGoogleOAuth) {
    try {
      verifyGoogleOAuthConfig();
    } catch (e) {
      fail(`Google OAuth: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    console.log("⊘ Google OAuth: skipped (GOOGLE_CLIENT_* not set)");
  }

  if (process.exitCode) {
    console.log("\nFix errors above, then re-run: npm run verify:bl2-secrets");
  } else {
    console.log("\nAll configured checks passed.");
  }
}

main();
