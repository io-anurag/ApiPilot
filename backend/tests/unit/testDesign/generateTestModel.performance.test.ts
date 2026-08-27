import { describe, expect, it } from "vitest";
import type { ApiModel, ApiOperation } from "@apipilot/shared-domain";
import { generateTestModel } from "../../../src/testDesign/generateTestModel";

function syntheticOperation(index: number): ApiOperation {
  return {
    path: `/resources/${index}/{resourceId}`,
    method: "POST",
    operationId: `op${index}`,
    parameters: [
      { name: "resourceId", location: "path", required: true, schema: { type: "string", required: [], properties: {} } },
      {
        name: "filter",
        location: "query",
        required: true,
        schema: { type: "string", minLength: 1, maxLength: 20, required: [], properties: {} },
      },
    ],
    requestBody: {
      required: true,
      contentTypes: {
        "application/json": {
          type: "object",
          required: ["name", "count"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 50, required: [], properties: {} },
            count: { type: "integer", minimum: 0, maximum: 1000, required: [], properties: {} },
            status: { type: "string", enum: ["active", "inactive"], required: [], properties: {} },
            tags: {
              type: "array",
              minItems: 1,
              maxItems: 5,
              items: { type: "string", required: [], properties: {} },
              required: [],
              properties: {},
            },
          },
        },
      },
    },
    responses: [
      {
        statusCode: "200",
        description: "OK",
        contentTypes: {
          "application/json": { type: "object", required: [], properties: {} },
        },
        examples: {},
      },
      { statusCode: "400", description: "Invalid", contentTypes: {}, examples: {} },
    ],
    security: [],
    tags: ["resources"],
  };
}

function syntheticApiModel(operationCount: number): ApiModel {
  const operations = Array.from({ length: operationCount }, (_, i) => syntheticOperation(i));
  return {
    operations,
    securitySchemes: {},
    summary: { operationCount, schemaCount: operationCount, securitySchemeCount: 0, issues: [] },
  };
}

describe("generateTestModel performance (SC-001)", () => {
  it("generates a baseline suite for 100 operations in under 30 seconds", () => {
    const apiModel = syntheticApiModel(100);

    const start = Date.now();
    const testModel = generateTestModel(apiModel);
    const elapsedMs = Date.now() - start;

    expect(testModel.scenarios.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(30_000);
  });
});
