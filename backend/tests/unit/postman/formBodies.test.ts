import { describe, expect, it } from "vitest";
import type { ApiModel, ApiOperation, FactProvenance, TestModel, TestScenario } from "@apipilot/shared-domain";
import { generateCollection } from "../../../src/postman/generateCollection";
import { buildRequestItem } from "../../../src/postman/requestItem";
import { validateCollection } from "../../../src/postman/validateCollection";

/**
 * specs/056 FR-056, FR-048, contracts/postman-artifact-amendment.md: form-style bodies for observed
 * and declared operations, and redaction placeholders replaced by secret variable references.
 */

const EMPTY = { required: [], properties: {} };

function operation(contentType: string, provenance?: FactProvenance, path = "/v1/import"): ApiOperation {
  return {
    path,
    method: "POST",
    operationId: undefined,
    parameters: [],
    requestBody: { required: false, contentTypes: { [contentType]: EMPTY } },
    responses: [{ statusCode: "200", description: "", contentTypes: {}, examples: {} }],
    security: [],
    tags: [],
    ...(provenance ? { provenance } : {}),
  };
}

function scenario(id: string, body: unknown, overrides: Partial<TestScenario["request"]> = {}, path = "/v1/import"): TestScenario {
  return {
    id,
    operationPath: path,
    operationMethod: "POST",
    category: "positive",
    request: { pathParameters: {}, queryParameters: {}, headers: {}, body, ...overrides },
    assertions: [{ type: "status-code", expectedStatusCode: "200", basis: "observed" }],
    provenance: { source: "RULE", rule: "observed-example-positive", description: "observed", duplicateOfRules: [] },
  };
}

const observed: FactProvenance = { origin: "observed", observationCount: 3, confidence: "high" };

describe("form-style bodies for observed and declared operations (FR-056)", () => {
  it("emits an urlencoded body with the fields in order and sets the content type", () => {
    const { item, limitations } = buildRequestItem({
      scenario: scenario("s1", { source: "csv", dryRun: "true", count: "3" }),
      operation: operation("application/x-www-form-urlencoded", observed),
      requestName: "import",
    });
    expect(item.request.body).toEqual({
      mode: "urlencoded",
      urlencoded: [
        { key: "source", value: "csv" },
        { key: "dryRun", value: "true" },
        { key: "count", value: "3" },
      ],
    });
    expect(item.request.header).toContainEqual({ key: "Content-Type", value: "application/x-www-form-urlencoded" });
    expect(limitations.filter((l) => l.kind === "unsupported-content-type")).toEqual([]);
  });

  it("emits a multipart body of text fields and never sends a captured Content-Type with a stale boundary", () => {
    const { item } = buildRequestItem({
      scenario: scenario("s2", { title: "hello", n: "1" }, { headers: { "content-type": "multipart/form-data; boundary=----captured", accept: "application/json" } }),
      operation: operation("multipart/form-data", observed),
      requestName: "upload",
    });
    expect(item.request.body).toEqual({
      mode: "formdata",
      formdata: [
        { key: "title", value: "hello", type: "text" },
        { key: "n", value: "1", type: "text" },
      ],
    });
    const names = item.request.header.map((header) => header.key.toLowerCase());
    expect(names).not.toContain("content-type");
    expect(names).toContain("accept");
  });

  it("writes numbers, booleans and null as text", () => {
    const { item } = buildRequestItem({
      scenario: scenario("s3", { a: 1, b: true, c: null, d: 2.5 }),
      operation: operation("application/x-www-form-urlencoded", observed),
      requestName: "import",
    });
    expect(item.request.body).toEqual({
      mode: "urlencoded",
      urlencoded: [
        { key: "a", value: "1" },
        { key: "b", value: "true" },
        { key: "c", value: "" },
        { key: "d", value: "2.5" },
      ],
    });
  });

  it("also emits form bodies for a declared (API definition) operation", () => {
    const { item } = buildRequestItem({
      scenario: scenario("s4", { a: "1" }),
      operation: operation("application/x-www-form-urlencoded", { origin: "declared" }),
      requestName: "import",
    });
    expect(item.request.body?.mode).toBe("urlencoded");
  });

  it("keeps the existing limitation, and no body, for a body that is not a flat object", () => {
    for (const body of [{ nested: { a: 1 } }, ["a", "b"], "raw text"]) {
      const { item, limitations } = buildRequestItem({
        scenario: scenario("s5", body),
        operation: operation("application/x-www-form-urlencoded", observed),
        requestName: "import",
      });
      expect(item.request.body).toBeUndefined();
      expect(limitations.map((l) => l.kind)).toContain("unsupported-content-type");
    }
  });

  it("leaves a documented OpenAPI operation exactly as before: the limitation and no body (SC-002)", () => {
    for (const contentType of ["application/x-www-form-urlencoded", "multipart/form-data"]) {
      const { item, limitations } = buildRequestItem({
        scenario: scenario("s6", { a: "1" }),
        operation: operation(contentType),
        requestName: "import",
      });
      expect(item.request.body).toBeUndefined();
      expect(limitations.map((l) => l.kind)).toEqual(["unsupported-content-type"]);
    }
    const explicitlyDocumented = buildRequestItem({
      scenario: scenario("s7", { a: "1" }),
      operation: operation("multipart/form-data", { origin: "documented" }),
      requestName: "import",
    });
    expect(explicitlyDocumented.item.request.body).toBeUndefined();
  });

  it("is deterministic for the same input", () => {
    const build = () =>
      JSON.stringify(
        buildRequestItem({
          scenario: scenario("s8", { source: "csv", dryRun: "true" }),
          operation: operation("application/x-www-form-urlencoded", observed),
          requestName: "import",
        }),
      );
    expect(build()).toBe(build());
  });
});

describe("redaction placeholders become secret variable references (FR-048, research R24)", () => {
  const ordinary = operation("application/json", observed);

  it("replaces a credential-named form field and a placeholder under an ordinary name", () => {
    const { item, variables } = buildRequestItem({
      scenario: scenario("c1", { client_secret: "[redacted:token]", memo: "[redacted:password]", sku: "W-1" }),
      operation: operation("application/x-www-form-urlencoded", observed),
      requestName: "import",
    });
    expect(item.request.body).toEqual({
      mode: "urlencoded",
      urlencoded: [
        { key: "client_secret", value: "{{token}}" },
        { key: "memo", value: "{{password}}" },
        { key: "sku", value: "W-1" },
      ],
    });
    expect(JSON.stringify(item)).not.toContain("[redacted");
    expect(variables.filter((v) => v.secret).map((v) => v.name).sort()).toEqual(["password", "token"]);
    expect(variables.every((v) => v.value === "")).toBe(true);
  });

  it("replaces a placeholder anywhere in a JSON body: object fields, nested fields and array elements", () => {
    const { item } = buildRequestItem({
      scenario: scenario("c2", { note: "[redacted:apiKey]", nested: { code: "[redacted:session]" }, list: ["x", "[redacted:cookie]"] }),
      operation: ordinary,
      requestName: "json",
    });
    expect(JSON.parse((item.request.body as { raw: string }).raw)).toEqual({
      note: "{{apiKey}}",
      nested: { code: "{{token}}" },
      list: ["x", "{{token}}"],
    });
  });

  it("replaces a placeholder in a query value and in a path parameter value", () => {
    const op: ApiOperation = { ...ordinary, path: "/v1/files/{fileId}", parameters: [{ name: "fileId", location: "path", required: true, schema: EMPTY }] };
    const { item, variables } = buildRequestItem({
      scenario: scenario("c3", undefined, { pathParameters: { fileId: "[redacted:token]" }, queryParameters: { api_key: "[redacted:apiKey]", page: "1" } }, "/v1/files/{fileId}"),
      operation: op,
      requestName: "files",
    });
    expect(item.request.url.query).toEqual([{ key: "api_key", value: "{{apiKey}}" }, { key: "page", value: "1" }]);
    expect(item.request.url.variable).toEqual([{ key: "fileId", value: "{{token}}" }]);
    expect(item.request.url.raw).not.toContain("[redacted");
    expect(variables.filter((v) => v.secret).map((v) => v.name).sort()).toEqual(["apiKey", "token"]);
  });

  it("replaces a placeholder in a header whatever the header is called", () => {
    const { item } = buildRequestItem({
      scenario: scenario("c4", undefined, { headers: { "x-csrf-token": "[redacted:token]", "x-note": "[redacted:cookie]", "x-keep": "ok" } }),
      operation: ordinary,
      requestName: "headers",
    });
    expect(item.request.header).toEqual(
      expect.arrayContaining([
        { key: "x-csrf-token", value: "{{token}}" },
        { key: "x-note", value: "{{token}}" },
        { key: "x-keep", value: "ok" },
      ]),
    );
    expect(JSON.stringify(item)).not.toContain("[redacted");
  });

  it("does not touch values that merely look like a placeholder", () => {
    const { item } = buildRequestItem({
      scenario: scenario("c5", { a: "[redacted]", b: "[redacted:other]", c: "see [redacted:token]" }),
      operation: ordinary,
      requestName: "json",
    });
    expect(JSON.parse((item.request.body as { raw: string }).raw)).toEqual({ a: "[redacted]", b: "[redacted:other]", c: "see [redacted:token]" });
  });
});

describe("generation and validation with form bodies and placeholders", () => {
  function model(operations: ApiOperation[]): ApiModel {
    return { operations, securitySchemes: {}, summary: { operationCount: operations.length, schemaCount: 0, securitySchemeCount: 0, issues: [] } };
  }
  const testModel = (scenarios: TestScenario[]): TestModel => ({ scenarios });

  it("generates a valid collection with both form modes and no placeholder text", () => {
    const outcome = generateCollection(
      model([operation("application/x-www-form-urlencoded", observed, "/v1/a"), operation("multipart/form-data", observed, "/v1/b")]),
      testModel([scenario("g1", { source: "csv", client_secret: "[redacted:token]" }, {}, "/v1/a"), scenario("g2", { title: "t" }, {}, "/v1/b")]),
      { baseUrl: "https://qa.example.test" },
    );
    if (!outcome.ok) throw new Error(outcome.failure.message);
    expect(outcome.result.validation).toEqual({ valid: true, problems: [] });
    const text = JSON.stringify(outcome.result);
    expect(text).not.toContain("[redacted");
    const modes = outcome.result.collection.item.flatMap((folder) => folder.item.map((i) => i.request.body?.mode));
    expect(modes.sort()).toEqual(["formdata", "urlencoded"]);
    expect(outcome.result.environment.values.some((v) => v.key === "token" && v.type === "secret")).toBe(true);
  });

  function validCollection() {
    const outcome = generateCollection(model([operation("application/json", observed)]), testModel([scenario("v1", { a: 1 })]), { baseUrl: "https://qa.example.test" });
    if (!outcome.ok) throw new Error(outcome.failure.message);
    return outcome.result;
  }

  it("refuses an artifact that would send a placeholder: in a URL, a header or any body mode", () => {
    const result = validCollection();
    const declared = result.environment.values.map((value) => ({ name: value.key, purpose: "", secret: false, value: "" }));
    const tamper = (change: (item: { request: { header: { key: string; value: string }[]; body?: unknown; url: { raw: string } } }) => void) => {
      const copy = structuredClone(result.collection);
      change(copy.item[0].item[0] as never);
      return validateCollection(copy, declared);
    };
    expect(tamper((item) => item.request.header.push({ key: "x-a", value: "[redacted:token]" })).problems.join("\n")).toContain("redaction placeholder that was not replaced");
    expect(tamper((item) => { item.request.body = { mode: "raw", raw: '{"a":"[redacted:token]"}', options: { raw: { language: "json" } } }; }).valid).toBe(false);
    expect(tamper((item) => { item.request.body = { mode: "urlencoded", urlencoded: [{ key: "a", value: "[redacted:token]" }] }; }).valid).toBe(false);
    expect(tamper((item) => { item.request.body = { mode: "formdata", formdata: [{ key: "a", value: "[redacted:token]", type: "text" }] }; }).valid).toBe(false);
  });

  it("flags a credential literal in a form field and accepts a variable reference", () => {
    const result = validCollection();
    const declared = result.environment.values.map((value) => ({ name: value.key, purpose: "", secret: false, value: "" }));
    const withBody = (value: string) => {
      const copy = structuredClone(result.collection);
      (copy.item[0].item[0] as { request: { body?: unknown } }).request.body = { mode: "urlencoded", urlencoded: [{ key: "password", value }] };
      return validateCollection(copy, [...declared, { name: "password", purpose: "", secret: true, value: "" }]);
    };
    expect(withBody("hunter2").problems.join("\n")).toContain("carries a credential value that is not a variable reference");
    expect(withBody("{{password}}").valid).toBe(true);
  });

  it("still accepts every raw body and still rejects an unknown body mode", () => {
    const result = validCollection();
    expect(result.validation.valid).toBe(true);
    const copy = structuredClone(result.collection);
    (copy.item[0].item[0] as { request: { body?: unknown } }).request.body = { mode: "graphql" };
    const declared = result.environment.values.map((value) => ({ name: value.key, purpose: "", secret: false, value: "" }));
    expect(validateCollection(copy, declared).problems.join("\n")).toContain('supports only "raw", "urlencoded" and "formdata"');
  });
});
