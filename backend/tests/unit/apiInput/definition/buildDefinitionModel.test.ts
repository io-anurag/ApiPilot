import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ApiModel } from "@apipilot/shared-domain";
import { loadDefinition } from "../../../../src/apiInput/definition/loadDefinition";

/** specs/056 FR-023, FR-025, FR-026, data-model.md "Definition-format mapping". */

const FIXTURES = path.resolve(__dirname, "../../../fixtures/apiInput/definitions");

function load(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf-8")) as Record<string, unknown>;
}

function modelOf(name: string): ApiModel {
  return loadDefinition(load(name));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the helper edits deliberately invalid JSON documents, whose shape is the point of the test
function mutated(change: (document: any) => void): ApiModel {
  const document = JSON.parse(JSON.stringify(load("valid.json")));
  change(document);
  return loadDefinition(document);
}

describe("the mapping of a full definition", () => {
  const model = modelOf("valid.json");
  const [createOrder, getOrder] = model.operations;

  it("maps info and the declared base URL, and counts what it holds", () => {
    expect(model.info).toEqual({ title: "Orders API", version: "1.0.0" });
    expect(model.declaredBaseUrl).toBe("https://api.example.test");
    expect(model.summary).toMatchObject({ operationCount: 2, securitySchemeCount: 1, issues: [] });
    expect(model.summary.schemaCount).toBeGreaterThan(0);
    expect(model.importReport).toBeUndefined();
  });

  it("marks every operation declared and carries id, description and tags", () => {
    expect(createOrder).toMatchObject({
      method: "POST",
      path: "/orders",
      operationId: "createOrder",
      description: "Create an order.",
      tags: ["orders"],
      provenance: { origin: "declared" },
    });
    expect(createOrder.provenance?.observationCount).toBeUndefined();
    expect(getOrder.operationId).toBe("getOrder");
    expect(getOrder.tags).toEqual([]);
    expect(getOrder.description).toBeUndefined();
  });

  it("maps the request body, its schema and its examples", () => {
    expect(createOrder.requestBody).toMatchObject({ required: true, provenance: { origin: "declared" } });
    expect(createOrder.requestBody?.requiredUnknown).toBeUndefined();
    const schema = createOrder.requestBody?.contentTypes["application/json"];
    expect(schema).toMatchObject({
      type: "object",
      required: ["sku", "quantity"],
      properties: {
        sku: { type: "string", minLength: 3 },
        quantity: { type: "integer", minimum: 1, maximum: 100 },
      },
    });
    expect(createOrder.requestBody?.examples).toEqual({ "two widgets": { sku: "WID-001", quantity: 2 } });
  });

  it("maps responses as declared, with statuses as strings and no response invented", () => {
    expect(createOrder.responses.map((r) => r.statusCode)).toEqual(["201", "400"]);
    expect(createOrder.responses[0]).toMatchObject({
      description: "Order created.",
      provenance: { origin: "declared" },
      examples: { example1: { id: "ord_1001" } },
    });
    expect(createOrder.responses[0].contentTypes["application/json"]).toMatchObject({ type: "object", required: ["id"] });
    expect(createOrder.responses[1]).toMatchObject({ statusCode: "400", description: "Invalid order.", contentTypes: {}, examples: {} });
    expect(getOrder.responses.map((r) => r.statusCode)).toEqual(["200"]);
  });

  it("maps parameters: a path parameter is required, others carry requiredUnknown when requiredness is absent", () => {
    const [orderId, expand] = getOrder.parameters;
    expect(orderId).toMatchObject({ name: "orderId", location: "path", required: true, example: "ord_1001", provenance: { origin: "declared" } });
    expect(orderId.requiredUnknown).toBeUndefined();
    expect(expand).toMatchObject({ name: "expand", location: "query", required: false, requiredUnknown: true });
    expect(expand.schema).toMatchObject({ type: "string", enum: ["items"] });
    expect(expand.example).toBeUndefined();
  });

  it("keeps a declared required value as a fact, true or false", () => {
    const explicit = mutated((d) => {
      d.operations[1].parameters[1].required = false;
      d.operations[0].requestBody.required = false;
    });
    expect(explicit.operations[1].parameters[1].requiredUnknown).toBeUndefined();
    expect(explicit.operations[1].parameters[1].required).toBe(false);
    expect(explicit.operations[0].requestBody?.required).toBe(false);
    expect(explicit.operations[0].requestBody?.requiredUnknown).toBeUndefined();
  });

  it("maps authentication to the existing scheme shapes and operation security to alternatives", () => {
    expect(model.securitySchemes).toEqual({ bearerAuth: { type: "http", scheme: "bearer" } });
    expect(createOrder.security).toEqual([{ schemes: [{ name: "bearerAuth", scopes: [] }] }]);
  });

  it("maps every authentication type", () => {
    const mapped = mutated((d) => {
      d.authentication = [
        { name: "basic", type: "http-basic" },
        { name: "key", type: "api-key", in: "header", parameterName: "X-Api-Key" },
        { name: "oauth", type: "oauth2-client-credentials", tokenUrl: "https://auth.example.test/token", scopes: ["read", "write"] },
      ];
      d.operations[0].security = ["basic", "key"];
      d.operations[1].security = ["oauth"];
    });
    expect(mapped.securitySchemes).toEqual({
      basic: { type: "http", scheme: "basic" },
      key: { type: "apiKey", in: "header", name: "X-Api-Key" },
      oauth: { type: "oauth2", flows: { clientCredentials: { tokenUrl: "https://auth.example.test/token", scopes: ["read", "write"] } } },
    });
    expect(mapped.operations[0].security).toEqual([
      { schemes: [{ name: "basic", scopes: [] }] },
      { schemes: [{ name: "key", scopes: [] }] },
    ]);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(modelOf("valid.json"))).toBe(JSON.stringify(modelOf("valid.json")));
  });
});

describe("whatever is not written stays unknown", () => {
  const model = modelOf("minimal.json");

  it("has no info version, base URL, hints or security, and no invented schema", () => {
    expect(model.info).toEqual({ title: "Minimal API", version: "" });
    expect(model.declaredBaseUrl).toBeUndefined();
    expect(model.dependencyHints).toBeUndefined();
    expect(model.securitySchemes).toEqual({});
    const [status, jobs] = model.operations;
    expect(status).toMatchObject({ method: "GET", path: "/status", parameters: [], requestBody: undefined, responses: [], security: [], tags: [] });
    expect(status.operationId).toBeUndefined();
    expect(jobs.parameters[0]).toMatchObject({ name: "dryRun", required: false, requiredUnknown: true, schema: { required: [], properties: {} } });
    expect(jobs.parameters[0].schema.type).toBeUndefined();
  });

  it("documents no response status that was not declared", () => {
    for (const operation of model.operations) expect(operation.responses).toEqual([]);
  });
});

describe("dependency hints", () => {
  it("verifies a hint whose fields exist in the declared schemas", () => {
    expect(modelOf("valid.json").dependencyHints).toEqual([
      {
        origin: "declared",
        producer: { operationMethod: "POST", operationPath: "/orders", field: "id" },
        consumer: { operationMethod: "GET", operationPath: "/orders/{orderId}", field: "orderId", location: "path" },
        verified: true,
      },
    ]);
  });

  it("leaves a hint unverified when the producer field is not in a declared success schema", () => {
    const model = mutated((d) => { d.dependencyHints[0].producer.field = "orderNumber"; });
    expect(model.dependencyHints?.[0].verified).toBe(false);
  });

  it("leaves a hint unverified when the producer declares no schema", () => {
    const model = mutated((d) => { delete d.operations[0].responses[0].schema; delete d.operations[0].responses[0].contentType; delete d.operations[0].responses[0].examples; });
    expect(model.dependencyHints?.[0].verified).toBe(false);
  });

  it("leaves a hint unverified when the consumer parameter declares no schema", () => {
    const model = mutated((d) => { delete d.operations[1].parameters[0].schema; });
    expect(model.dependencyHints?.[0].verified).toBe(false);
  });

  it("verifies nested producer fields and a body consumer", () => {
    const model = mutated((d) => {
      d.operations[0].responses[0].schema = { type: "object", properties: { data: { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { ref: { type: "string" } } } } } } } };
      d.operations[1].method = "POST";
      d.operations[1].requestBody = { contentType: "application/json", schema: { type: "object", properties: { ref: { type: "string" } } } };
      d.dependencyHints = [{ producer: { operation: "createOrder", field: "data.items[].ref" }, consumer: { operation: "getOrder", location: "body", field: "ref" } }];
    });
    expect(model.dependencyHints?.[0].verified).toBe(true);
  });

  it("resolves hints named METHOD /path", () => {
    const model = mutated((d) => { d.dependencyHints[0].producer.operation = "POST /orders"; d.dependencyHints[0].consumer.operation = "GET /orders/{orderId}"; });
    expect(model.dependencyHints?.[0]).toMatchObject({ producer: { operationPath: "/orders" }, consumer: { operationPath: "/orders/{orderId}" } });
  });
});

describe("credentials in examples never enter the model", () => {
  const model = modelOf("credential-example.json");

  it("replaces them with placeholders and keeps the structure", () => {
    const getOrder = model.operations[1];
    const authorization = getOrder.parameters.find((parameter) => parameter.name === "Authorization");
    expect(authorization?.example).toBe("[redacted:token]");
    expect(model.operations[0].requestBody?.examples?.["with password"]).toEqual({ sku: "WID-002", quantity: 1, password: "[redacted:password]" });
  });

  it("reports which kinds were found, where, and never a value", () => {
    const issues = model.summary.issues.filter((issue) => issue.kind === "credential-detected");
    expect(issues.map((issue) => issue.location)).toEqual(["POST /orders", "GET /orders/{orderId}"]);
    expect(issues[0].message).toContain("password in body");
    expect(issues[1].message).toContain("token in header");
    for (const issue of issues) expect(issue.message).not.toContain("SEEDED-SECRET");
  });

  it("leaves no marker anywhere in the model", () => {
    expect(JSON.stringify(model)).not.toContain("SEEDED-SECRET");
  });
});

describe("keys that are attacker-chosen names", () => {
  it("keeps a __proto__ example name and property name as ordinary keys, without touching any prototype", () => {
    const model = mutated((d) => {
      d.operations[0].requestBody.examples = [{ name: "__proto__", value: { polluted: true } }];
      d.operations[0].requestBody.schema.properties.constructor = { type: "string" };
    });
    expect(Object.keys(model.operations[0].requestBody?.examples ?? {})).toEqual(["__proto__"]);
    expect(Object.keys(model.operations[0].requestBody?.contentTypes["application/json"].properties ?? {})).toContain("constructor");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("names unnamed and duplicate example names deterministically", () => {
    const model = mutated((d) => {
      d.operations[0].requestBody.examples = [{ value: { a: 1 } }, { name: "x", value: { a: 2 } }, { name: "x", value: { a: 3 } }];
    });
    expect(model.operations[0].requestBody?.examples).toEqual({ example1: { a: 1 }, x: { a: 2 }, "x-2": { a: 3 } });
  });
});
