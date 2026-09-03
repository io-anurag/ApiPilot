import type {
  ApiModel,
  ReviewScenario,
  TestModel,
  TestScenario,
} from "@apipilot/shared-domain";

export const reviewApiModel: ApiModel = {
  operations: [
    {
      path: "/widgets",
      method: "POST",
      operationId: "createWidget",
      parameters: [
        {
          name: "Authorization",
          location: "header",
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
            properties: {
              name: { type: "string", required: [], properties: {} },
              quantity: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                required: [],
                properties: {},
              },
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
        {
          statusCode: "400",
          description: "Invalid request",
          contentTypes: {},
          examples: {},
        },
      ],
      security: [],
      tags: ["widgets"],
    },
  ],
  securitySchemes: {},
  summary: { operationCount: 1, schemaCount: 2, securitySchemeCount: 0, issues: [] },
};

/** A deterministic, rule-derived positive scenario (baseline TestDesign output). */
export const deterministicScenario: TestScenario = {
  id: "scenario-deterministic-1",
  operationPath: "/widgets",
  operationMethod: "POST",
  category: "positive",
  request: {
    pathParameters: {},
    queryParameters: {},
    headers: { Authorization: "Bearer sk-live-abc123secret" },
    body: { name: "Widget", quantity: 5 },
  },
  assertions: [{ type: "status-code", expectedStatusCode: "201" }],
  provenance: {
    source: "RULE",
    rule: "positive-request",
    description: "Fully conformant request",
    duplicateOfRules: [],
  },
};

/** An AI-derived scenario eligible for edit/regeneration workflows. */
export const aiDerivedScenario: TestScenario = {
  id: "scenario-ai-1",
  operationPath: "/widgets",
  operationMethod: "POST",
  category: "numeric-boundary",
  targetLocation: "body",
  targetField: "quantity",
  request: {
    pathParameters: {},
    queryParameters: {},
    headers: { Authorization: "Bearer sk-live-abc123secret" },
    body: { name: "Widget", quantity: 0 },
  },
  assertions: [{ type: "status-code", expectedStatusCode: "400" }],
  provenance: {
    source: "AI",
    aiCandidateId: "candidate-quantity-1",
    description: "Quantity below the documented minimum",
    duplicateOfRules: [],
    duplicateOfAICandidates: [],
    aiModel: "mock-model",
    aiProvider: "mock",
    aiRationale: "quantity minimum is 1",
    aiConfidence: 0.75,
    aiAssumptions: [],
  },
};

/** A scenario whose request/assertions are equivalent to `deterministicScenario` (dedup fixture). */
export const duplicateOfDeterministicScenario: TestScenario = {
  ...deterministicScenario,
  id: "scenario-duplicate-1",
  provenance: {
    source: "RULE",
    rule: "positive-request-alternate",
    description: "Alternate rule producing the same request",
    duplicateOfRules: [],
  },
};

export const reviewBaselineTestModel: TestModel = {
  scenarios: [deterministicScenario, aiDerivedScenario],
};

export function makeReviewScenario(
  overrides: Partial<ReviewScenario> = {},
): ReviewScenario {
  return {
    scenarioId: deterministicScenario.id,
    revision: 0,
    scenario: deterministicScenario,
    state: "pending",
    isUserModified: false,
    history: [],
    ...overrides,
  };
}
