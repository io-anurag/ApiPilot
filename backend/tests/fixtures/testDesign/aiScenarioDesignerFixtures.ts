import type { ApiModel, TestModel } from "@apipilot/shared-domain";

export const aiScenarioApiModel: ApiModel = {
  operations: [
    {
      path: "/accounts",
      method: "POST",
      operationId: "createAccount",
      parameters: [],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": {
            type: "object",
            required: ["email"],
            properties: {
              email: { type: "string", format: "email", required: [], properties: {} },
              displayName: { type: "string", required: [], properties: {} },
            },
          },
        },
      },
      responses: [
        {
          statusCode: "201",
          description: "Created",
          contentTypes: {
            "application/json": {
              type: "object",
              required: ["id"],
              properties: { id: { type: "string", required: [], properties: {} } },
            },
          },
          examples: {},
        },
        { statusCode: "409", description: "Conflict", contentTypes: {}, examples: {} },
      ],
      security: [],
      tags: ["accounts"],
    },
  ],
  securitySchemes: {},
  summary: { operationCount: 1, schemaCount: 2, securitySchemeCount: 0, issues: [] },
};

export const aiScenarioBaseline: TestModel = { scenarios: [] };

/**
 * Generates a large ApiModel of independent single-operation resources for the batching
 * feature's multi-batch enhancement tests (specs/011-ai-prompt-batching): each `POST
 * /resourceN` requires an "email" field, mirroring `aiScenarioApiModel`'s shape so the same
 * kind of AI scenario candidate (`invalid-format` on `email`) can target any of them.
 */
export function buildLargeAiScenarioApiModel(operationCount = 20): ApiModel {
  const operations: ApiModel["operations"] = [];
  for (let i = 0; i < operationCount; i += 1) {
    operations.push({
      path: `/resource${i}`,
      method: "POST",
      operationId: `createResource${i}`,
      parameters: [],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": {
            type: "object",
            required: ["email"],
            properties: {
              email: { type: "string", format: "email", required: [], properties: {} },
            },
          },
        },
      },
      responses: [
        {
          statusCode: "201",
          description: "Created",
          contentTypes: {
            "application/json": {
              type: "object",
              required: ["id"],
              properties: { id: { type: "string", required: [], properties: {} } },
            },
          },
          examples: {},
        },
        { statusCode: "409", description: "Conflict", contentTypes: {}, examples: {} },
      ],
      security: [],
      tags: [`resource${i}`],
    });
  }
  return {
    operations,
    securitySchemes: {},
    summary: {
      operationCount,
      schemaCount: operationCount * 2,
      securitySchemeCount: 0,
      issues: [],
    },
  };
}

/**
 * A deterministic baseline that scales with `operationCount`, mirroring how the real
 * deterministic test designer produces several scenarios per operation for a full
 * specification (unlike `aiScenarioBaseline`, which is empty and so cannot exercise
 * batching's handling of a baseline that grows with the spec). Used to regression-test that
 * a batch's prompt only embeds the scenarios for its own operations, not the whole
 * specification's baseline (specs/011-ai-prompt-batching).
 */
export function buildLargeAiScenarioBaseline(
  operationCount = 20,
  scenariosPerOperation = 5,
): TestModel {
  const scenarios: TestModel["scenarios"] = [];
  for (let i = 0; i < operationCount; i += 1) {
    for (let j = 0; j < scenariosPerOperation; j += 1) {
      scenarios.push({
        id: `resource${i}-scenario${j}`,
        operationPath: `/resource${i}`,
        operationMethod: "POST",
        category: "missing-field",
        targetLocation: "body",
        targetField: "email",
        request: { pathParameters: {}, queryParameters: {}, headers: {} },
        assertions: [{ type: "status-code", expectedStatusCode: "400" }],
        provenance: {
          source: "RULE",
          rule: "missing-required-field",
          description: "email is required",
          duplicateOfRules: [],
        },
      });
    }
  }
  return { scenarios };
}
