import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ApiModel } from "@apipilot/shared-domain";
import { InputLimitExceededError, NoOperationsDerivedError } from "../../../../src/apiInput/errors";
import { buildHarModel } from "../../../../src/apiInput/har/buildHarModel";
import { DEFAULT_INPUT_LIMITS } from "../../../../src/apiInput/limits";
import { harEntry, harOf, jsonEntry, manyEntries } from "../../../fixtures/apiInput/harBuilders";

const harDir = path.join(__dirname, "..", "..", "..", "fixtures", "apiInput", "har");
const realistic = (): Record<string, unknown> => JSON.parse(readFileSync(path.join(harDir, "realistic.har"), "utf-8"));
const build = (doc: Record<string, unknown>, limits = DEFAULT_INPUT_LIMITS) => buildHarModel(doc, limits);

const API = "https://api.shop.test";

/** A letters-only word that is never identifier-like (four letters), unique per index. */
function wordOf(index: number): string {
  let rest = index;
  let word = "";
  for (let i = 0; i < 4; i += 1) {
    word = String.fromCharCode(97 + (rest % 26)) + word;
    rest = Math.floor(rest / 26);
  }
  return word;
}
const op = (model: ApiModel, method: string, p: string) => model.operations.find((o) => o.method === method && o.path === p);

describe("buildHarModel: the realistic capture", () => {
  it("imports, excludes and rejects entries with counts that reconcile exactly (SC-005)", async () => {
    const model = await build(realistic());
    const report = model.importReport!;
    expect(report.counts).toEqual({ total: 46, imported: 29, excluded: 12, malformed: 5, operations: 18 });
    expect(report.counts.imported + report.counts.excluded + report.counts.malformed).toBe(report.counts.total);
    expect(report.exclusions.reduce((sum, g) => sum + g.count, 0)).toBe(report.counts.excluded);
    expect(report.malformedEntries).toHaveLength(report.counts.malformed);
    expect(report.exclusions.map((g) => [g.reason, g.count])).toEqual([
      ["non-http-scheme", 1],
      ["cors-preflight", 1],
      ["failed-request", 1],
      ["redirect", 1],
      ["not-modified", 1],
      ["analytics-telemetry", 2],
      ["static-asset", 2],
      ["html-document", 1],
      ["third-party-origin", 1],
      ["duplicate-method-path-other-origin", 1],
    ]);
    for (const group of report.exclusions) {
      expect(group.reason).toBeTruthy();
      expect(group.samples.length).toBeGreaterThan(0);
      expect(group.samples.length).toBeLessThanOrEqual(20);
    }
    expect(report.malformedEntries.map((m) => m.reason)).toEqual([
      "missing-url", "missing-response-status", "relative-url", "not-an-object", "missing-method",
    ]);
    expect(report.harVersion).toBe("1.2");
    expect(report.creator).toBe("ApiPilot synthetic builder 1.0");
    expect(model.summary.operationCount).toBe(18);
    expect(model.securitySchemes).toEqual({});
  });

  it("keeps the reconciliation invariant over reordered, thinned and duplicated captures", async () => {
    const base = realistic() as { log: { entries: unknown[] } };
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let round = 0; round < 12; round += 1) {
      const entries = base.log.entries.filter(() => next() % 4 !== 0);
      entries.push(...entries.slice(0, next() % 6));
      entries.sort(() => (next() % 3) - 1);
      if (entries.length === 0) continue;
      const doc = { log: { ...base.log, entries } };
      try {
        const report = (await build(doc)).importReport!;
        expect(report.counts.imported + report.counts.excluded + report.counts.malformed).toBe(report.counts.total);
        expect(report.counts.total).toBe(entries.length);
      } catch (error) {
        expect(error).toBeInstanceOf(NoOperationsDerivedError);
        const { counts } = (error as NoOperationsDerivedError<{ counts: Record<string, number> }>).report;
        expect(counts.imported + counts.excluded + counts.malformed).toBe(counts.total);
      }
    }
  });

  it("derives path parameters only with evidence and reports the rest", async () => {
    const model = await build(realistic());
    expect(op(model, "GET", "/v1/orders/{orderId}")?.observed?.pathParameters).toEqual([
      expect.objectContaining({ name: "orderId", position: 2, distinctValues: 3, provenance: { origin: "inferred", observationCount: 3, confidence: "high" } }),
    ]);
    expect(op(model, "GET", "/v1/users/{userId}/orders/{orderId}")).toBeDefined();
    expect(op(model, "GET", "/v1/users/me/profile")).toBeDefined();
    expect(op(model, "GET", "/v1/invoices/inv_55aa66bb77cc")).toBeDefined();
    const ambiguous = model.summary.issues.filter((i) => i.kind === "ambiguous-path");
    expect(ambiguous.map((i) => i.location)).toEqual(["GET /v1/invoices/inv_55aa66bb77cc"]);
  });

  it("labels each fact observed or inferred with its count, and marks unknowns as unknown", async () => {
    const model = await build(realistic());
    const orders = op(model, "GET", "/v1/orders")!;
    expect(orders.provenance).toEqual({ origin: "observed", observationCount: 3, confidence: "high" });
    const page = orders.parameters.find((p) => p.name === "page")!;
    expect(page).toMatchObject({ location: "query", required: false, requiredUnknown: true, provenance: { origin: "observed", observationCount: 3 } });
    const sort = orders.parameters.find((p) => p.name === "sort")!;
    expect(sort.provenance).toEqual({ origin: "observed", observationCount: 1, confidence: "low" });
    const orderId = op(model, "GET", "/v1/orders/{orderId}")!.parameters.find((p) => p.name === "orderId")!;
    expect(orderId).toMatchObject({ location: "path", required: true, provenance: { origin: "inferred" } });
    const byId = op(model, "GET", "/v1/orders/{orderId}")!;
    expect(byId.responses.map((r) => [r.statusCode, r.provenance?.observationCount])).toEqual([["200", 2], ["404", 1]]);
    expect(orders.requestBody).toBeUndefined();
    expect(op(model, "POST", "/v1/orders")?.requestBody).toMatchObject({ required: false, requiredUnknown: true });
  });

  it("never invents a status, field, constraint, security scheme or requirement (SC-006)", async () => {
    interface RawEntry {
      request?: { postData?: { text?: string; params?: { name: string }[] } };
      response?: { status?: number; content?: { text?: string } };
    }
    interface SchemaNode {
      properties?: Record<string, SchemaNode>;
      items?: SchemaNode;
      [keyword: string]: unknown;
    }
    const doc = realistic() as { log: { entries: (RawEntry | null | string)[] } };
    const observedStatuses = new Set<string>();
    const observedKeys = new Set<string>();
    const collectKeys = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(collectKeys);
      else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { observedKeys.add(k); collectKeys(v); }
    };
    for (const candidate of doc.log.entries) {
      const entry = typeof candidate === "object" ? candidate : null;
      if (entry?.response?.status !== undefined) observedStatuses.add(String(entry.response.status));
      for (const text of [entry?.request?.postData?.text, entry?.response?.content?.text]) {
        if (text === undefined) continue;
        try { collectKeys(JSON.parse(text)); } catch { /* not JSON */ }
      }
      for (const p of entry?.request?.postData?.params ?? []) observedKeys.add(p.name);
    }
    const model = await build(doc);
    const walk = (schema: SchemaNode) => {
      for (const [name, child] of Object.entries(schema.properties ?? {})) { expect(observedKeys.has(name), `field ${name}`).toBe(true); walk(child); }
      if (schema.items) walk(schema.items);
      for (const keyword of ["enum", "format", "minimum", "maximum", "pattern", "minLength", "maxLength", "minItems", "maxItems"]) expect(schema[keyword]).toBeUndefined();
    };
    for (const operation of model.operations) {
      expect(operation.security).toEqual([]);
      for (const response of operation.responses) {
        expect(observedStatuses.has(response.statusCode), `status ${response.statusCode}`).toBe(true);
        Object.values(response.contentTypes).forEach(walk);
      }
      Object.values(operation.requestBody?.contentTypes ?? {}).forEach(walk);
      for (const status of Object.keys(operation.observed!.statusCounts)) expect(observedStatuses.has(status)).toBe(true);
    }
    // 304, 301 and the failed (0) statuses were excluded, so they are never an observed status.
    const all = model.operations.flatMap((o) => o.responses.map((r) => r.statusCode));
    for (const never of ["0", "101", "301", "304"]) expect(all).not.toContain(never);
    expect(model.securitySchemes).toEqual({});
  });

  it("reports conflicting types, unavailable bodies and multipart file parts as issues, without values", async () => {
    const model = await build(realistic());
    const text = model.summary.issues.map((i) => `${i.kind}|${i.location}|${i.message}`).join("\n");
    expect(text).toContain('conflicting-types|GET /v1/stats|Field "count"');
    expect(text).toMatch(/unsupported-content\|GET \/v1\/export\|1 response body could not be used: the body is compressed/);
    expect(text).toMatch(/unsupported-content\|GET \/v1\/blob\|.*binary/);
    expect(text).toMatch(/unsupported-content\|GET \/v1\/notes\|.*not JSON/);
    expect(text).toMatch(/unsupported-content\|POST \/v1\/files\|.*file part/);
    expect(text).toMatch(/incomplete-observation\|GET \/v1\/cut\|.*cut short/);
    expect(text).toMatch(/incomplete-observation\|GET \/v1\/broken\|.*does not parse/);
    expect(text).toMatch(/unsupported-content\|capture\|1 WebSocket/);
    expect(op(model, "GET", "/v1/stats")?.responses[0].contentTypes["application/json"].properties.count).toEqual({ required: [], properties: {} });
    expect(op(model, "GET", "/v1/export")?.responses[0].bodyUnavailable).toBe("compressed");
  });

  it("is deterministic: the same capture gives byte-identical output every time (SC-003)", async () => {
    const first = JSON.stringify(await build(realistic()));
    for (let i = 0; i < 3; i += 1) expect(JSON.stringify(await build(realistic()))).toBe(first);
  });

  it("orders operations by primary origin, then path, then method", async () => {
    const model = await build(realistic());
    const keys = model.operations.map((o) => `${o.observed!.origin} ${o.path} ${o.method}`);
    const primary = keys.filter((k) => k.startsWith(API));
    expect(keys.slice(0, primary.length)).toEqual(primary);
    expect(primary).toEqual([...primary].sort());
    expect(model.importReport!.origins.map((o) => o.origin)).toEqual([API, "https://auth.shop.test"]);
  });
});

describe("buildHarModel: one operation per method and path across origins (clarification 2026-10-18)", () => {
  const login = (origin: string, count: number) =>
    Array.from({ length: count }, () => jsonEntry("POST", `${origin}/v1/login`, 200, { ok: true }, { username: "ada" }));

  it("keeps the origin with more observations, excludes the other with a reason and raises an issue naming both", async () => {
    const model = await build(harOf([...login(API, 3), ...login("https://auth.shop.test", 1)]));
    expect(model.operations).toHaveLength(1);
    expect(model.operations[0].observed?.origin).toBe(API);
    const duplicate = model.summary.issues.filter((i) => i.kind === "duplicate-operation");
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0].message).toContain(API);
    expect(duplicate[0].message).toContain("https://auth.shop.test");
    expect(model.importReport!.exclusions).toEqual([expect.objectContaining({ reason: "duplicate-method-path-other-origin", count: 1 })]);
    expect(model.importReport!.counts).toMatchObject({ total: 4, imported: 3, excluded: 1 });
  });

  it("lets the other origin win when it has more observations, and breaks ties by the smaller origin", async () => {
    const other = await build(harOf([...login(API, 1), ...login("https://auth.shop.test", 2)]));
    expect(other.operations[0].observed?.origin).toBe("https://auth.shop.test");
    const tie = await build(harOf([...login("https://b.shop.test", 2), ...login("https://a.shop.test", 2)]));
    expect(tie.operations[0].observed?.origin).toBe("https://a.shop.test");
  });

  it("imports different methods and paths from several origins side by side", async () => {
    const model = await build(harOf([jsonEntry("GET", `${API}/v1/a`, 200, {}), jsonEntry("GET", "https://auth.shop.test/v1/b", 200, {})]));
    expect(model.operations.map((o) => o.observed?.origin)).toEqual([API, "https://auth.shop.test"]);
  });
});

describe("buildHarModel: failures and limits", () => {
  it("creates nothing and returns the counts by reason when every entry is excluded or malformed (FR-021)", async () => {
    const doc = JSON.parse(readFileSync(path.join(harDir, "all-excluded.har"), "utf-8"));
    try {
      await build(doc);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(NoOperationsDerivedError);
      const { report } = error as NoOperationsDerivedError<{ counts: Record<string, number>; exclusions: { reason: string }[]; malformedEntries: unknown[] }>;
      expect(report.counts).toEqual({ total: 5, imported: 0, excluded: 4, malformed: 1, operations: 0 });
      expect(report.exclusions.map((g) => g.reason)).toEqual(["analytics-telemetry", "static-asset", "html-document"]);
      expect(report.malformedEntries).toHaveLength(1);
      expect((error as Error).message).toContain("4 entries were excluded and 1 was malformed");
    }
  });

  it("caps issues per kind at 200 and adds one summary issue", async () => {
    // One identifier-like value under each of 250 distinct literal prefixes: each is a lone, ambiguous value.
    const entries = Array.from({ length: 250 }, (_, i) => jsonEntry("GET", `${API}/v1/${wordOf(i)}/ord_7f3a9c21d4`, 200, {}));
    const model = await build(harOf(entries));
    const ambiguous = model.summary.issues.filter((i) => i.kind === "ambiguous-path");
    expect(ambiguous).toHaveLength(201);
    expect(ambiguous.at(-1)).toMatchObject({ location: "capture", message: expect.stringContaining("50 more ambiguous-path findings were suppressed") });
  });

  it("refuses a capture that would produce more operations than the limit and names it", async () => {
    const entries = Array.from({ length: 2001 }, (_, i) => jsonEntry("GET", `${API}/v1/${wordOf(i)}`, 200, {}));
    await expect(build(harOf(entries), { ...DEFAULT_INPUT_LIMITS, harMaxEntries: 5000 })).rejects.toMatchObject({
      name: "InputLimitExceededError",
      limit: "derived-operations",
      maximum: 2000,
    });
  });

  it("skips an oversized body, reports it under limitsApplied and still imports the entry", async () => {
    const big = JSON.stringify({ blob: "x".repeat(5000) });
    const model = await build(harOf([harEntry({ method: "POST", url: `${API}/v1/big`, requestBody: { mimeType: "application/json", text: big }, responseText: "{}" })]), {
      ...DEFAULT_INPUT_LIMITS,
      maxBodyBytes: 1000,
    });
    expect(model.operations).toHaveLength(1);
    expect(model.importReport!.limitsApplied).toEqual([{ limit: "INPUT_MAX_BODY_BYTES", effect: "body skipped and reported", count: 1 }]);
    expect(model.summary.issues.some((i) => i.kind === "unsupported-content" && i.message.includes("larger than the analyzed body size limit"))).toBe(true);
  });

  it("refuses more entries than the entry limit", async () => {
    await expect(build(harOf(manyEntries(6)), { ...DEFAULT_INPUT_LIMITS, harMaxEntries: 5 })).rejects.toBeInstanceOf(InputLimitExceededError);
  });

  it("yields to the event loop while analyzing a long capture, so other work is served", async () => {
    const order: string[] = [];
    setImmediate(() => order.push("other request"));
    const model = await build(harOf(manyEntries(450)));
    order.push("analysis finished");
    expect(order[0]).toBe("other request");
    expect(model.importReport!.counts.total).toBe(450);
  });

  it("reports credential-embedded URLs by position and host only", async () => {
    const model = await build(
      harOf([
        jsonEntry("GET", `https://u:SEEDED-SECRET-UI@api.shop.test/v1/a`, 200, {}),
        jsonEntry("GET", `${API}/v1/b`, 200, {}),
      ]),
    );
    expect(model.importReport!.credentialUrlCount).toBe(1);
    expect(model.importReport!.credentialUrlEntries).toEqual([{ entryIndex: 0, host: "api.shop.test" }]);
    expect(JSON.stringify(model)).not.toContain("SEEDED-SECRET");
  });
});
