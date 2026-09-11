import { describe, expect, it } from "vitest";
import type { ApiModel, ApiOperation } from "@apipilot/shared-domain";
import { generateTestModel } from "../../../src/testDesign/generateTestModel";

function operationWithRequiredQueryParam(): ApiOperation {
  return {
    path: "/widgets/{widgetId}",
    method: "DELETE",
    operationId: "deleteWidget",
    parameters: [
      { name: "widgetId", location: "path", required: true, schema: { required: [], properties: {} } },
      {
        name: "reason",
        location: "query",
        required: true,
        schema: { type: "string", required: [], properties: {} },
      },
    ],
    requestBody: undefined,
    responses: [
      {
        statusCode: "200",
        description: "OK",
        // Response schema composed via `allOf`, deliberately unrelated to this operation's own
        // parameters — buildApiModel.ts flags this as an unsupported-construct issue whose
        // location is still under this operation's path prefix.
        contentTypes: { "application/json": { required: [], properties: {} } },
        examples: {},
      },
    ],
    security: [],
    tags: ["widgets"],
  };
}

function apiModelWithUnrelatedResponseIssue(): ApiModel {
  const operation = operationWithRequiredQueryParam();
  return {
    operations: [operation],
    securitySchemes: {},
    summary: {
      operationCount: 1,
      schemaCount: 1,
      securitySchemeCount: 0,
      issues: [
        {
          kind: "unsupported-construct",
          location: `#/paths${operation.path}/${operation.method.toLowerCase()}/responses/200/content/application~1json/schema`,
          message: 'Unsupported OpenAPI construct "allOf" was found and is not processed',
        },
      ],
    },
  };
}

describe("generateTestModel — construct-level, not operation-level, issue skipping (FR-018)", () => {
  it("still generates scenarios from an operation's own parameters when an unrelated response-schema issue is reported under that operation's path", () => {
    const testModel = generateTestModel(apiModelWithUnrelatedResponseIssue());

    // Regression pin: this operation's required "reason" query parameter has nothing to do with
    // the response body's unsupported `allOf` construct, so it must still produce scenarios
    // (missing-field / null-value at minimum) rather than the whole operation being skipped.
    expect(testModel.scenarios.length).toBeGreaterThan(0);
    expect(
      testModel.scenarios.some(
        (scenario) => scenario.category === "missing-field" && scenario.request !== undefined,
      ),
    ).toBe(true);
  });

  it("produces no scenarios at all when the ApiModel has no operations", () => {
    const testModel = generateTestModel({
      operations: [],
      securitySchemes: {},
      summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] },
    });

    expect(testModel.scenarios).toEqual([]);
  });
});
