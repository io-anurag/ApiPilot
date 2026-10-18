import { describe, expect, it } from "vitest";
import type { ApiOperation, ObservedOperationDetails, ObservedRequestExample, SchemaEvidence } from "@apipilot/shared-domain";
import { buildHarModel } from "../../../src/apiInput/har/buildHarModel";
import { DEFAULT_INPUT_LIMITS } from "../../../src/apiInput/limits";
import { observedExampleScenarios } from "../../../src/testDesign/rules/observedExampleScenarios";
import { harEntry, harOf, jsonEntry } from "../../fixtures/apiInput/harBuilders";

const API = "https://api.shop.test";

async function operationFrom(entries: Record<string, unknown>[], method: string, path: string): Promise<ApiOperation> {
  const model = await buildHarModel(harOf(entries), DEFAULT_INPUT_LIMITS);
  const found = model.operations.find((operation) => operation.method === method && operation.path === path);
  if (!found) throw new Error(`no operation ${method} ${path}`);
  return found;
}

const createOrder = (body: unknown, status = 201) => jsonEntry("POST", `${API}/v1/orders`, status, { id: "x1" }, body);
const THREE_ORDERS = [
  createOrder({ sku: "W-1", quantity: 2, note: "gift" }),
  createOrder({ sku: "W-2", quantity: 1, note: "none" }),
  createOrder({ sku: "W-3", quantity: 5, note: "rush" }),
];

const kinds = (scenarios: { category: string }[]) => scenarios.map((s) => s.category);

describe("observedExampleScenarios: positive scenarios (FR-035)", () => {
  it("replays the most-observed example per observed 2xx status and asserts only that status, as observed", async () => {
    const op = await operationFrom(
      [
        jsonEntry("GET", `${API}/v1/stats`, 200, { n: 1 }),
        jsonEntry("GET", `${API}/v1/stats`, 200, { n: 1 }),
        jsonEntry("GET", `${API}/v1/stats?page=2`, 200, { n: 2 }),
        jsonEntry("GET", `${API}/v1/stats`, 404, { error: "x" }),
      ],
      "GET",
      "/v1/stats",
    );
    const { scenarios, notes } = observedExampleScenarios(op);
    expect(notes).toEqual([]);
    expect(scenarios).toHaveLength(1);
    const [positive] = scenarios;
    expect(positive).toMatchObject({
      category: "positive",
      operationMethod: "GET",
      operationPath: "/v1/stats",
      provenance: { source: "RULE", rule: "observed-example-positive" },
      assertions: [{ type: "status-code", expectedStatusCode: "200", basis: "observed" }],
      evidence: { origin: "observed", observationCount: 2, derivation: "observed-example" },
    });
    expect(positive.evidence?.summary).toBe("Observed 2 times in the capture, returned 200.");
    expect(positive.request.queryParameters).toEqual({});
    // No assertion on the 404 that was observed, nor on any schema, header or body.
    expect(positive.assertions.every((assertion) => assertion.type === "status-code" && assertion.expectedSchema === undefined)).toBe(true);
  });

  it("produces one positive per distinct observed success status, in ascending order", async () => {
    const op = await operationFrom(
      [jsonEntry("POST", `${API}/v1/jobs`, 202, {}, { a: 1 }), jsonEntry("POST", `${API}/v1/jobs`, 201, {}, { a: 2 }), jsonEntry("POST", `${API}/v1/jobs`, 400, {}, { a: 3 })],
      "POST",
      "/v1/jobs",
    );
    const { scenarios } = observedExampleScenarios(op);
    expect(scenarios.filter((s) => s.category === "positive").map((s) => s.assertions[0].expectedStatusCode)).toEqual(["201", "202"]);
  });

  it("uses an observed request exactly: path parameter, query, headers and body", async () => {
    const op = await operationFrom(
      [
        jsonEntry("GET", `${API}/v1/orders/ord_a1b2c3d4e5f6?expand=items`, 200, {}, undefined, { requestHeaders: { "X-Tenant": "t1" } }),
        jsonEntry("GET", `${API}/v1/orders/ord_b2c3d4e5f6a1`, 200, {}),
      ],
      "GET",
      "/v1/orders/{orderId}",
    );
    const { scenarios } = observedExampleScenarios(op);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].request).toEqual({
      pathParameters: { orderId: "ord_a1b2c3d4e5f6" },
      queryParameters: { expand: "items" },
      headers: { "x-tenant": "t1" },
    });
  });

  it("skips an example whose request body could not be read and uses the next candidate", async () => {
    const gz = Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0]).toString("base64");
    const unreadable = harEntry({
      method: "POST",
      url: `${API}/v1/orders`,
      status: 201,
      requestBody: { mimeType: "application/json", text: gz },
      requestHeaders: { "Content-Encoding": "gzip" },
      responseText: "{}",
    });
    const op = await operationFrom([unreadable, unreadable, createOrder({ sku: "W-1" })], "POST", "/v1/orders");
    const { scenarios } = observedExampleScenarios(op);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].request.body).toEqual({ sku: "W-1" });
  });

  it("emits no boundary, enum, format, null or empty scenarios, whatever it saw", async () => {
    const op = await operationFrom(
      [...THREE_ORDERS, createOrder({ sku: "W-1", quantity: 2, note: "gift", email: "a@b.test", code: "ABC" })],
      "POST",
      "/v1/orders",
    );
    const { scenarios } = observedExampleScenarios(op);
    expect(new Set(kinds(scenarios))).toEqual(new Set(["positive", "missing-field", "invalid-type"]));
  });
});

describe("observedExampleScenarios: evidence-gated negatives (FR-036)", () => {
  it("generates a missing-field and an invalid-type scenario per field seen in at least three consistent bodies", async () => {
    const op = await operationFrom(THREE_ORDERS, "POST", "/v1/orders");
    const { scenarios } = observedExampleScenarios(op);
    expect(kinds(scenarios).filter((c) => c === "positive")).toHaveLength(1);
    const missing = scenarios.filter((s) => s.category === "missing-field");
    const typed = scenarios.filter((s) => s.category === "invalid-type");
    expect(missing.map((s) => s.targetField)).toEqual(["note", "quantity", "sku"]);
    expect(typed.map((s) => s.targetField)).toEqual(["note", "quantity", "sku"]);
    for (const scenario of missing) {
      expect(scenario.provenance).toMatchObject({ source: "RULE", rule: "observed-field-omitted" });
      expect(scenario.evidence).toMatchObject({ origin: "inferred", derivation: "inference-derived", observationCount: 3 });
      expect(scenario.evidence?.summary).toMatch(/was present in 3 of 3 observed request bodies/);
      expect(scenario.assertions).toEqual([]);
      expect(scenario.provenance.description).toContain("expected outcome is not asserted");
      expect(scenario.targetLocation).toBe("body");
    }
    const withoutSku = missing.find((s) => s.targetField === "sku")!;
    expect(withoutSku.request.body).toEqual({ quantity: 2, note: "gift" });
    const wrongType = typed.find((s) => s.targetField === "quantity")!;
    expect(wrongType.provenance).toMatchObject({ rule: "observed-field-type-violated" });
    expect(typeof (wrongType.request.body as { quantity: unknown }).quantity).not.toBe("number");
    expect((wrongType.request.body as { sku: unknown }).sku).toBe("W-1");
  });

  it("generates no negative scenario below the evidence threshold", async () => {
    const op = await operationFrom(THREE_ORDERS.slice(0, 2), "POST", "/v1/orders");
    expect(kinds(observedExampleScenarios(op).scenarios)).toEqual(["positive"]);
    const one = await operationFrom(THREE_ORDERS.slice(0, 1), "POST", "/v1/orders");
    expect(kinds(observedExampleScenarios(one).scenarios)).toEqual(["positive"]);
  });

  it("does not treat a field that was not in every body as always present, and skips conflicting types", async () => {
    const op = await operationFrom(
      [
        createOrder({ sku: "W-1", quantity: 2, note: "a" }),
        createOrder({ sku: "W-2", quantity: "two" }),
        createOrder({ sku: "W-3", quantity: 5, note: "c" }),
        createOrder({ sku: "W-4", quantity: 1 }),
      ],
      "POST",
      "/v1/orders",
    );
    const { scenarios } = observedExampleScenarios(op);
    const targets = scenarios.filter((s) => s.category !== "positive").map((s) => `${s.category}:${s.targetField}`);
    expect(targets).toContain("missing-field:sku");
    expect(targets).toContain("invalid-type:sku");
    // quantity: present in every body, but with two types: omission is supported, a type change is not.
    expect(targets).toContain("missing-field:quantity");
    expect(targets).not.toContain("invalid-type:quantity");
    // note: present in 2 of 4 bodies, so neither negative.
    expect(targets.filter((t) => t.endsWith(":note"))).toEqual([]);
  });

  it("applies the threshold to form bodies for omission, and never type-mutates a form field", async () => {
    const form = (n: number) =>
      harEntry({ method: "POST", url: `${API}/v1/orders/import`, status: 200, requestBody: { mimeType: "application/x-www-form-urlencoded", params: [{ name: "source", value: `s${n}` }, { name: "dryRun", value: "true" }] }, responseText: "{}" });
    const op = await operationFrom([form(1), form(2), form(3)], "POST", "/v1/orders/import");
    const { scenarios } = observedExampleScenarios(op);
    expect(kinds(scenarios)).toEqual(["positive", "missing-field", "missing-field"]);
    expect(scenarios[0].request.body).toEqual({ source: "s1", dryRun: "true" });
    expect(scenarios.filter((s) => s.category === "invalid-type")).toEqual([]);
    const two = await operationFrom([form(1), form(2)], "POST", "/v1/orders/import");
    expect(kinds(observedExampleScenarios(two).scenarios)).toEqual(["positive"]);
  });

  it("ignores the evidence of array elements, which counts elements and not bodies", async () => {
    const op = await operationFrom(
      [1, 2, 3].map((n) => jsonEntry("POST", `${API}/v1/batch`, 200, {}, { items: [{ id: n }, { id: n + 10 }] })),
      "POST",
      "/v1/batch",
    );
    const targets = observedExampleScenarios(op).scenarios.filter((s) => s.category !== "positive").map((s) => s.targetField);
    expect(targets.some((field) => field?.includes("[]"))).toBe(false);
    expect(targets).toContain("items");
  });

  /** Hand-built evidence, so the failing example can be exactly the mutated request. */
  function handBuilt(examples: ObservedRequestExample[]): ApiOperation {
    const evidence: SchemaEvidence = { observations: 3, fields: { sku: { presentIn: 3, types: { string: 3 } }, qty: { presentIn: 3, types: { integer: 3 } } } };
    const details: ObservedOperationDetails = {
      key: "k", origin: API, observationCount: 6, statusCounts: { "201": 3, "400": 1 }, pathParameters: [], queryParameterCounts: {}, headerCounts: {},
      requestExamples: examples, droppedExampleCount: 0, requestBodyEvidence: { "application/json": evidence }, responseBodyEvidence: {}, unavailableBodies: [], credentialsObserved: [],
    };
    return {
      path: "/v1/orders", method: "POST", operationId: undefined, parameters: [],
      requestBody: { required: false, requiredUnknown: true, contentTypes: { "application/json": { required: [], properties: {} } } },
      responses: [], security: [], tags: [], provenance: { origin: "observed", observationCount: 6 }, observed: details,
    };
  }
  const example = (body: unknown, status: string, observations: number, firstEntryIndex: number): ObservedRequestExample => ({
    pathParameters: {}, queryParameters: {}, headers: {}, body, contentType: "application/json", responseStatus: status, observations, firstEntryIndex,
  });

  it("asserts an observed failure status only when that failure's request is exactly the mutated request", () => {
    const op = handBuilt([example({ sku: "A", qty: 1 }, "201", 3, 0), example({ qty: 1 }, "400", 1, 5)]);
    const missing = observedExampleScenarios(op).scenarios.filter((s) => s.category === "missing-field");
    const withoutSku = missing.find((s) => s.targetField === "sku")!;
    expect(withoutSku.assertions).toEqual([{ type: "status-code", expectedStatusCode: "400", basis: "observed" }]);
    const withoutQty = missing.find((s) => s.targetField === "qty")!;
    expect(withoutQty.assertions).toEqual([]);
  });

  it("does not match a failure whose request merely resembles the mutated one", () => {
    const op = handBuilt([example({ sku: "A", qty: 1 }, "201", 3, 0), example({ qty: 2 }, "400", 1, 5)]);
    const withoutSku = observedExampleScenarios(op).scenarios.find((s) => s.targetField === "sku" && s.category === "missing-field")!;
    expect(withoutSku.assertions).toEqual([]);
  });
});

describe("observedExampleScenarios: operations that yield nothing keep their reason (FR-040)", () => {
  it("says no successful response was observed", async () => {
    const op = await operationFrom([jsonEntry("GET", `${API}/v1/secret`, 403, { error: "no" }), jsonEntry("GET", `${API}/v1/secret`, 404, {})], "GET", "/v1/secret");
    const { scenarios, notes } = observedExampleScenarios(op);
    expect(scenarios).toEqual([]);
    expect(notes).toEqual([{ operationMethod: "GET", operationPath: "/v1/secret", reason: "No successful (2xx) response was observed, so no positive scenario can be justified." }]);
  });

  it("says a multipart request with a file part cannot be reproduced", async () => {
    const upload = harEntry({
      method: "POST",
      url: `${API}/v1/files`,
      requestBody: { mimeType: "multipart/form-data; boundary=x", params: [{ name: "caption", value: "c" }, { name: "f", fileName: "a.png", contentType: "image/png" }] },
      responseText: "{}",
    });
    const op = await operationFrom([upload, upload], "POST", "/v1/files");
    const { scenarios, notes } = observedExampleScenarios(op);
    expect(scenarios).toEqual([]);
    expect(notes[0].reason).toBe("Every observed request with a body had a multipart file part, which cannot be reproduced.");
  });

  it("names another unavailable request body", () => {
    const op = handBuilt2("compressed");
    expect(observedExampleScenarios(op).notes[0].reason).toBe("The observed request examples had an unavailable body (compressed).");
  });

  it("says when no success example uses the operation's primary content type", () => {
    const op = handBuilt2(undefined);
    expect(observedExampleScenarios(op).notes[0].reason).toBe("No observed 2xx example uses the operation's primary request content type (application/json).");
  });

  function handBuilt2(unavailable: "compressed" | undefined): ApiOperation {
    const ex: ObservedRequestExample = {
      pathParameters: {}, queryParameters: {}, headers: {},
      ...(unavailable ? { bodyUnavailable: unavailable } : { body: "a=1", contentType: "application/x-www-form-urlencoded" }),
      responseStatus: "200", observations: 1, firstEntryIndex: 0,
    };
    return {
      path: "/v1/x", method: "POST", operationId: undefined, parameters: [],
      requestBody: { required: false, contentTypes: { "application/json": { required: [], properties: {} } } },
      responses: [], security: [], tags: [], provenance: { origin: "observed", observationCount: 1 },
      observed: {
        key: "k", origin: API, observationCount: 1, statusCounts: { "200": 1 }, pathParameters: [], queryParameterCounts: {}, headerCounts: {},
        requestExamples: [ex], droppedExampleCount: 0, requestBodyEvidence: {}, responseBodyEvidence: {}, unavailableBodies: [], credentialsObserved: [],
      },
    };
  }

  it("returns nothing for an operation that is not observed", () => {
    expect(observedExampleScenarios({ path: "/x", method: "GET", operationId: undefined, parameters: [], requestBody: undefined, responses: [], security: [], tags: [] })).toEqual({ scenarios: [], notes: [] });
  });
});

describe("observedExampleScenarios: determinism", () => {
  it("gives the same scenarios, apart from random ids, every time", async () => {
    const op = await operationFrom(THREE_ORDERS, "POST", "/v1/orders");
    const run = () => JSON.stringify(observedExampleScenarios(op).scenarios.map(({ id: _id, ...rest }) => rest));
    expect(run()).toBe(run());
  });
});
