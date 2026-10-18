import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ApiModel, TestScenario } from "@apipilot/shared-domain";
import { loadDefinition } from "../../../src/apiInput/definition/loadDefinition";
import { generateTestModelWithNotes } from "../../../src/testDesign/generateTestModel";
import { declaredExampleScenarios, isEmptyConstraint, schemaGroundedView } from "../../../src/testDesign/rules/declaredExampleScenarios";

/**
 * specs/056 FR-037, contracts/observed-generation-rules.md "declaredExampleScenarios": a declared
 * operation runs the existing rules over only what the definition stated, plus one positive scenario
 * from a declared request-body example when the definition gives no schema for that body.
 */

const FIXTURES = path.resolve(__dirname, "../../fixtures/apiInput/definitions");

function definition(operations: unknown[], extra: Record<string, unknown> = {}): ApiModel {
  return loadDefinition({ format: "apipilot.api-definition", version: 1, info: { title: "T" }, operations, ...extra });
}

function scenariosOf(model: ApiModel): TestScenario[] {
  return generateTestModelWithNotes(model).testModel.scenarios;
}

const exampleOnly = {
  id: "importRows",
  method: "POST",
  path: "/rows",
  requestBody: { contentType: "application/json", examples: [{ name: "first", value: { row: 1 } }, { name: "second", value: { row: 2 } }] },
  responses: [{ status: 202, description: "Accepted." }, { status: 422, description: "Rejected." }],
};

describe("declaredExampleScenarios", () => {
  it("emits one positive scenario from the first declared example when the body has no schema", () => {
    const model = definition([exampleOnly]);
    const declared = scenariosOf(model).filter((s) => s.provenance.rule === "declared-example-positive");
    expect(declared).toHaveLength(1);
    const [scenario] = declared;
    expect(scenario).toMatchObject({
      operationPath: "/rows",
      operationMethod: "POST",
      category: "positive",
      request: { body: { row: 1 }, pathParameters: {}, queryParameters: {}, headers: {} },
      assertions: [{ type: "status-code", expectedStatusCode: "202", basis: "declared" }],
      evidence: { origin: "declared", derivation: "declared-example" },
    });
    expect(scenario.evidence?.observationCount).toBeUndefined();
    expect(scenario.provenance).toMatchObject({ source: "RULE", rule: "declared-example-positive" });
  });

  it("does not fire when the body has a schema the existing rules can use", () => {
    const model = definition([{ ...exampleOnly, requestBody: { ...exampleOnly.requestBody, schema: { type: "object", properties: { row: { type: "integer" } } } } }]);
    expect(scenariosOf(model).some((s) => s.provenance.rule === "declared-example-positive")).toBe(false);
  });

  it("does not fire without a declared example", () => {
    const model = definition([{ ...exampleOnly, requestBody: { contentType: "application/json" } }]);
    expect(scenariosOf(model).some((s) => s.provenance.rule === "declared-example-positive")).toBe(false);
    expect(declaredExampleScenarios(model.operations[0])).toEqual([]);
  });

  it("takes path, query and header values from parameter examples, and sends nothing a parameter does not state", () => {
    const model = definition([
      {
        ...exampleOnly,
        path: "/tenants/{tenantId}/rows",
        parameters: [
          { name: "tenantId", in: "path", example: "t-9" },
          { name: "page", in: "query", example: 2 },
          { name: "X-Tenant", in: "header", example: "acme" },
          { name: "limit", in: "query" },
          { name: "sort", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
        ],
      },
    ]);
    const [scenario] = declaredExampleScenarios(model.operations[0]);
    expect(scenario.request).toEqual({
      pathParameters: { tenantId: "t-9" },
      queryParameters: { page: 2, sort: "asc" },
      headers: { "X-Tenant": "acme" },
      body: { row: 1 },
    });
  });

  it("still forms a path for a path parameter that states neither schema nor example", () => {
    const model = definition([{ ...exampleOnly, path: "/rows/{rowId}", parameters: [{ name: "rowId", in: "path" }] }]);
    const [scenario] = declaredExampleScenarios(model.operations[0]);
    expect(Object.keys(scenario.request.pathParameters)).toEqual(["rowId"]);
  });

  it("carries a credential placeholder from an example unchanged, never a value", () => {
    const model = definition([{ ...exampleOnly, requestBody: { contentType: "application/json", examples: [{ value: { user: "ada", password: "SEEDED-SECRET-X" } }] } }]);
    const [scenario] = declaredExampleScenarios(model.operations[0]);
    expect(scenario.request.body).toEqual({ user: "ada", password: "[redacted:password]" });
    expect(JSON.stringify(scenariosOf(model))).not.toContain("SEEDED-SECRET");
  });

  it("deep-copies the example so the model is never mutated by a later change to the request", () => {
    const model = definition([exampleOnly]);
    const [scenario] = declaredExampleScenarios(model.operations[0]);
    (scenario.request.body as { row: number }).row = 99;
    expect(model.operations[0].requestBody?.examples).toMatchObject({ first: { row: 1 } });
  });
});

describe("existing rules on a declared operation", () => {
  it("label every assertion as declared and invent nothing for an unstated body", () => {
    const model = definition([exampleOnly]);
    const fromRules = scenariosOf(model).filter((s) => s.provenance.rule !== "declared-example-positive");
    expect(fromRules.length).toBeGreaterThan(0);
    for (const scenario of fromRules) {
      expect(scenario.request.body).toBeUndefined();
      for (const assertion of scenario.assertions) expect(assertion.basis).toBe("declared");
    }
  });

  it("assert a declared status and nothing for an operation that declares none", () => {
    const model = definition([{ method: "GET", path: "/status" }, { method: "GET", path: "/ping", responses: [{ status: 200 }] }]);
    const byPath = (p: string) => scenariosOf(model).filter((s) => s.operationPath === p);
    for (const scenario of byPath("/status")) expect(scenario.assertions).toEqual([]);
    expect(byPath("/status")[0].provenance.description).toContain("No documented response was available");
    expect(byPath("/ping")[0].assertions).toEqual([{ type: "status-code", expectedStatusCode: "200", basis: "declared" }]);
  });

  it("do not send a non-path parameter whose schema the definition does not state", () => {
    const model = loadDefinition(JSON.parse(readFileSync(path.join(FIXTURES, "minimal.json"), "utf-8")));
    const jobs = scenariosOf(model).filter((s) => s.operationPath === "/jobs");
    expect(jobs.length).toBeGreaterThan(0);
    for (const scenario of jobs) expect(scenario.request.queryParameters).toEqual({});
  });

  it("do not assert conformance to a response schema that states nothing", () => {
    const model = definition([{ method: "GET", path: "/x", responses: [{ status: 200, contentType: "application/json" }] }]);
    for (const scenario of scenariosOf(model)) {
      expect(scenario.assertions.some((a) => a.type === "schema-conformance")).toBe(false);
    }
  });

  it("assert conformance to a declared response schema", () => {
    const model = definition([{ method: "GET", path: "/x", responses: [{ status: 200, contentType: "application/json", schema: { type: "object", required: ["id"], properties: { id: { type: "string" } } } }] }]);
    const positive = scenariosOf(model).find((s) => s.category === "positive");
    expect(positive?.assertions).toEqual([
      { type: "status-code", expectedStatusCode: "200", basis: "declared" },
      {
        type: "schema-conformance",
        expectedSchema: { type: "object", required: ["id"], properties: { id: { type: "string", required: [], properties: {} } } },
        basis: "declared",
      },
    ]);
  });

  it("produce no generation notes, because every declared operation yields a scenario", () => {
    expect(generateTestModelWithNotes(definition([exampleOnly, { method: "GET", path: "/status" }])).notes).toEqual([]);
  });

  it("are deterministic apart from scenario ids", () => {
    const normalize = (scenarios: TestScenario[]) => JSON.stringify(scenarios.map(({ id: _id, ...rest }) => rest));
    const model = definition([exampleOnly]);
    expect(normalize(scenariosOf(model))).toBe(normalize(scenariosOf(model)));
  });
});

describe("schemaGroundedView", () => {
  it("keeps a path parameter without a schema and drops other parameters without one", () => {
    const base = definition([{ method: "GET", path: "/a/{id}", parameters: [{ name: "id", in: "path" }, { name: "q", in: "query" }, { name: "r", in: "query", schema: { type: "string" } }] }]).operations[0];
    expect(schemaGroundedView(base).parameters.map((p) => p.name)).toEqual(["id", "r"]);
  });

  it("drops a body without a schema, and leaves the operation itself unchanged", () => {
    const base = definition([exampleOnly]).operations[0];
    expect(schemaGroundedView(base).requestBody).toBeUndefined();
    expect(base.requestBody).toBeDefined();
  });

  it("is the identity for an operation that states everything", () => {
    const valid = loadDefinition(JSON.parse(readFileSync(path.join(FIXTURES, "valid.json"), "utf-8")));
    for (const base of valid.operations) {
      expect(schemaGroundedView(base)).toEqual(base);
    }
  });

  it("treats a constraint as empty only when it states nothing", () => {
    expect(isEmptyConstraint({ required: [], properties: {} })).toBe(true);
    expect(isEmptyConstraint({ required: [], properties: {}, type: "string" })).toBe(false);
    expect(isEmptyConstraint({ required: ["a"], properties: {} })).toBe(false);
    expect(isEmptyConstraint({ required: [], properties: { a: { required: [], properties: {} } } })).toBe(false);
    expect(isEmptyConstraint({ required: [], properties: {}, minLength: 0 })).toBe(false);
  });
});
