import { describe, expect, it } from "vitest";
import type { DependencyHint } from "@apipilot/shared-domain";
import { buildHarModel } from "../../../../src/apiInput/har/buildHarModel";
import { harvestBodyValues, harvestHeaderValues, isDistinctive } from "../../../../src/apiInput/har/valueEvidence";
import { isNoiseHeader } from "../../../../src/apiInput/har/mergeObservations";
import { DEFAULT_INPUT_LIMITS } from "../../../../src/apiInput/limits";
import { harOf, jsonEntry } from "../../../fixtures/apiInput/harBuilders";

const API = "https://api.shop.test";

async function hintsOf(entries: Record<string, unknown>[]): Promise<{ hints: DependencyHint[]; text: string }> {
  const model = await buildHarModel(harOf(entries), DEFAULT_INPUT_LIMITS);
  return { hints: model.dependencyHints ?? [], text: JSON.stringify(model) };
}

const ID_A = "ord_7f3a9c21d4";
const ID_B = "ord_1b2c3d4e5f60";

describe("detectDependencies (FR-038, research R19)", () => {
  it("links a returned id to a later request path parameter and counts the consuming requests", async () => {
    const { hints } = await hintsOf([
      jsonEntry("POST", `${API}/v1/orders`, 201, { id: ID_A }, { sku: "A" }),
      jsonEntry("POST", `${API}/v1/orders`, 201, { id: ID_B }, { sku: "B" }),
      jsonEntry("GET", `${API}/v1/orders/${ID_A}`, 200, { total: 1 }),
      jsonEntry("GET", `${API}/v1/orders/${ID_B}`, 200, { total: 2 }),
    ]);
    expect(hints).toEqual([
      {
        origin: "observed",
        producer: { operationMethod: "POST", operationPath: "/v1/orders", field: "id" },
        consumer: { operationMethod: "GET", operationPath: "/v1/orders/{orderId}", field: "orderId", location: "path" },
        matchCount: 2,
        orderObserved: true,
        sampleValue: expect.stringMatching(/^ord_/),
      },
    ]);
  });

  it("counts a single consuming request as one match", async () => {
    const { hints } = await hintsOf([
      jsonEntry("POST", `${API}/v1/orders`, 201, { id: ID_A }, { sku: "A" }),
      jsonEntry("GET", `${API}/v1/orders/${ID_A}/items`, 200, { items: 1 }),
    ]);
    // A literal path segment is not a parameter a consumer can be given, so there is no hint for it.
    expect(hints).toEqual([]);
    const withQuery = await hintsOf([
      jsonEntry("POST", `${API}/v1/orders`, 201, { id: ID_A }, { sku: "A" }),
      jsonEntry("GET", `${API}/v1/items?orderRef=${ID_A}`, 200, {}),
    ]);
    expect(withQuery.hints).toHaveLength(1);
    expect(withQuery.hints[0]).toMatchObject({ matchCount: 1, consumer: { location: "query", field: "orderRef", operationPath: "/v1/items" } });
  });

  it("finds a returned value reused in a JSON request body and in a header", async () => {
    const { hints } = await hintsOf([
      jsonEntry("POST", `${API}/v1/orders`, 201, { id: ID_A, trackingCode: "TRK-998877-ZZ" }, { sku: "A" }),
      jsonEntry("POST", `${API}/v1/shipments`, 201, {}, { orderId: ID_A, meta: { code: "TRK-998877-ZZ" } }),
      jsonEntry("GET", `${API}/v1/track`, 200, {}, undefined, { requestHeaders: { "X-Order-Ref": ID_A } }),
    ]);
    const key = (h: DependencyHint) => `${h.producer.field} -> ${h.consumer.operationPath} ${h.consumer.location}:${h.consumer.field}`;
    expect(hints.map(key).sort()).toEqual([
      "id -> /v1/shipments body:orderId",
      "id -> /v1/track header:x-order-ref",
      "trackingCode -> /v1/shipments body:meta.code",
    ]);
  });

  it("ignores values that are not distinctive: short, boolean, null, small numbers and stoplisted text", async () => {
    const { hints } = await hintsOf([
      jsonEntry("GET", `${API}/v1/config`, 200, { flag: true, n: 42, code: "ab", mime: "application/json", empty: null, small: 999 }),
      jsonEntry("POST", `${API}/v1/use`, 200, {}, { flag: true, n: 42, code: "ab", mime: "application/json", empty: null, small: 999 }),
    ]);
    expect(hints).toEqual([]);
  });

  it("accepts a number of at least four digits and a string of at least eight characters", async () => {
    expect(isDistinctive(1000)).toBe(true);
    expect(isDistinctive(999)).toBe(false);
    expect(isDistinctive(10.5)).toBe(false);
    expect(isDistinctive("12345678")).toBe(true);
    expect(isDistinctive("1234")).toBe(true);
    expect(isDistinctive("123")).toBe(false);
    expect(isDistinctive("abcdefg")).toBe(false);
    expect(isDistinctive(true)).toBe(false);
    expect(isDistinctive(null)).toBe(false);
    const { hints } = await hintsOf([
      jsonEntry("POST", `${API}/v1/accounts`, 201, { accountNo: 482913 }, { name: "x" }),
      jsonEntry("POST", `${API}/v1/transfers`, 201, {}, { from: 482913 }),
    ]);
    expect(hints).toHaveLength(1);
    expect(hints[0].producer.field).toBe("accountNo");
  });

  it("never links a value that two different response fields produced", async () => {
    const { hints } = await hintsOf([
      jsonEntry("POST", `${API}/v1/orders`, 201, { id: ID_A, reference: ID_A }, { sku: "A" }),
      jsonEntry("POST", `${API}/v1/shipments`, 201, {}, { orderId: ID_A }),
    ]);
    expect(hints).toEqual([]);
    const twoOperations = await hintsOf([
      jsonEntry("POST", `${API}/v1/orders`, 201, { id: ID_A }, { sku: "A" }),
      jsonEntry("GET", `${API}/v1/echo`, 200, { id: ID_A }),
      jsonEntry("POST", `${API}/v1/shipments`, 201, {}, { orderId: ID_A }),
    ]);
    expect(twoOperations.hints).toEqual([]);
  });

  it("requires the producer to come first and to be a different operation", async () => {
    const consumerFirst = await hintsOf([
      jsonEntry("POST", `${API}/v1/shipments`, 201, {}, { orderId: ID_A }),
      jsonEntry("POST", `${API}/v1/orders`, 201, { id: ID_A }, { sku: "A" }),
    ]);
    expect(consumerFirst.hints).toEqual([]);
    const sameOperation = await hintsOf([
      jsonEntry("POST", `${API}/v1/orders`, 201, { id: ID_A, parent: "x" }, { sku: "A", ref: ID_A }),
      jsonEntry("POST", `${API}/v1/orders`, 201, { id: ID_B }, { sku: "B", ref: ID_A }),
    ]);
    expect(sameOperation.hints).toEqual([]);
  });

  it("ignores failed responses as producers", async () => {
    const { hints } = await hintsOf([
      jsonEntry("POST", `${API}/v1/orders`, 400, { id: ID_A }, { sku: "A" }),
      jsonEntry("POST", `${API}/v1/shipments`, 201, {}, { orderId: ID_A }),
    ]);
    expect(hints).toEqual([]);
  });

  it("does not walk arrays", async () => {
    const { hints } = await hintsOf([
      jsonEntry("GET", `${API}/v1/orders`, 200, { orders: [{ id: ID_A }] }),
      jsonEntry("POST", `${API}/v1/shipments`, 201, {}, { orderIds: [ID_A] }),
    ]);
    expect(hints).toEqual([]);
  });

  it("links a login token to the Authorization header of later requests, with the value withheld everywhere", async () => {
    const TOKEN = "tk_SEEDED-SECRET-LOGIN-TOKEN-1234567890";
    const { hints, text } = await hintsOf([
      jsonEntry("POST", `${API}/v1/login`, 200, { accessToken: TOKEN }, { user: "ada" }),
      jsonEntry("GET", `${API}/v1/me`, 200, { name: "ada" }, undefined, { requestHeaders: { Authorization: `Bearer ${TOKEN}` } }),
      jsonEntry("GET", `${API}/v1/orders`, 200, {}, undefined, { requestHeaders: { Authorization: `Bearer ${TOKEN}` } }),
    ]);
    expect(hints.map((h) => `${h.producer.field} -> ${h.consumer.operationPath} ${h.consumer.location}:${h.consumer.field} x${h.matchCount}`)).toEqual([
      "accessToken -> /v1/me header:authorization x1",
      "accessToken -> /v1/orders header:authorization x1",
    ]);
    for (const hint of hints) {
      expect(hint.valueWithheld).toBe(true);
      expect(hint.sampleValue).toBeUndefined();
    }
    expect(text).not.toContain("SEEDED-SECRET");
  });

  it("withholds the sample for credential-named fields, credential-shaped values and email addresses", async () => {
    const { hints, text } = await hintsOf([
      jsonEntry("POST", `${API}/v1/signup`, 201, { email: "ada.lovelace@example.test", sessionToken: "SEEDED-SECRET-SESS-99887766" }, { n: 1 }),
      jsonEntry("POST", `${API}/v1/profile`, 200, {}, { contact: "ada.lovelace@example.test", sid: "SEEDED-SECRET-SESS-99887766" }),
    ]);
    expect(hints).toHaveLength(2);
    for (const hint of hints) expect(hint.valueWithheld).toBe(true);
    expect(text).not.toContain("SEEDED-SECRET");
    // The hints never carry the email address (the observed example bodies are ordinary data and may).
    expect(JSON.stringify(hints)).not.toContain("ada.lovelace");
  });

  it("truncates a sample to 32 characters", async () => {
    const long = `ord_${"a1b2c3d4".repeat(8)}`;
    const { hints } = await hintsOf([
      jsonEntry("POST", `${API}/v1/orders`, 201, { id: long }, { sku: "A" }),
      jsonEntry("GET", `${API}/v1/items?ref=${long}`, 200, {}),
    ]);
    expect(hints[0].sampleValue).toHaveLength(32);
    expect(long.startsWith(hints[0].sampleValue as string)).toBe(true);
  });

  it("is deterministic and sorted by producer then consumer", async () => {
    const entries = [
      jsonEntry("POST", `${API}/v1/orders`, 201, { id: ID_A, ref: ID_B }, { sku: "A" }),
      jsonEntry("GET", `${API}/v1/z?x=${ID_A}`, 200, {}),
      jsonEntry("GET", `${API}/v1/a?y=${ID_B}`, 200, {}),
    ];
    const first = await hintsOf(entries);
    const second = await hintsOf(entries);
    expect(JSON.stringify(first.hints)).toBe(JSON.stringify(second.hints));
    // Sorted by producer operation, then producer field ("id" before "ref"), then consumer.
    expect(first.hints.map((h) => h.producer.field)).toEqual(["id", "ref"]);
    expect(first.hints.map((h) => h.consumer.operationPath)).toEqual(["/v1/z", "/v1/a"]);
  });

  it("harvests only distinctive leaves and strips the Bearer scheme from headers", () => {
    const body = harvestBodyValues({ id: "ord_7f3a9c21d4", ok: true, n: 3, nested: { token: "tk_abcdef123456" }, list: ["ord_7f3a9c21d4"] });
    expect(body.map((r) => [r.field, r.withheld])).toEqual([["id", false], ["nested.token", true]]);
    expect(body.every((r) => r.digest.length === 16)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("tk_abcdef123456");
    const headers = harvestHeaderValues({ authorization: "Bearer tk_abcdef123456", "user-agent": "something-long-enough", cookie: "a=bbbbbbbbbbb" }, isNoiseHeader);
    expect(headers.map((r) => r.field)).toEqual(["authorization"]);
    expect(headers[0].withheld).toBe(true);
  });
});
