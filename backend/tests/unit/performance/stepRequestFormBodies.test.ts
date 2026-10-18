import { describe, expect, it } from "vitest";
import type { ApiOperation, TestScenario } from "@apipilot/shared-domain";
import { InvalidChainPlanError } from "../../../src/performance/errors";
import { buildStepRequest, planAuth, type PerformanceContext } from "../../../src/performance/plan/stepRequest";

/**
 * specs/056 FR-056 (contracts/postman-artifact-amendment.md section 4): a request-chain step reads a
 * generated urlencoded body as form fields and refuses a multipart body explicitly, naming the
 * operation, instead of dropping it or sending something else.
 */

function operation(path: string, contentType: string): ApiOperation {
  return {
    path,
    method: "POST",
    operationId: undefined,
    parameters: [],
    requestBody: { required: false, contentTypes: { [contentType]: { required: [], properties: {} } } },
    responses: [{ statusCode: "200", description: "", contentTypes: {}, examples: {} }],
    security: [],
    tags: [],
    provenance: { origin: "observed", observationCount: 3, confidence: "high" },
  };
}

function scenario(path: string, body: unknown): TestScenario {
  return {
    id: `s-${path}`,
    operationPath: path,
    operationMethod: "POST",
    category: "positive",
    request: { pathParameters: {}, queryParameters: {}, headers: {}, body },
    assertions: [{ type: "status-code", expectedStatusCode: "200", basis: "observed" }],
    provenance: { source: "RULE", rule: "observed-example-positive", description: "observed", duplicateOfRules: [] },
  };
}

function contextOf(operations: ApiOperation[], scenarios: TestScenario[]): PerformanceContext {
  return {
    apiModel: { operations, securitySchemes: {}, summary: { operationCount: operations.length, schemaCount: 0, securitySchemeCount: 0, issues: [] } },
    approvedScenarios: scenarios,
    workflows: [],
    relationships: [],
    source: "guided",
  };
}

describe("request-chain steps and form bodies", () => {
  it("reads a generated urlencoded body as form fields, keeping references unencoded", () => {
    const op = operation("/v1/import", "application/x-www-form-urlencoded");
    const sc = scenario("/v1/import", { source: "csv & more", client_secret: "[redacted:token]", note: "a=b" });
    const context = contextOf([op], [sc]);
    const built = buildStepRequest(context, planAuth(context), op, sc, {});
    expect(built.template.bodyKind).toBe("form");
    expect(built.template.body).toBe("source=csv%20%26%20more&client_secret={{token}}&note=a%3Db");
    expect(built.references).toContain("token");
    expect(built.secretNames.has("token")).toBe(true);
  });

  it("refuses a multipart body with an explicit message that names the operation", () => {
    const op = operation("/v1/attachments", "multipart/form-data");
    const sc = scenario("/v1/attachments", { title: "hello" });
    const context = contextOf([op], [sc]);
    const attempt = () => buildStepRequest(context, planAuth(context), op, sc, {});
    expect(attempt).toThrow(InvalidChainPlanError);
    expect(attempt).toThrow(/POST \/v1\/attachments uses a formdata body, which a request-chain plan cannot represent\. Leave that operation out of the plan\./);
  });

  it("is unchanged for a raw JSON body", () => {
    const op = operation("/v1/json", "application/json");
    const sc = scenario("/v1/json", { a: 1 });
    const context = contextOf([op], [sc]);
    const built = buildStepRequest(context, planAuth(context), op, sc, {});
    expect(built.template.bodyKind).toBe("json");
    expect(JSON.parse(built.template.body ?? "null")).toEqual({ a: 1 });
  });
});
