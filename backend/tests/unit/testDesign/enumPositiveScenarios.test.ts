import { describe, expect, it } from "vitest";
import type { ApiOperation } from "@apipilot/shared-domain";
import { enumPositiveScenarios } from "../../../src/testDesign/rules/enumPositiveScenarios";

function operationWithEnumQueryParam(): ApiOperation {
  return {
    path: "/catalog/items",
    method: "GET",
    operationId: "listItems",
    parameters: [
      {
        name: "sort",
        location: "query",
        required: false,
        schema: { type: "string", required: [], properties: {}, enum: ["name", "-name", "price"] },
      },
    ],
    requestBody: undefined,
    responses: [
      { statusCode: "200", description: "OK", contentTypes: {}, examples: {} },
    ],
    security: [],
    tags: ["catalog"],
  };
}

function operationWithEnumBodyField(): ApiOperation {
  return {
    path: "/widgets",
    method: "POST",
    operationId: "createWidget",
    parameters: [],
    requestBody: {
      required: true,
      contentTypes: {
        "application/json": {
          required: ["status"],
          properties: {
            status: { type: "string", required: [], properties: {}, enum: ["active", "inactive"] },
          },
        },
      },
    },
    responses: [
      { statusCode: "201", description: "Created", contentTypes: {}, examples: {} },
    ],
    security: [],
    tags: ["widgets"],
  };
}

function operationWithNoEnum(): ApiOperation {
  return {
    path: "/widgets/{widgetId}",
    method: "GET",
    operationId: "getWidget",
    parameters: [
      { name: "widgetId", location: "path", required: true, schema: { type: "string", required: [], properties: {} } },
    ],
    requestBody: undefined,
    responses: [{ statusCode: "200", description: "OK", contentTypes: {}, examples: {} }],
    security: [],
    tags: ["widgets"],
  };
}

describe("enumPositiveScenarios (FR-001a)", () => {
  it("generates one positive scenario per remaining declared enum value for a query parameter", () => {
    const scenarios = enumPositiveScenarios(operationWithEnumQueryParam());

    expect(scenarios).toHaveLength(2);
    expect(scenarios.every((scenario) => scenario.category === "positive")).toBe(true);
    expect(scenarios.map((scenario) => scenario.request.queryParameters.sort)).toEqual([
      "-name",
      "price",
    ]);
    // The first declared enum value ("name") is already covered by the FR-001 baseline scenario
    // and must not be duplicated here.
    expect(scenarios.some((scenario) => scenario.request.queryParameters.sort === "name")).toBe(
      false,
    );
  });

  it("generates one positive scenario per remaining declared enum value for a request body field", () => {
    const scenarios = enumPositiveScenarios(operationWithEnumBodyField());

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].category).toBe("positive");
    expect((scenarios[0].request.body as { status: string }).status).toBe("inactive");
  });

  it("generates nothing for an operation with no enum-constrained field or parameter", () => {
    expect(enumPositiveScenarios(operationWithNoEnum())).toEqual([]);
  });

  it("records provenance naming the enum value and the target field", () => {
    const [scenario] = enumPositiveScenarios(operationWithEnumQueryParam());

    expect(scenario.provenance.rule).toBe("enum-positive-variant");
    expect(scenario.provenance.description).toContain("sort");
    expect(scenario.targetField).toBe("sort");
    expect(scenario.targetLocation).toBe("query");
  });
});
