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
