import type { ApiModel, SchemaConstraint } from "@apipilot/shared-domain";

function schema(partial: Partial<SchemaConstraint> = {}): SchemaConstraint {
  return { required: [], properties: {}, ...partial };
}

/**
 * A single-operation ApiModel with no other operation to relate to, so dependency analysis must
 * report an explicit empty result rather than failing (FR-009, edge case: "only one operation").
 */
export const minimalApiModelForNoRelationships: ApiModel = {
  operations: [
    {
      path: "/health",
      method: "GET",
      operationId: "getHealth",
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

/**
 * CRUD-chain fixture: POST /users returns "id"; GET/PUT/DELETE /users/{userId} consume it as
 * the "userId" path parameter. Shared tag "users", same resource path, matching type and
 * format — the flagship CONFIRMED case from spec.md's worked example.
 */
export const crudChainApiModel: ApiModel = {
  operations: [
    {
      path: "/users",
      method: "POST",
      operationId: "createUser",
      parameters: [],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": schema({
            type: "object",
            required: ["displayName"],
            properties: { displayName: schema({ type: "string" }) },
          }),
        },
      },
      responses: [
        {
          statusCode: "201",
          description: "Created",
          contentTypes: {
            "application/json": schema({
              type: "object",
              properties: {
                id: schema({ type: "string", format: "uuid" }),
                name: schema({ type: "string" }),
              },
            }),
          },
          examples: {},
        },
      ],
      security: [],
      tags: ["users"],
    },
    {
      path: "/users/{userId}",
      method: "GET",
      operationId: "getUser",
      parameters: [
        { name: "userId", location: "path", required: true, schema: schema({ type: "string", format: "uuid" }) },
      ],
      requestBody: undefined,
      responses: [
        {
          statusCode: "200",
          description: "OK",
          contentTypes: {
            "application/json": schema({
              type: "object",
              properties: {
                id: schema({ type: "string", format: "uuid" }),
                name: schema({ type: "string" }),
              },
            }),
          },
          examples: {},
        },
      ],
      security: [],
      tags: ["users"],
    },
    {
      path: "/users/{userId}",
      method: "PUT",
      operationId: "updateUser",
      parameters: [
        { name: "userId", location: "path", required: true, schema: schema({ type: "string", format: "uuid" }) },
      ],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": schema({
            type: "object",
            properties: { displayName: schema({ type: "string" }) },
          }),
        },
      },
      responses: [{ statusCode: "200", description: "OK", contentTypes: {}, examples: {} }],
      security: [],
      tags: ["users"],
    },
    {
      path: "/users/{userId}",
      method: "DELETE",
      operationId: "deleteUser",
      parameters: [
        { name: "userId", location: "path", required: true, schema: schema({ type: "string", format: "uuid" }) },
      ],
      requestBody: undefined,
      responses: [{ statusCode: "204", description: "No content", contentTypes: {}, examples: {} }],
      security: [],
      tags: ["users"],
    },
  ],
  securitySchemes: {},
  summary: { operationCount: 4, schemaCount: 3, securitySchemeCount: 0, issues: [] },
};

/**
 * Unrelated-name-collision fixture: "name" appears both on a Product response (POST /products)
 * and a User request body (POST /users), with no resource relationship and no shared tag — only
 * the field name and type coincidentally match. Must never classify above POSSIBLE.
 */
export const unrelatedNameCollisionApiModel: ApiModel = {
  operations: [
    {
      path: "/products",
      method: "POST",
      operationId: "createProduct",
      parameters: [],
      requestBody: undefined,
      responses: [
        {
          statusCode: "201",
          description: "Created",
          contentTypes: {
            "application/json": schema({
              type: "object",
              properties: {
                id: schema({ type: "string", format: "uuid" }),
                name: schema({ type: "string" }),
              },
            }),
          },
          examples: {},
        },
      ],
      security: [],
      tags: ["products"],
    },
    {
      path: "/users",
      method: "POST",
      operationId: "createUser",
      parameters: [],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": schema({
            type: "object",
            required: ["name"],
            properties: { name: schema({ type: "string" }) },
          }),
        },
      },
      responses: [{ statusCode: "201", description: "Created", contentTypes: {}, examples: {} }],
      security: [],
      tags: ["users"],
    },
  ],
  securitySchemes: {},
  summary: { operationCount: 2, schemaCount: 2, securitySchemeCount: 0, issues: [] },
};

/**
 * Nested-identifier fixture: POST /sessions returns a response shaped `{ user: { id } }`, and
 * GET /sessions/{userId}/profile consumes the nested value as a path parameter. Exercises
 * `walkFields`-based nested field discovery on the producer side.
 */
export const nestedIdentifierApiModel: ApiModel = {
  operations: [
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
            required: ["username"],
            properties: { username: schema({ type: "string" }) },
          }),
        },
      },
      responses: [
        {
          statusCode: "201",
          description: "Created",
          contentTypes: {
            "application/json": schema({
              type: "object",
              properties: {
                user: schema({
                  type: "object",
                  properties: { id: schema({ type: "string", format: "uuid" }) },
                }),
              },
            }),
          },
          examples: {},
        },
      ],
      security: [],
      tags: ["sessions"],
    },
    {
      path: "/sessions/{userId}/profile",
      method: "GET",
      operationId: "getSessionProfile",
      parameters: [
        { name: "userId", location: "path", required: true, schema: schema({ type: "string", format: "uuid" }) },
      ],
      requestBody: undefined,
      responses: [{ statusCode: "200", description: "OK", contentTypes: {}, examples: {} }],
      security: [],
      tags: ["sessions"],
    },
  ],
  securitySchemes: {},
  summary: { operationCount: 2, schemaCount: 2, securitySchemeCount: 0, issues: [] },
};

/**
 * Cyclic fixture: POST /widgets returns "id" and consumes "gadgetId"; POST /gadgets returns "id"
 * and consumes "widgetId". Each operation's response can plausibly feed the other's request,
 * forming a two-node cycle at LIKELY confidence (type + format match, no resource relationship).
 */
export const cyclicApiModel: ApiModel = {
  operations: [
    {
      path: "/widgets",
      method: "POST",
      operationId: "createWidget",
      parameters: [],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": schema({
            type: "object",
            properties: { gadgetId: schema({ type: "string", format: "uuid" }) },
          }),
        },
      },
      responses: [
        {
          statusCode: "201",
          description: "Created",
          contentTypes: {
            "application/json": schema({
              type: "object",
              properties: {
                id: schema({ type: "string", format: "uuid" }),
                gadgetId: schema({ type: "string", format: "uuid" }),
              },
            }),
          },
          examples: {},
        },
      ],
      security: [],
      tags: ["widgets"],
    },
    {
      path: "/gadgets",
      method: "POST",
      operationId: "createGadget",
      parameters: [],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": schema({
            type: "object",
            properties: { widgetId: schema({ type: "string", format: "uuid" }) },
          }),
        },
      },
      responses: [
        {
          statusCode: "201",
          description: "Created",
          contentTypes: {
            "application/json": schema({
              type: "object",
              properties: {
                id: schema({ type: "string", format: "uuid" }),
                widgetId: schema({ type: "string", format: "uuid" }),
              },
            }),
          },
          examples: {},
        },
      ],
      security: [],
      tags: ["gadgets"],
    },
  ],
  securitySchemes: {},
  summary: { operationCount: 2, schemaCount: 2, securitySchemeCount: 0, issues: [] },
};

/**
 * Dissimilar-name fixture for AI-assisted detection: POST /accounts returns "accountId";
 * POST /transfers consumes "accountRef". No deterministic name, resource, or tag overlap, so
 * deterministic matching reports nothing here — only the AI-assisted pass can find it.
 */
export const dissimilarNameAiApiModel: ApiModel = {
  operations: [
    {
      path: "/accounts",
      method: "POST",
      operationId: "createAccount",
      parameters: [],
      requestBody: undefined,
      responses: [
        {
          statusCode: "201",
          description: "Created",
          contentTypes: {
            "application/json": schema({
              type: "object",
              properties: { accountId: schema({ type: "string", format: "uuid" }) },
            }),
          },
          examples: {},
        },
      ],
      security: [],
      tags: ["accounts"],
    },
    {
      path: "/transfers",
      method: "POST",
      operationId: "createTransfer",
      parameters: [],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": schema({
            type: "object",
            required: ["accountRef"],
            properties: { accountRef: schema({ type: "string" }) },
          }),
        },
      },
      responses: [{ statusCode: "201", description: "Created", contentTypes: {}, examples: {} }],
      security: [],
      tags: ["transfers"],
    },
  ],
  securitySchemes: {},
  summary: { operationCount: 2, schemaCount: 2, securitySchemeCount: 0, issues: [] },
};

/**
 * Security-parameter fixture: GET /widgets/{widgetId} declares an "X-Api-Key" header parameter
 * that duplicates an apiKey security requirement. Field extraction must exclude it from consumer
 * candidates while still including the ordinary "widgetId" path parameter.
 */
export const securityParameterApiModel: ApiModel = {
  operations: [
    {
      path: "/widgets/{widgetId}",
      method: "GET",
      operationId: "getWidget",
      parameters: [
        { name: "widgetId", location: "path", required: true, schema: schema({ type: "string", format: "uuid" }) },
        { name: "X-Api-Key", location: "header", required: true, schema: schema({ type: "string" }) },
      ],
      requestBody: undefined,
      responses: [{ statusCode: "200", description: "OK", contentTypes: {}, examples: {} }],
      security: [{ schemes: [{ name: "apiKeyAuth", scopes: [] }] }],
      tags: ["widgets"],
    },
  ],
  securitySchemes: {
    apiKeyAuth: { type: "apiKey", in: "header", name: "X-Api-Key" },
  },
  summary: { operationCount: 1, schemaCount: 0, securitySchemeCount: 1, issues: [] },
};

/**
 * Generates a large ApiModel of CRUD-chain-shaped resources for the SC-008 performance test:
 * `operationCount / 2` resources, each with a POST (returns "id") and a GET/{id} (consumes it).
 */
export function buildLargeApiModel(operationCount = 200): ApiModel {
  const resourceCount = Math.floor(operationCount / 2);
  const operations: ApiModel["operations"] = [];
  for (let i = 0; i < resourceCount; i += 1) {
    const resource = `resource${i}`;
    operations.push({
      path: `/${resource}`,
      method: "POST",
      operationId: `create${resource}`,
      parameters: [],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": schema({ type: "object", properties: { name: schema({ type: "string" }) } }),
        },
      },
      responses: [
        {
          statusCode: "201",
          description: "Created",
          contentTypes: {
            "application/json": schema({
              type: "object",
              properties: { id: schema({ type: "string", format: "uuid" }) },
            }),
          },
          examples: {},
        },
      ],
      security: [],
      tags: [resource],
    });
    operations.push({
      path: `/${resource}/{${resource}Id}`,
      method: "GET",
      operationId: `get${resource}`,
      parameters: [
        {
          name: `${resource}Id`,
          location: "path",
          required: true,
          schema: schema({ type: "string", format: "uuid" }),
        },
      ],
      requestBody: undefined,
      responses: [{ statusCode: "200", description: "OK", contentTypes: {}, examples: {} }],
      security: [],
      tags: [resource],
    });
  }
  return {
    operations,
    securitySchemes: {},
    summary: { operationCount: operations.length, schemaCount: resourceCount * 2, securitySchemeCount: 0, issues: [] },
  };
}
