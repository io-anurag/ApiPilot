import type { ApiModel, SchemaConstraint, TestModel, TestScenario } from "@apipilot/shared-domain";

function schema(partial: Partial<SchemaConstraint> = {}): SchemaConstraint {
  return { required: [], properties: {}, ...partial };
}

/**
 * Fixture ApiModel for AP-007 export tests. Deliberately covers a tagged operation, an
 * untagged operation, a rootless path, path/query/header parameters, a JSON body, a
 * non-JSON body, bearer/basic/apiKey/oauth2 security schemes, an operation declaring two
 * alternative requirement sets, and an analysis issue.
 */
export const exportApiModel: ApiModel = {
  operations: [
    {
      path: "/orders/{orderId}",
      method: "POST",
      operationId: "createOrder",
      parameters: [
        { name: "orderId", location: "path", required: true, schema: schema({ type: "string" }) },
        { name: "dryRun", location: "query", required: false, schema: schema({ type: "boolean" }) },
        { name: "X-Request-Id", location: "header", required: false, schema: schema({ type: "string" }) },
      ],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": schema({
            type: "object",
            required: ["sku", "quantity"],
            properties: {
              sku: schema({ type: "string", format: "uuid" }),
              quantity: schema({ type: "integer", minimum: 1, maximum: 100 }),
            },
          }),
        },
      },
      responses: [
        { statusCode: "201", description: "Created", contentTypes: { "application/json": schema({ type: "object" }) }, examples: {} },
        { statusCode: "4XX", description: "Client error", contentTypes: {}, examples: {} },
      ],
      security: [{ schemes: [{ name: "bearerAuth", scopes: [] }] }],
      tags: ["orders"],
    },
    {
      path: "/orders",
      method: "GET",
      operationId: "listOrders",
      parameters: [],
      requestBody: undefined,
      responses: [
        { statusCode: "200", description: "OK", contentTypes: {}, examples: {} },
        { statusCode: "default", description: "Unexpected error", contentTypes: {}, examples: {} },
      ],
      security: [],
      tags: [],
    },
    {
      path: "/reports/upload",
      method: "POST",
      operationId: "uploadReport",
      parameters: [],
      requestBody: {
        required: true,
        contentTypes: { "multipart/form-data": schema({ type: "object" }) },
      },
      responses: [{ statusCode: "202", description: "Accepted", contentTypes: {}, examples: {} }],
      security: [{ schemes: [{ name: "apiKeyAuth", scopes: [] }] }],
      tags: ["reports"],
    },
    {
      path: "/admin/keys",
      method: "DELETE",
      operationId: "revokeKey",
      parameters: [],
      requestBody: undefined,
      responses: [{ statusCode: "204", description: "No content", contentTypes: {}, examples: {} }],
      security: [
        { schemes: [{ name: "basicAuth", scopes: [] }] },
        { schemes: [{ name: "bearerAuth", scopes: [] }] },
      ],
      tags: ["admin"],
    },
    {
      path: "/sessions",
      method: "POST",
      operationId: "createSession",
      parameters: [],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": schema({
            type: "object",
            required: ["username", "password"],
            properties: {
              username: schema({ type: "string" }),
              password: schema({ type: "string" }),
            },
          }),
        },
      },
      responses: [{ statusCode: "201", description: "Created", contentTypes: {}, examples: {} }],
      security: [{ schemes: [{ name: "oauth2Auth", scopes: ["write"] }] }],
      tags: ["sessions"],
    },
  ],
  securitySchemes: {
    bearerAuth: { type: "http", scheme: "bearer" },
    basicAuth: { type: "http", scheme: "basic" },
    apiKeyAuth: { type: "apiKey", in: "header", name: "X-Api-Key" },
    oauth2Auth: { type: "oauth2" },
  },
  summary: {
    operationCount: 5,
    schemaCount: 4,
    securitySchemeCount: 4,
    issues: [
      {
        kind: "unsupported-construct",
        location: "POST /sessions",
        message: "oneOf is not supported and was not expanded.",
      },
    ],
  },
};

function ruleScenario(
  id: string,
  overrides: Partial<TestScenario> & Pick<TestScenario, "operationPath" | "operationMethod">,
): TestScenario {
  return {
    id,
    category: "positive",
    request: { pathParameters: {}, queryParameters: {}, headers: {} },
    assertions: [],
    provenance: {
      source: "RULE",
      rule: "positive",
      description: `Deterministic scenario ${id}.`,
      duplicateOfRules: [],
    },
    ...overrides,
  };
}

/**
 * Approved TestModel covering: an exact status code, a wildcard code, a `default` code, a
 * schema-conformance assertion, a scenario with no assertions, a deliberately invalid
 * negative body, an untagged operation, an unsupported content type, an unsupported auth
 * scheme, an unresolved path parameter, and a credential-bearing request value.
 */
export const approvedTestModel: TestModel = {
  scenarios: [
    ruleScenario("scenario-order-positive", {
      operationPath: "/orders/{orderId}",
      operationMethod: "POST",
      category: "positive",
      request: {
        pathParameters: { orderId: "order-1" },
        queryParameters: { dryRun: true },
        headers: { "X-Request-Id": "req-1" },
        body: { sku: "0f7d1c1e-0000-4000-8000-000000000000", quantity: 2 },
      },
      assertions: [
        { type: "status-code", expectedStatusCode: "201" },
        { type: "schema-conformance", expectedSchema: schema({ type: "object" }) },
      ],
    }),
    ruleScenario("scenario-order-invalid-type", {
      operationPath: "/orders/{orderId}",
      operationMethod: "POST",
      category: "invalid-type",
      targetLocation: "body",
      targetField: "quantity",
      request: {
        pathParameters: { orderId: "order-1" },
        queryParameters: {},
        headers: {},
        body: { sku: "0f7d1c1e-0000-4000-8000-000000000000", quantity: "not-a-number" },
      },
      assertions: [{ type: "status-code", expectedStatusCode: "4XX" }],
      provenance: {
        source: "RULE",
        rule: "invalid-type",
        description: "body field \"quantity\" set to an incompatible type.",
        duplicateOfRules: [],
      },
    }),
    ruleScenario("scenario-order-missing-path-value", {
      operationPath: "/orders/{orderId}",
      operationMethod: "POST",
      category: "missing-field",
      request: { pathParameters: {}, queryParameters: {}, headers: {}, body: { sku: "x" } },
      assertions: [{ type: "status-code", expectedStatusCode: "4XX" }],
    }),
    ruleScenario("scenario-list-default-only", {
      operationPath: "/orders",
      operationMethod: "GET",
      assertions: [{ type: "status-code", expectedStatusCode: "default" }],
    }),
    ruleScenario("scenario-list-no-assertions", {
      operationPath: "/orders",
      operationMethod: "GET",
      assertions: [],
    }),
    ruleScenario("scenario-report-upload", {
      operationPath: "/reports/upload",
      operationMethod: "POST",
      request: { pathParameters: {}, queryParameters: {}, headers: {}, body: { file: "report.csv" } },
      assertions: [{ type: "status-code", expectedStatusCode: "202" }],
    }),
    ruleScenario("scenario-admin-revoke", {
      operationPath: "/admin/keys",
      operationMethod: "DELETE",
      assertions: [{ type: "status-code", expectedStatusCode: "204" }],
    }),
    {
      id: "scenario-session-credentials",
      operationPath: "/sessions",
      operationMethod: "POST",
      category: "positive",
      request: {
        pathParameters: {},
        queryParameters: {},
        headers: { Authorization: "Bearer sk-live-supersecret" },
        body: { username: "qa", password: "hunter2" },
      },
      assertions: [{ type: "status-code", expectedStatusCode: "201" }],
      provenance: {
        source: "AI",
        aiCandidateId: "candidate-1",
        description: "Exercises session creation with credentials.",
        duplicateOfRules: [],
        duplicateOfAICandidates: [],
        aiModel: "test-model",
        aiProvider: "mock",
        aiRationale: "Credential-bearing request.",
        aiConfidence: 0.9,
        aiAssumptions: [],
      },
    },
  ],
};

/** A minimal single-operation model, for tests that need a small, fully predictable export. */
export const minimalApiModel: ApiModel = {
  operations: [
    {
      path: "/ping",
      method: "GET",
      operationId: "ping",
      parameters: [],
      requestBody: undefined,
      responses: [{ statusCode: "200", description: "OK", contentTypes: {}, examples: {} }],
      security: [],
      tags: ["health"],
    },
  ],
  securitySchemes: {},
  summary: { operationCount: 1, schemaCount: 0, securitySchemeCount: 0, issues: [] },
};

export const minimalTestModel: TestModel = {
  scenarios: [
    ruleScenario("scenario-ping", {
      operationPath: "/ping",
      operationMethod: "GET",
      assertions: [{ type: "status-code", expectedStatusCode: "200" }],
    }),
  ],
};
