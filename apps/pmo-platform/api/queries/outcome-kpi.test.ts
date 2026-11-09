import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { googleSheetsRead, observationErrors, registryJsonRead } from "./outcome-kpi";
import type { outcomeMetricBindings, outcomeSources } from "@db/schema";

const source = {
  id: "SRC-UNIT",
  type: "registry_json",
  connectionRef: "BL48_UNIT_SOURCE",
  readOnly: true,
} as typeof outcomeSources.$inferSelect;
const binding = {
  externalKey: "schedule-current",
  unit: "currency",
  currencyCode: "RUB",
} as typeof outcomeMetricBindings.$inferSelect;
const previousNodeEnv = process.env.NODE_ENV;
const originalFetch = globalThis.fetch;
const tempPaths: string[] = [];

afterEach(() => {
  process.env.NODE_ENV = previousNodeEnv;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  delete process.env.BL48_UNIT_SOURCE_URL;
  delete process.env.BL48_UNIT_SOURCE_TOKEN;
  delete process.env.BL48_UNIT_GOOGLE_CREDS_PATH;
  delete process.env.BL48_UNIT_GOOGLE_SPREADSHEET_ID;
  for (const path of tempPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("BL-48 registry_json read-only adapter", () => {
  it("uses only GET and keeps credentials out of the URL", async () => {
    process.env.BL48_UNIT_SOURCE_URL = "http://127.0.0.1:43123/kpi";
    process.env.BL48_UNIT_SOURCE_TOKEN = "synthetic-secret";
    const calls: { url: string; method?: string; authorization?: string }[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method,
        authorization: (init?.headers as Record<string, string>)?.Authorization,
      });
      return new Response(JSON.stringify({ observations: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    await registryJsonRead({ source, binding });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("binding=schedule-current");
    expect(calls[0].url).not.toContain("synthetic-secret");
    expect(calls[0].authorization).toBe("Bearer synthetic-secret");
  });

  it("rejects non-HTTPS production sources before any network call", async () => {
    process.env.NODE_ENV = "production";
    process.env.BL48_UNIT_SOURCE_URL = "http://example.test/kpi";
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    await expect(registryJsonRead({ source, binding })).rejects.toThrow("OUTCOME_SOURCE_HTTPS_REQUIRED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("BL-48 observation validation", () => {
  it("rejects currency mismatch", () => {
    const errors = observationErrors({
      externalObservationId: "COST-1",
      role: "actual",
      value: "90",
      unit: "currency",
      currencyCode: "USD",
      observedAt: "2026-11-08T10:00:00.000Z",
      dataClass: "real",
    }, binding);
    expect(errors).toContain("CURRENCY_MISMATCH");
  });

  it("rejects nonnumeric values and invalid observation time", () => {
    const errors = observationErrors({
      externalObservationId: "COST-2",
      role: "actual",
      value: "not-a-number",
      unit: "currency",
      currencyCode: "RUB",
      observedAt: "invalid-date",
      dataClass: "real",
    }, binding);
    expect(errors).toEqual(expect.arrayContaining(["VALUE_NOT_NUMERIC", "OBSERVED_AT_INVALID"]));
  });
});


describe("BL-48 google_sheets read-only adapter", () => {
  function configureSyntheticCredentials() {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicExponent: 65537,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const directory = mkdtempSync(join(tmpdir(), "bl48-google-"));
    tempPaths.push(directory);
    const credentialsPath = join(directory, "service-account.json");
    writeFileSync(credentialsPath, JSON.stringify({ client_email: "synthetic@example.test", private_key: privateKey }));
    process.env.BL48_UNIT_GOOGLE_CREDS_PATH = credentialsPath;
    process.env.BL48_UNIT_GOOGLE_SPREADSHEET_ID = "synthetic-sheet";
    return {
      ...source,
      type: "google_sheets",
      connectionRef: "BL48_UNIT_GOOGLE",
      config: { range: "Реестр поручений!A:Z" },
    } as typeof outcomeSources.$inferSelect;
  }

  const sheetValues = [
    ["Data sozdaniya", "Avtor/Istochnik", "Контрагент", "ID", "Opisanie", "", "Srok plan", "Srok korr", "Status", "Data zakrytiya", "Prioritet", "Kommentariy"],
    ["07.08.2026", "Synthetic", "Synthetic", "3", "Synthetic completed assignment", "", "19.08.2026", "19.08.2026", "Выполнено", "18.08.2026", "", ""],
  ];

  it("uses OAuth read-only scope and maps real row durations", async () => {
    const googleSource = configureSyntheticCredentials();
    const googleBinding = { ...binding, externalKey: "P-03", unit: "days", currencyCode: null } as typeof outcomeMetricBindings.$inferSelect;
    const calls: { url: string; method?: string; authorization?: string }[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method, authorization: (init?.headers as Record<string, string>)?.Authorization });
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "synthetic-access-token" }), { status: 200 });
      }
      return new Response(JSON.stringify({ values: sheetValues }), { status: 200 });
    });

    const observations = await googleSheetsRead({ source: googleSource, binding: googleBinding });

    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe("POST");
    expect(calls[1].method).toBe("GET");
    expect(calls[1].url).toContain("https://sheets.googleapis.com/v4/spreadsheets/synthetic-sheet/values/");
    expect(calls[1].authorization).toBe("Bearer synthetic-access-token");
    expect(observations.map((item) => item.value)).toEqual(["12", "12", "11"]);
    expect(observations.map((item) => item.role)).toEqual(["baseline", "target", "actual"]);
    expect(observations.every((item) => item.dataClass === "real")).toBe(true);
    expect(observations.every((item) => item.unit === "days")).toBe(true);
  });

  it("rejects a row without comparable dates instead of inventing KPI", async () => {
    const googleSource = configureSyntheticCredentials();
    const googleBinding = { ...binding, externalKey: "P-03", unit: "days", currencyCode: null } as typeof outcomeMetricBindings.$inferSelect;
    const incomplete = [sheetValues[0], sheetValues[1].map((value, index) => index === 9 ? "" : value)];
    globalThis.fetch = vi.fn(async (input) => {
      if (String(input) === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "synthetic-access-token" }), { status: 200 });
      }
      return new Response(JSON.stringify({ values: incomplete }), { status: 200 });
    });

    await expect(googleSheetsRead({ source: googleSource, binding: googleBinding })).rejects.toThrow("OUTCOME_SOURCE_ROW_FIELDS_MISSING");
  });
});
