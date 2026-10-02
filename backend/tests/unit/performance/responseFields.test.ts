import type { ApiOperation, SchemaConstraint } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { documentedResponseFields, MAX_RESPONSE_FIELDS } from "../../../src/performance/plan/responseFields";
import { loadUserJourneysApiModel } from "../../fixtures/performance/specification";

/** AP-035 FR-009 (specs/035-user-defined-journeys research R9; tasks T020). */

function schema(overrides: Partial<SchemaConstraint> = {}): SchemaConstraint {
  return { required: [], properties: {}, ...overrides };
}

function operation(responses: ApiOperation["responses"]): ApiOperation {
  return { path: "/x", method: "post", operationId: undefined, parameters: [], requestBody: undefined, responses, security: [], tags: [] };
}

describe("documentedResponseFields", () => {
  it("lists the scalar fields of a success response, sorted, from the specification", async () => {
    const model = await loadUserJourneysApiModel();
    const create = model.operations.find((candidate) => candidate.method.toLowerCase() === "post" && candidate.path === "/api/v1/customers")!;
    expect(documentedResponseFields(create)).toEqual({
      fields: [
        { path: "id", type: "string", statusCodes: ["201"] },
        { path: "name", type: "string", statusCodes: ["201"] },
      ],
      truncated: false,
    });
  });

  it("writes array items as [0], reads +json media types, and ignores error responses and other media types", () => {
    const body = schema({
      type: "object",
      properties: { data: schema({ type: "object", properties: { items: schema({ type: "array", items: schema({ type: "object", properties: { id: schema({ type: "integer" }) } }) }) } }) },
    });
    const result = documentedResponseFields(
      operation([
        { statusCode: "200", description: "", contentTypes: { "application/vnd.api+json": body }, examples: {} },
        { statusCode: "201", description: "", contentTypes: { "text/plain": schema({ type: "string" }) }, examples: {} },
        { statusCode: "404", description: "", contentTypes: { "application/json": schema({ type: "object", properties: { error: schema({ type: "string" }) } }) }, examples: {} },
      ]),
    );
    expect(result.fields).toEqual([{ path: "data.items[0].id", type: "integer", statusCodes: ["200"] }]);
  });

  it("merges status codes for a field several success responses document", () => {
    const body = schema({ type: "object", properties: { id: schema({ type: "string" }) } });
    const result = documentedResponseFields(
      operation([
        { statusCode: "201", description: "", contentTypes: { "application/json": body }, examples: {} },
        { statusCode: "200", description: "", contentTypes: { "application/json": body }, examples: {} },
      ]),
    );
    expect(result.fields).toEqual([{ path: "id", type: "string", statusCodes: ["200", "201"] }]);
  });

  it("lists nothing for an empty constraint (a composed or unresolved schema), inventing no field", () => {
    expect(documentedResponseFields(operation([{ statusCode: "200", description: "", contentTypes: { "application/json": schema() }, examples: {} }])).fields).toEqual([]);
  });

  it("stops below depth 8 and caps the list at 300 fields, saying so", () => {
    let deep = schema({ type: "string" });
    for (let level = 0; level < 12; level++) deep = schema({ type: "object", properties: { n: deep } });
    expect(documentedResponseFields(operation([{ statusCode: "200", description: "", contentTypes: { "application/json": deep }, examples: {} }])).fields).toEqual([]);

    const properties = Object.fromEntries(Array.from({ length: MAX_RESPONSE_FIELDS + 5 }, (_, index) => [`f${String(index).padStart(3, "0")}`, schema({ type: "string" })]));
    const wide = documentedResponseFields(operation([{ statusCode: "200", description: "", contentTypes: { "application/json": schema({ type: "object", properties }) }, examples: {} }]));
    expect(wide.fields).toHaveLength(MAX_RESPONSE_FIELDS);
    expect(wide.truncated).toBe(true);
  });
});
