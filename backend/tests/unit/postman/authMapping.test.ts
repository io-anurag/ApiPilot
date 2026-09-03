import { describe, expect, it } from "vitest";
import type { ApiOperation, SecuritySchemeDefinition } from "@apipilot/shared-domain";
import { mapOperationAuth } from "../../../src/postman/authMapping";
import { exportApiModel } from "../../fixtures/postman/exportFixtures";

const schemes: Record<string, SecuritySchemeDefinition> = exportApiModel.securitySchemes;

function operation(overrides: Partial<ApiOperation>): ApiOperation {
  return {
    path: "/things",
    method: "GET",
    operationId: undefined,
    parameters: [],
    requestBody: undefined,
    responses: [],
    security: [],
    tags: [],
    ...overrides,
  };
}

function requiring(name: string): ApiOperation {
  return operation({ security: [{ schemes: [{ name, scopes: [] }] }] });
}

describe("mapOperationAuth", () => {
  it("configures no auth for an operation that declares none", () => {
    const mapping = mapOperationAuth(operation({}), schemes);
    expect(mapping.auth).toBeUndefined();
    expect(mapping.limitations).toEqual([]);
    expect(mapping.variables).toEqual([]);
  });

  it("maps http/bearer to bearer auth using a token variable", () => {
    const mapping = mapOperationAuth(requiring("bearerAuth"), schemes);
    expect(mapping.auth).toEqual({
      type: "bearer",
      bearer: [{ key: "token", value: "{{token}}", type: "string" }],
    });
    expect(mapping.variables.map((variable) => variable.name)).toEqual(["token"]);
    expect(mapping.variables.every((variable) => variable.secret)).toBe(true);
  });

  it("maps http/basic to basic auth using username and password variables", () => {
    const mapping = mapOperationAuth(requiring("basicAuth"), schemes);
    expect(mapping.auth).toEqual({
      type: "basic",
      basic: [
        { key: "username", value: "{{username}}", type: "string" },
        { key: "password", value: "{{password}}", type: "string" },
      ],
    });
    expect(mapping.variables.map((variable) => variable.name)).toEqual(["username", "password"]);
  });

  it("maps apiKey auth carrying the declared parameter name and location", () => {
    const mapping = mapOperationAuth(requiring("apiKeyAuth"), schemes);
    expect(mapping.auth).toEqual({
      type: "apikey",
      apikey: [
        { key: "key", value: "X-Api-Key", type: "string" },
        { key: "value", value: "{{apiKey}}", type: "string" },
        { key: "in", value: "header", type: "string" },
      ],
    });
  });

  it("configures nothing for oauth2 and records it as a limitation", () => {
    const mapping = mapOperationAuth(requiring("oauth2Auth"), schemes);
    expect(mapping.auth).toBeUndefined();
    expect(mapping.variables).toEqual([]);
    expect(mapping.limitations).toEqual([
      expect.objectContaining({ kind: "unsupported-auth-scheme" }),
    ]);
    expect(mapping.limitations[0].message).toContain("oauth2");
  });

  it("records a limitation for a scheme the specification does not define", () => {
    const mapping = mapOperationAuth(requiring("absentScheme"), schemes);
    expect(mapping.auth).toBeUndefined();
    expect(mapping.limitations[0].kind).toBe("unsupported-auth-scheme");
  });

  it("uses the first declared requirement set and records which one was applied", () => {
    const operationWithAlternatives = operation({
      security: [
        { schemes: [{ name: "basicAuth", scopes: [] }] },
        { schemes: [{ name: "bearerAuth", scopes: [] }] },
      ],
    });
    const mapping = mapOperationAuth(operationWithAlternatives, schemes);
    expect(mapping.auth?.type).toBe("basic");
    expect(mapping.limitations).toContainEqual(
      expect.objectContaining({ kind: "alternative-auth-requirement-selected" }),
    );
    expect(mapping.limitations[0].message).toContain("basicAuth");
  });

  it("records a limitation when one requirement set demands several schemes at once", () => {
    const mapping = mapOperationAuth(
      operation({
        security: [
          {
            schemes: [
              { name: "bearerAuth", scopes: [] },
              { name: "apiKeyAuth", scopes: [] },
            ],
          },
        ],
      }),
      schemes,
    );
    expect(mapping.auth?.type).toBe("bearer");
    expect(mapping.limitations).toContainEqual(
      expect.objectContaining({ kind: "unsupported-auth-scheme" }),
    );
  });

  it("never invents an authentication mechanism the specification does not declare", () => {
    const mapping = mapOperationAuth(requiring("oauth2Auth"), schemes);
    expect(JSON.stringify(mapping.auth ?? null)).not.toContain("bearer");
  });
});
