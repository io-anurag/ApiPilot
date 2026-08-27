import type { ApiModel } from "@apipilot/shared-domain";

/**
 * Fixture: a request body with a required field nested two levels deep inside an
 * object-typed property that is itself NOT required at the top level, exercising the
 * "required field nested inside optional parent" edge case (FR-002), plus one required
 * path parameter (excluded from missing/null/empty scenarios per FR-009), one required
 * query parameter, and one required header parameter.
 */
export const nestedRequiredApiModel: ApiModel = {
  operations: [
    {
      path: "/widgets/{widgetId}",
      method: "PATCH",
      operationId: "updateWidget",
      parameters: [
        { name: "widgetId", location: "path", required: true, schema: { type: "string", required: [], properties: {} } },
        {
          name: "requestedBy",
          location: "query",
          required: true,
          schema: { type: "string", required: [], properties: {} },
        },
        {
          name: "X-Trace-Id",
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
              address: {
                type: "object",
                required: ["zipCode"],
                properties: {
                  zipCode: { type: "string", required: [], properties: {} },
                  line2: { type: "string", required: [], properties: {} },
                },
              },
            },
          },
        },
      },
      responses: [
        {
          statusCode: "200",
          description: "Updated",
          contentTypes: {
            "application/json": {
              type: "object",
              required: ["name"],
              properties: { name: { type: "string", required: [], properties: {} } },
            },
          },
          examples: {},
        },
        { statusCode: "400", description: "Invalid request", contentTypes: {}, examples: {} },
      ],
      security: [],
      tags: ["widgets"],
    },
  ],
  securitySchemes: {},
  summary: { operationCount: 1, schemaCount: 1, securitySchemeCount: 0, issues: [] },
};
