import { describe, expect, it } from "vitest";
import { confidenceOf, provenanceOf } from "../../../../src/apiInput/har/confidence";
import { extractEntry } from "../../../../src/apiInput/har/extractEntry";
import { inferPathPatterns, pathKey } from "../../../../src/apiInput/har/inferPathParameters";
import { isNoiseHeader, OperationAccumulator } from "../../../../src/apiInput/har/mergeObservations";
import type { ExtractedEntry } from "../../../../src/apiInput/har/types";
import { DEFAULT_INPUT_LIMITS } from "../../../../src/apiInput/limits";
import { harEntry, jsonEntry } from "../../../fixtures/apiInput/harBuilders";

const ORIGIN = "https://api.shop.test";

function entries(raws: Record<string, unknown>[]): ExtractedEntry[] {
  return raws.map((raw, index) => {
    const result = extractEntry(raw, index, DEFAULT_INPUT_LIMITS);
    if (result.kind !== "entry") throw new Error(result.reason);
    return result.entry;
  });
}

function merge(list: ExtractedEntry[]) {
  const patterns = inferPathPatterns(list.map((e) => ({ origin: e.origin, method: e.method, path: e.path })));
  const first = list[0];
  const firstPattern = patterns.get(pathKey(first.origin, first.method, first.path))!;
  const accumulator = new OperationAccumulator(first.origin, first.method, firstPattern);
  for (const entry of list) accumulator.add(entry, patterns.get(pathKey(entry.origin, entry.method, entry.path))!);
  return accumulator.build();
}

describe("OperationAccumulator (FR-014)", () => {
  it("counts observations and statuses, listing only statuses that were observed", () => {
    const group = merge(entries([jsonEntry("GET", `${ORIGIN}/v1/a`, 200, {}), jsonEntry("GET", `${ORIGIN}/v1/a`, 200, {}), jsonEntry("GET", `${ORIGIN}/v1/a`, 404, {})]));
    expect(group.observationCount).toBe(3);
    expect(group.statusCounts).toEqual({ "200": 2, "404": 1 });
    expect(Object.keys(group.statusCounts)).not.toContain("500");
  });

  it("counts each query parameter once per observation, against the operation's observation count", () => {
    const group = merge(entries([
      jsonEntry("GET", `${ORIGIN}/v1/a?page=1&page=2&sort=asc`, 200, {}),
      jsonEntry("GET", `${ORIGIN}/v1/a?page=3`, 200, {}),
      jsonEntry("GET", `${ORIGIN}/v1/a`, 200, {}),
    ]));
    expect(group.queryParameterCounts).toEqual({ page: 2, sort: 1 });
    expect(group.observationCount).toBe(3);
  });

  it("drops transport and browser noise headers and keeps content-type, accept and custom headers", () => {
    const group = merge(entries([
      jsonEntry("GET", `${ORIGIN}/v1/a`, 200, {}, undefined, {
        requestHeaders: {
          Host: "api.shop.test", "User-Agent": "x", "Accept-Encoding": "gzip", "Accept-Language": "en", Connection: "keep-alive",
          Referer: "https://shop.test/", Origin: "https://shop.test", "Sec-Fetch-Mode": "cors", "If-None-Match": "abc", ":authority": "a",
          "Cache-Control": "no-cache", Pragma: "no-cache", "Content-Length": "5", Accept: "application/json", "Content-Type": "application/json", "X-Tenant": "t1",
        },
      }),
    ]));
    expect(Object.keys(group.headerCounts).sort()).toEqual(["accept", "content-type", "x-tenant"]);
    expect(isNoiseHeader("sec-ch-ua")).toBe(true);
    expect(isNoiseHeader("x-tenant")).toBe(false);
  });

  it("collapses identical examples into one with a count, and orders by count then first position", () => {
    const same = () => jsonEntry("POST", `${ORIGIN}/v1/a`, 201, { id: 1 }, { sku: "A" });
    const group = merge(entries([
      jsonEntry("POST", `${ORIGIN}/v1/a`, 201, { id: 2 }, { sku: "B" }),
      same(), same(), same(),
    ]));
    expect(group.examples.map((e) => [e.observations, e.firstEntryIndex, (e.body as { sku: string }).sku])).toEqual([[3, 1, "A"], [1, 0, "B"]]);
  });

  it("keeps at most five examples and counts the rest", () => {
    const list = entries(Array.from({ length: 9 }, (_, i) => jsonEntry("POST", `${ORIGIN}/v1/a`, 201, { id: i }, { sku: `S${i}` })));
    const group = merge(list);
    expect(group.examples).toHaveLength(5);
    expect(group.droppedExampleCount).toBe(4);
  });

  it("separates examples by status: a different outcome is a different example", () => {
    const group = merge(entries([jsonEntry("POST", `${ORIGIN}/v1/a`, 201, {}, { sku: "A" }), jsonEntry("POST", `${ORIGIN}/v1/a`, 400, {}, { sku: "A" })]));
    expect(group.examples.map((e) => e.responseStatus).sort()).toEqual(["201", "400"]);
  });

  it("infers request bodies per content type and response bodies per status, never merging statuses", () => {
    const group = merge(entries([
      jsonEntry("POST", `${ORIGIN}/v1/a`, 201, { id: 1 }, { sku: "A", qty: 1 }),
      jsonEntry("POST", `${ORIGIN}/v1/a`, 400, { error: "bad" }, { sku: "B" }),
    ]));
    expect([...group.requestEvidence.keys()]).toEqual(["application/json"]);
    expect(group.requestEvidence.get("application/json")!.build().schema.required).toEqual(["sku"]);
    expect([...group.responseEvidence.keys()].sort()).toEqual(["201", "400"]);
    expect(Object.keys(group.responseEvidence.get("201")!.get("application/json")!.build().schema.properties)).toEqual(["id"]);
    expect(Object.keys(group.responseEvidence.get("400")!.get("application/json")!.build().schema.properties)).toEqual(["error"]);
  });

  it("counts unavailable bodies by direction and reason and notes statuses with no usable body", () => {
    const group = merge(entries([
      harEntry({ url: `${ORIGIN}/v1/a`, responseMimeType: "application/json", responseText: "oops", responseSize: 4 }),
      harEntry({ url: `${ORIGIN}/v1/a`, responseMimeType: "application/json", responseText: "oops", responseSize: 4 }),
    ]));
    expect(group.unavailable).toEqual([{ direction: "response", reason: "invalid-json", count: 2 }]);
    expect(group.responseUnavailable.get("200")).toBe("invalid-json");
  });

  it("does not report a status as unavailable when another observation of it had a usable body", () => {
    const group = merge(entries([
      harEntry({ url: `${ORIGIN}/v1/a`, responseMimeType: "application/json", responseText: "oops", responseSize: 4 }),
      jsonEntry("GET", `${ORIGIN}/v1/a`, 200, { ok: true }),
    ]));
    expect(group.responseUnavailable.size).toBe(0);
  });

  it("records form bodies as evidence and as examples, and a multipart file part as evidence only", () => {
    const group = merge(entries([
      harEntry({ method: "POST", url: `${ORIGIN}/v1/up`, requestBody: { mimeType: "multipart/form-data; boundary=x", params: [{ name: "caption", value: "c" }, { name: "f", fileName: "a.png", contentType: "image/png" }] }, responseText: "{}" }),
      harEntry({ method: "POST", url: `${ORIGIN}/v1/up`, requestBody: { mimeType: "application/x-www-form-urlencoded", params: [{ name: "caption", value: "c" }] }, responseText: "{}" }),
    ]));
    expect([...group.requestEvidence.keys()].sort()).toEqual(["application/x-www-form-urlencoded", "multipart/form-data"]);
    expect(group.examples.find((e) => e.contentType === "application/x-www-form-urlencoded")?.body).toEqual({ caption: "c" });
    expect(group.examples.find((e) => e.contentType === "multipart/form-data")).toMatchObject({ bodyUnavailable: "multipart-file" });
    expect(group.examples.find((e) => e.contentType === "multipart/form-data")?.body).toBeUndefined();
  });

  it("counts repeated credentials once per entry and carries no value", () => {
    const group = merge(entries([
      jsonEntry("GET", `${ORIGIN}/v1/a?api_key=SEEDED-SECRET-M1`, 200, {}, undefined, { requestHeaders: { Authorization: "Bearer SEEDED-SECRET-M2" } }),
      jsonEntry("GET", `${ORIGIN}/v1/a?api_key=SEEDED-SECRET-M3`, 200, {}, undefined, { requestHeaders: { Authorization: "Bearer SEEDED-SECRET-M4" } }),
    ]));
    expect(group.credentials).toEqual([
      { location: "header", name: "authorization", kind: "token", observations: 2 },
      { location: "query", name: "api_key", kind: "apiKey", observations: 2 },
    ]);
    expect(JSON.stringify(group)).not.toContain("SEEDED-SECRET");
  });

  it("stores the path parameter value of each example", () => {
    const group = merge(entries([jsonEntry("GET", `${ORIGIN}/v1/orders/ord_a1a1a1a1a1a1`, 200, {}), jsonEntry("GET", `${ORIGIN}/v1/orders/ord_b2b2b2b2b2b2`, 200, {})]));
    expect(group.path).toBe("/v1/orders/{orderId}");
    expect(group.examples.map((e) => e.pathParameters)).toEqual([{ orderId: "ord_a1a1a1a1a1a1" }, { orderId: "ord_b2b2b2b2b2b2" }]);
  });
});

describe("confidence (FR-028, research R7)", () => {
  it.each([
    [1, true, "low"],
    [2, true, "medium"],
    [3, true, "high"],
    [40, true, "high"],
    [5, false, "low"],
    [2, false, "low"],
    [0, true, "low"],
  ] as const)("%d consistent=%s gives %s", (count, consistent, expected) => {
    expect(confidenceOf(count, consistent)).toBe(expected);
  });

  it("builds provenance with the count and the label", () => {
    expect(provenanceOf("observed", 3)).toEqual({ origin: "observed", observationCount: 3, confidence: "high" });
    expect(provenanceOf("inferred", 2, false)).toEqual({ origin: "inferred", observationCount: 2, confidence: "low" });
  });
});
