import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { InvalidDefinitionError } from "../../../../src/apiInput/errors";
import { API_DEFINITION_SCHEMA_V1 } from "../../../../src/apiInput/definition/definitionSchema";
import { validateDefinition } from "../../../../src/apiInput/definition/validateDefinition";

/**
 * specs/056 FR-023, FR-024, contracts/api-definition-format-v1.md: strict validation reporting every
 * violation at once as "<JSON Pointer>: <message>", with unknown fields rejected.
 */

const FIXTURES = path.resolve(__dirname, "../../../fixtures/apiInput/definitions");
const SCHEMA_FILE = path.resolve(__dirname, "../../../../../specs/056-har-json-input-support/contracts/api-definition.v1.schema.json");

function load(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf-8")) as Record<string, unknown>;
}

function problemsOf(document: Record<string, unknown>): string[] {
  try {
    validateDefinition(document);
  } catch (error) {
    if (error instanceof InvalidDefinitionError) return [...error.problems];
    throw error;
  }
  return [];
}

/** A copy of the valid example with `change` applied. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the helper edits deliberately invalid JSON documents, whose shape is the point of the test
function mutated(change: (document: any) => void): Record<string, unknown> {
  const document = JSON.parse(JSON.stringify(load("valid.json")));
  change(document);
  return document;
}

describe("the schema file and the schema constant", () => {
  it("are deeply equal, so the code cannot drift from the contract", () => {
    expect(API_DEFINITION_SCHEMA_V1).toEqual(JSON.parse(readFileSync(SCHEMA_FILE, "utf-8")));
  });

  it("compiles under Ajv strict mode", () => {
    expect(() => new Ajv({ allErrors: true, strict: true }).compile(JSON.parse(readFileSync(SCHEMA_FILE, "utf-8")))).not.toThrow();
  });
});

describe("valid definitions", () => {
  it.each(["valid.json", "minimal.json", "credential-example.json"])("%s passes", (name) => {
    expect(problemsOf(load(name))).toEqual([]);
  });

  it("returns the document itself, typed", () => {
    const document = load("valid.json");
    expect(validateDefinition(document).info.title).toBe("Orders API");
  });
});

describe("one invalid fixture per violation class (the contract's table)", () => {
  it.each([
    ["version", ["/version: must be 1 (the only supported version)"]],
    ["unknown-field", ["/operations/1/descripton: unknown field 'descripton'; check the spelling or remove it"]],
    ["missing-path", ["/operations/0/path: is required"]],
    ["bad-method", ["/operations/1/method: must be one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, TRACE"]],
    ["bad-path", ["/operations/1/path: must start with '/' and contain no query, fragment or whitespace"]],
    ["bad-status", ["/operations/0/responses/1/status: must be an integer from 100 to 599"]],
    ["duplicate-operation", ["/operations/2: duplicates operation 1 (GET /orders/{orderId})"]],
    ["duplicate-id", ["/operations/2/id: 'getOrder' is already used by operation 1"]],
    [
      "path-parameter-not-in-path",
      [
        "/operations/1/parameters/0: path parameter 'orderNumber' does not appear in the path",
        "/operations/1/path: path parameter 'orderId' is in the path but is not declared in parameters",
      ],
    ],
    ["path-parameter-optional", ["/operations/1/parameters/0/required: path parameters are always required"]],
    [
      "invalid-schema",
      [
        "/operations/0/requestBody/schema/foo: unknown field 'foo'; check the spelling or remove it",
        "/operations/0/requestBody/schema/properties/sku/type: must be one of string, number, integer, boolean, object, array, null",
      ],
    ],
    ["undefined-security", ["/operations/0/security/0: 'basicAuth' is not declared in authentication"]],
    ["bad-base-url", ["/baseUrl: must be an absolute http or https URL without credentials, query or fragment"]],
    ["hint-unknown-operation", ["/dependencyHints/0/consumer/operation: no operation with id or key 'getOrdr'"]],
    ["hint-not-a-path-parameter", ["/dependencyHints/0/consumer/field: 'orderNumber' is not a path parameter of GET /orders/{orderId}"]],
    ["embedded-ref", ["/operations/0/requestBody/schema/properties/sku/$ref: unknown field '$ref'; check the spelling or remove it"]],
  ])("%s", (name, expected) => {
    expect(problemsOf(load(`invalid/${name}.json`))).toEqual(expected);
  });

  it("reports every problem of a document with several, in one response and a stable order", () => {
    const problems = problemsOf(load("invalid/many-problems.json"));
    expect(problems).toEqual([
      "/baseUrl: must be an absolute http or https URL without credentials, query or fragment",
      "/dependencyHints/0/producer/operation: no operation with id or key 'nothing'",
      "/operations/0/method: must be one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, TRACE",
      "/operations/0/responses/0/status: must be an integer from 100 to 599",
      "/operations/1/path: must start with '/' and contain no query, fragment or whitespace",
      "/version: must be 1 (the only supported version)",
    ]);
    expect(problemsOf(load("invalid/many-problems.json"))).toEqual(problems);
  });
});

describe("what the schema rejects", () => {
  it("collapses the alternatives inside oneOf to one message per location", () => {
    for (const status of [99, 600, "20", "abc", 2.5, true]) {
      expect(problemsOf(mutated((d) => { d.operations[0].responses[1].status = status; }))).toEqual([
        "/operations/0/responses/1/status: must be an integer from 100 to 599",
      ]);
    }
    expect(problemsOf(mutated((d) => { d.operations[0].responses[1].status = "404"; }))).toEqual([]);
    expect(problemsOf(mutated((d) => { d.operations[0].responses[1].status = 404; }))).toEqual([]);
  });

  it("rejects $ref, $schema, $id, allOf, oneOf and anyOf inside an embedded schema as unknown fields", () => {
    for (const key of ["$ref", "$schema", "$id", "allOf", "oneOf", "anyOf"]) {
      const problems = problemsOf(mutated((d) => { d.operations[0].requestBody.schema[key] = key === "$ref" || key === "$id" || key === "$schema" ? "x" : []; }));
      expect(problems).toEqual([`/operations/0/requestBody/schema/${key}: unknown field '${key}'; check the spelling or remove it`]);
    }
  });

  it("rejects unknown fields at every level", () => {
    expect(problemsOf(mutated((d) => { d.extra = 1; }))).toEqual(["/extra: unknown field 'extra'; check the spelling or remove it"]);
    expect(problemsOf(mutated((d) => { d.info.owner = "x"; }))).toEqual(["/info/owner: unknown field 'owner'; check the spelling or remove it"]);
    expect(problemsOf(mutated((d) => { d.authentication[0].token = "x"; }))).toEqual(["/authentication/0/token: unknown field 'token'; check the spelling or remove it"]);
    expect(problemsOf(mutated((d) => { d.dependencyHints[0].consumer.extra = 1; }))).toEqual(["/dependencyHints/0/consumer/extra: unknown field 'extra'; check the spelling or remove it"]);
  });

  it("requires the identifying top-level fields and at least one operation", () => {
    expect(problemsOf({})).toEqual([
      "/format: is required",
      "/info: is required",
      "/operations: is required",
      "/version: is required",
    ]);
    expect(problemsOf(mutated((d) => { d.operations = []; delete d.dependencyHints; }))).toEqual(["/operations: must contain at least 1 item"]);
    expect(problemsOf(mutated((d) => { d.format = "something-else"; }))).toEqual(['/format: must be "apipilot.api-definition"']);
  });

  it("reports wrong types by their location", () => {
    expect(problemsOf(mutated((d) => { d.operations = "nope"; }))).toEqual(["/operations: must be an array"]);
    expect(problemsOf(mutated((d) => { d.info.title = 5; }))).toEqual(["/info/title: must be a string"]);
    expect(problemsOf(mutated((d) => { d.operations[1].parameters[0].required = "yes"; }))).toEqual(["/operations/1/parameters/0/required: must be a boolean"]);
  });

  it("requires the fields an authentication type needs and rejects the ones it does not use", () => {
    expect(problemsOf(mutated((d) => { d.authentication = [{ name: "k", type: "api-key" }]; d.operations[0].security = ["k"]; d.operations[1].security = ["k"]; }))).toEqual([
      "/authentication/0/in: is required when type is 'api-key'",
      "/authentication/0/parameterName: is required when type is 'api-key'",
    ]);
    expect(problemsOf(mutated((d) => { d.authentication = [{ name: "o", type: "oauth2-client-credentials" }]; d.operations[0].security = ["o"]; d.operations[1].security = ["o"]; }))).toEqual([
      "/authentication/0/tokenUrl: is required when type is 'oauth2-client-credentials'",
    ]);
    expect(problemsOf(mutated((d) => { d.authentication[0].in = "header"; }))).toEqual(["/authentication/0/in: is only valid for type 'api-key'"]);
    expect(problemsOf(mutated((d) => { d.authentication[0].tokenUrl = "https://auth.example.test/token"; }))).toEqual(["/authentication/0/tokenUrl: is only valid for type 'oauth2-client-credentials'"]);
  });
});

describe("cross-checks the schema cannot express", () => {
  it("treats operations that differ only in path parameter names as the same operation", () => {
    const problems = problemsOf(mutated((d) => { d.operations.push({ method: "GET", path: "/orders/{id}", parameters: [{ name: "id", in: "path" }] }); }));
    expect(problems).toEqual(["/operations/2: duplicates operation 1 (GET /orders/{orderId})"]);
  });

  it("allows the same path with a different method", () => {
    expect(problemsOf(mutated((d) => { d.operations.push({ method: "PUT", path: "/orders/{orderId}", parameters: [{ name: "orderId", in: "path" }] }); }))).toEqual([]);
  });

  it("reports a status declared twice for one operation", () => {
    expect(problemsOf(mutated((d) => { d.operations[0].responses[1].status = "201"; }))).toEqual(["/operations/0/responses/1/status: status 201 is already declared by response 0"]);
  });

  it("requires a content type for a response that gives a schema or examples", () => {
    expect(problemsOf(mutated((d) => { delete d.operations[0].responses[0].contentType; }))).toEqual(["/operations/0/responses/0/contentType: is required when a schema or examples are given"]);
    expect(problemsOf(mutated((d) => { d.operations[0].responses[1].examples = [{ value: { error: "bad" } }]; }))).toEqual(["/operations/0/responses/1/contentType: is required when a schema or examples are given"]);
  });

  it("reports duplicate parameters, with header names compared without case", () => {
    expect(problemsOf(mutated((d) => { d.operations[1].parameters.push({ name: "expand", in: "query" }); }))).toEqual(["/operations/1/parameters/2: duplicates parameter 1 (query 'expand')"]);
    expect(problemsOf(mutated((d) => { d.operations[1].parameters.push({ name: "X-Trace", in: "header" }, { name: "x-trace", in: "header" }); }))).toEqual(["/operations/1/parameters/3: duplicates parameter 2 (header 'x-trace')"]);
    expect(problemsOf(mutated((d) => { d.operations[1].parameters.push({ name: "id", in: "query" }, { name: "id", in: "header" }); }))).toEqual([]);
  });

  it("requires well-formed path templates", () => {
    expect(problemsOf(mutated((d) => { d.operations[1].path = "/orders/{orderId"; }))).toEqual(["/operations/1/path: path parameters must be written as {name}, with balanced braces"]);
    expect(problemsOf(mutated((d) => { d.operations[1].path = "/orders/{orderId}/{orderId}"; }))).toEqual(["/operations/1/path: path parameter 'orderId' appears more than once in the path"]);
    expect(problemsOf(mutated((d) => { d.operations[1].path = "/orders/{order id}"; }))).toEqual([
      "/operations/1/path: must start with '/' and contain no query, fragment or whitespace",
    ]);
  });

  it("requires absolute http or https URLs without credentials for baseUrl and tokenUrl", () => {
    for (const baseUrl of ["api.example.test", "ftp://api.example.test", "https://u:p@api.example.test", "https://api.example.test/?x=1", "https://api.example.test/#frag", "not a url"]) {
      expect(problemsOf(mutated((d) => { d.baseUrl = baseUrl; })), baseUrl).toEqual(["/baseUrl: must be an absolute http or https URL without credentials, query or fragment"]);
    }
    for (const baseUrl of ["http://localhost:3000", "https://api.example.test/v1"]) {
      expect(problemsOf(mutated((d) => { d.baseUrl = baseUrl; })), baseUrl).toEqual([]);
    }
    expect(problemsOf(mutated((d) => { d.authentication.push({ name: "oauth", type: "oauth2-client-credentials", tokenUrl: "https://u:p@auth.example.test/token" }); }))).toEqual([
      "/authentication/1/tokenUrl: must be an absolute http or https URL without credentials, query or fragment",
    ]);
  });

  it("reports a duplicate authentication name", () => {
    expect(problemsOf(mutated((d) => { d.authentication.push({ name: "bearerAuth", type: "http-basic" }); }))).toEqual(["/authentication/1/name: 'bearerAuth' is already used by authentication 0"]);
  });

  it("accepts a hint that names an operation as METHOD /path", () => {
    expect(problemsOf(mutated((d) => { d.dependencyHints[0].producer.operation = "POST /orders"; }))).toEqual([]);
  });

  it("rejects an invalid regular expression and contradictory bounds in an embedded schema", () => {
    expect(problemsOf(mutated((d) => { d.operations[0].requestBody.schema.properties.sku.pattern = "([a-z"; }))).toEqual([
      "/operations/0/requestBody/schema/properties/sku/pattern: is not a valid regular expression",
    ]);
    expect(problemsOf(mutated((d) => { d.operations[0].requestBody.schema.properties.quantity.minimum = 500; }))).toEqual([
      "/operations/0/requestBody/schema/properties/quantity/minimum: must not be greater than maximum (100)",
    ]);
  });
});

describe("safety of the messages", () => {
  it("never echoes a value from the document, only names", () => {
    const problems = problemsOf(mutated((d) => { d.leaked = "SEEDED-SECRET-VALUE"; d.operations[0].method = "SEEDED-SECRET-METHOD"; d.baseUrl = "https://SEEDED-SECRET-USER:SEEDED-SECRET-PASS@x.example.test"; }));
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems.filter((line) => !line.includes("unknown field 'leaked'"))) expect(problem).not.toContain("SEEDED-SECRET");
  });

  it("truncates and sanitizes a long or non-printable name it must show", () => {
    const long = "x".repeat(200);
    const problems = problemsOf(mutated((d) => { d[long] = 1; d["bad\u0007name"] = 1; }));
    expect(problems.some((line) => line.includes(`${"x".repeat(64)}...`))).toBe(true);
    expect(problems.every((line) => !line.includes("x".repeat(65)))).toBe(true);
    expect(problems.some((line) => line.includes("bad?name"))).toBe(true);
    expect(problems.every((line) => !line.includes("\u0007"))).toBe(true);
  });

  it("caps the list and says how many were left out", () => {
    const document = mutated((d) => { for (let i = 0; i < 150; i += 1) d[`extra${String(i).padStart(3, "0")}`] = i; });
    const problems = problemsOf(document);
    expect(problems).toHaveLength(101);
    expect(problems[100]).toBe("/: 50 more problems are not listed; fix the ones above and upload again");
  });

  it("does not let a __proto__ key through as anything but an unknown field", () => {
    const document = JSON.parse('{"__proto__": {"polluted": true}, "format": "apipilot.api-definition", "version": 1, "info": {"title": "t"}, "operations": [{"method": "GET", "path": "/a"}]}') as Record<string, unknown>;
    expect(problemsOf(document)).toEqual(["/__proto__: unknown field '__proto__'; check the spelling or remove it"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
