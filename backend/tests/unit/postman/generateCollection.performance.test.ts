import { describe, expect, it } from "vitest";
import type { ApiModel, ApiOperation, TestModel, TestScenario } from "@apipilot/shared-domain";
import { generateCollection } from "../../../src/postman/generateCollection";

const OPERATION_COUNT = 50;
const SCENARIOS_PER_OPERATION = 10;

function syntheticOperation(index: number): ApiOperation {
  return {
    path: `/resources/${index}/{resourceId}`,
    method: "POST",
    operationId: `op${index}`,
    parameters: [
      {
        name: "resourceId",
        location: "path",
        required: true,
        schema: { type: "string", required: [], properties: {} },
      },
    ],
    requestBody: {
      required: true,
      contentTypes: {
        "application/json": {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", required: [], properties: {} } },
        },
      },
    },
    responses: [
      { statusCode: "201", description: "Created", contentTypes: {}, examples: {} },
      { statusCode: "400", description: "Invalid", contentTypes: {}, examples: {} },
    ],
    security: [],
    tags: [`group-${index % 7}`],
  };
}

function syntheticScenario(operation: ApiOperation, index: number): TestScenario {
  return {
    id: `scenario-${operation.operationId}-${index}`,
    operationPath: operation.path,
    operationMethod: operation.method,
    category: index % 2 === 0 ? "positive" : "invalid-type",
    request: {
      pathParameters: { resourceId: `resource-${index}` },
      queryParameters: {},
      headers: { "X-Request-Id": `req-${index}` },
      body: { name: index % 2 === 0 ? "valid" : 12345 },
    },
    assertions: [{ type: "status-code", expectedStatusCode: index % 2 === 0 ? "201" : "400" }],
    provenance: {
      source: "RULE",
      rule: "synthetic",
      description: "Synthetic scenario for the performance target.",
      duplicateOfRules: [],
    },
  };
}

describe("export performance (SC-010)", () => {
  it("exports 500 approved scenarios in under 10 seconds", () => {
    const operations = Array.from({ length: OPERATION_COUNT }, (_, i) => syntheticOperation(i));
    const apiModel: ApiModel = {
      operations,
      securitySchemes: {},
      summary: {
        operationCount: operations.length,
        schemaCount: operations.length,
        securitySchemeCount: 0,
        issues: [],
      },
    };
    const testModel: TestModel = {
      scenarios: operations.flatMap((operation) =>
        Array.from({ length: SCENARIOS_PER_OPERATION }, (_, i) => syntheticScenario(operation, i)),
      ),
    };
    expect(testModel.scenarios).toHaveLength(OPERATION_COUNT * SCENARIOS_PER_OPERATION);

    const start = Date.now();
    const outcome = generateCollection(apiModel, testModel);
    const elapsedMs = Date.now() - start;

    if (!outcome.ok) throw new Error(`expected a successful export, got ${outcome.failure.code}`);
    expect(outcome.result.summary.requestCount).toBe(500);
    expect(elapsedMs).toBeLessThan(10_000);
  });
});
