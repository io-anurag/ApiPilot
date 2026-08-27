import type { ApiModel } from "@apipilot/shared-domain";

/**
 * Fixture covering an enum field, a pattern/format field, numeric/string/array boundary
 * constraints, a required path parameter, a required query parameter, and an operation
 * whose only documented responses are error status codes (no 2xx) — exercising the
 * assertion gap case where a positive outcome cannot be documented (FR-010, FR-018).
 */
export const constraintsApiModel: ApiModel = {
  operations: [
    {
      path: "/items/{itemId}",
      method: "POST",
      operationId: "createItem",
      parameters: [
        { name: "itemId", location: "path", required: true, schema: { type: "string", required: [], properties: {} } },
        {
          name: "code",
          location: "query",
          required: true,
          schema: { type: "string", pattern: "^[A-Z]{3}$", required: [], properties: {} },
        },
      ],
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": {
            type: "object",
            required: ["sku", "quantity", "tags"],
            properties: {
              sku: { type: "string", format: "uuid", required: [], properties: {} },
              quantity: { type: "integer", minimum: 1, maximum: 100, required: [], properties: {} },
              label: { type: "string", minLength: 2, maxLength: 10, required: [], properties: {} },
              tags: {
                type: "array",
                minItems: 1,
                maxItems: 5,
                items: { type: "string", required: [], properties: {} },
                required: [],
                properties: {},
              },
              status: { type: "string", enum: ["active", "inactive"], required: [], properties: {} },
            },
          },
        },
      },
      responses: [
        { statusCode: "400", description: "Invalid request", contentTypes: {}, examples: {} },
        { statusCode: "500", description: "Server error", contentTypes: {}, examples: {} },
      ],
      security: [],
      tags: ["items"],
    },
  ],
  securitySchemes: {},
  summary: { operationCount: 1, schemaCount: 1, securitySchemeCount: 0, issues: [] },
};
