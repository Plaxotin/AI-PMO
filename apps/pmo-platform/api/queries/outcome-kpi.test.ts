import { afterEach, describe, expect, it, vi } from "vitest";
import { observationErrors, registryJsonRead } from "./outcome-kpi";
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

afterEach(() => {
  process.env.NODE_ENV = previousNodeEnv;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  delete process.env.BL48_UNIT_SOURCE_URL;
  delete process.env.BL48_UNIT_SOURCE_TOKEN;
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
