import { describe, expect, it } from "vitest";
import type { TestScenario } from "@apipilot/shared-domain";
import { toJsonSchema, translateAssertions } from "../../../src/postman/assertionScripts";

function scenario(assertions: TestScenario["assertions"]): TestScenario {
  return {
    id: "scenario-1",
    operationPath: "/orders",
    operationMethod: "POST",
    category: "positive",
    request: { pathParameters: {}, queryParameters: {}, headers: {} },
    assertions,
    provenance: { source: "RULE", rule: "positive", description: "d", duplicateOfRules: [] },
  };
}

function script(result: ReturnType<typeof translateAssertions>): string {
  return (result.event?.script.exec ?? []).join("\n");
}

describe("translateAssertions", () => {
  it("asserts an exact documented status code", () => {
    const result = translateAssertions(scenario([{ type: "status-code", expectedStatusCode: "201" }]));
    expect(script(result)).toContain("201");
    expect(result.limitations).toEqual([]);
  });

  it("asserts a status class for a wildcard code without inventing a concrete code", () => {
    const result = translateAssertions(scenario([{ type: "status-code", expectedStatusCode: "4XX" }]));
    const text = script(result);
    expect(text).toContain("400");
    expect(text).toContain("500");
    expect(text).not.toContain("to.have.status");
  });

  it("emits no check for a default status code and records the gap", () => {
    const result = translateAssertions(
      scenario([{ type: "status-code", expectedStatusCode: "default" }]),
    );
    expect(result.event).toBeUndefined();
    expect(result.limitations).toEqual([
      expect.objectContaining({ kind: "undocumented-status-code", scenarioId: "scenario-1" }),
    ]);
  });

  it("emits no script and records the gap when the scenario carries no assertion", () => {
    const result = translateAssertions(scenario([]));
    expect(result.event).toBeUndefined();
    expect(result.limitations).toEqual([
      expect.objectContaining({ kind: "no-expected-outcome", scenarioId: "scenario-1" }),
    ]);
  });

  it("asserts schema conformance using the approved expected schema", () => {
    const result = translateAssertions(
      scenario([
        {
          type: "schema-conformance",
          expectedSchema: { type: "object", required: ["id"], properties: { id: { type: "string", required: [], properties: {} } } },
        },
      ]),
    );
    expect(script(result)).toContain("jsonSchema");
    expect(script(result)).toContain('"id"');
  });

  it("emits one script carrying every assertion the scenario defined and nothing else", () => {
    const result = translateAssertions(
      scenario([
        { type: "status-code", expectedStatusCode: "201" },
        { type: "schema-conformance", expectedSchema: { type: "object", required: [], properties: {} } },
      ]),
    );
    expect(result.event?.listen).toBe("test");
    expect(script(result).match(/pm\.test\(/g)).toHaveLength(2);
  });
});

describe("toJsonSchema", () => {
  it("copies only the constraints the specification actually declared", () => {
    expect(
      toJsonSchema({ type: "string", required: [], properties: {}, minLength: 2 }),
    ).toEqual({ type: "string", minLength: 2 });
  });

  it("omits an empty required list rather than emitting it", () => {
    expect(toJsonSchema({ type: "object", required: [], properties: {} })).toEqual({
      type: "object",
    });
  });

  it("keeps a non-empty required list", () => {
    expect(
      toJsonSchema({ type: "object", required: ["a"], properties: { a: { type: "string", required: [], properties: {} } } }),
    ).toEqual({ type: "object", properties: { a: { type: "string" } }, required: ["a"] });
  });

  it("converts array items recursively", () => {
    expect(
      toJsonSchema({
        type: "array",
        required: [],
        properties: {},
        minItems: 1,
        items: { type: "integer", required: [], properties: {}, maximum: 5 },
      }),
    ).toEqual({ type: "array", minItems: 1, items: { type: "integer", maximum: 5 } });
  });

  it("carries enum, format, pattern, and numeric bounds when declared", () => {
    expect(
      toJsonSchema({
        type: "string",
        required: [],
        properties: {},
        enum: ["a", "b"],
        format: "uuid",
        pattern: "^a",
      }),
    ).toEqual({ type: "string", enum: ["a", "b"], format: "uuid", pattern: "^a" });
  });
});