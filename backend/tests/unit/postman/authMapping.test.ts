import { describe, expect, it } from "vitest";
import type { ApiOperation, SecuritySchemeDefinition } from "@apipilot/shared-domain";
import { mapOperationAuth, planSchemeVariables } from "../../../src/postman/authMapping";
import { exportApiModel } from "../../fixtures/postman/exportFixtures";
import {
  adminAuthOperation,
  bearerAuthOperation,
  noSuffixSchemes,
  twoApiKeySchemesSameHeader,
  twoBearerSchemes,
} from "../../fixtures/postman/credentialFixtures";

const schemes: Record<string, SecuritySchemeDefinition> = exportApiModel.securitySchemes;
const plan = planSchemeVariables(schemes);

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

describe("planSchemeVariables", () => {
  it("keeps the first-declared scheme of a type primary with the legacy variable name", () => {
    const twoBearerPlan = planSchemeVariables(twoBearerSchemes);
    expect(twoBearerPlan.get("bearerAuth")).toEqual({
      type: "bearer",
      isPrimary: true,
      stem: "bearer",
      variableNames: { token: "token" },
    });
  });

  it("derives a non-primary scheme's name from its own key by stripping a trailing Auth/Scheme suffix", () => {
    const twoBearerPlan = planSchemeVariables(twoBearerSchemes);
    expect(twoBearerPlan.get("adminAuth")).toEqual({
      type: "bearer",
      isPrimary: false,
      stem: "admin",
      variableNames: { token: "adminToken" },
    });
  });

  it("appends the type suffix to the full key when it carries no Auth/Scheme suffix", () => {
    const noSuffixPlan = planSchemeVariables(noSuffixSchemes);
    expect(noSuffixPlan.get("partnerCredential")).toEqual({
      type: "bearer",
      isPrimary: false,
      stem: "partnerCredential",
      variableNames: { token: "partnerCredentialToken" },
    });
  });

  it("gives two same-header-name apiKey schemes distinct keys and variable names", () => {
    const apiKeyPlan = planSchemeVariables(twoApiKeySchemesSameHeader);
    expect(apiKeyPlan.get("apiKeyAuth")).toEqual({
      type: "apiKey",
      isPrimary: true,
      stem: "apiKey",
      variableNames: { apiKey: "apiKey" },
    });
    expect(apiKeyPlan.get("partnerApiKeyAuth")).toEqual({
      type: "apiKey",
      isPrimary: false,
      stem: "partnerApiKey",
      variableNames: { apiKey: "partnerApiKeyApiKey" },
    });
  });

  it("treats a single scheme of a type as the trivial one-element primary case", () => {
    expect(plan.get("bearerAuth")?.isPrimary).toBe(true);
    expect(plan.get("basicAuth")?.isPrimary).toBe(true);
    expect(plan.get("apiKeyAuth")?.isPrimary).toBe(true);
  });

  it("omits a scheme whose type this export cannot configure", () => {
    expect(plan.has("oauth2Auth")).toBe(false);
  });
});

describe("mapOperationAuth", () => {
  it("configures no auth for an operation that declares none", () => {
    const mapping = mapOperationAuth(operation({}), schemes, plan);
    expect(mapping.auth).toBeUndefined();
    expect(mapping.limitations).toEqual([]);
    expect(mapping.variables).toEqual([]);
  });

  it("maps http/bearer to bearer auth using a token variable", () => {
    const mapping = mapOperationAuth(requiring("bearerAuth"), schemes, plan);
    expect(mapping.auth).toEqual({
      type: "bearer",
      bearer: [{ key: "token", value: "{{token}}", type: "string" }],
    });
    expect(mapping.variables.map((variable) => variable.name)).toEqual(["token"]);
    expect(mapping.variables.every((variable) => variable.secret)).toBe(true);
  });

  it("maps http/basic to basic auth using username and password variables", () => {
    const mapping = mapOperationAuth(requiring("basicAuth"), schemes, plan);
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
    const mapping = mapOperationAuth(requiring("apiKeyAuth"), schemes, plan);
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
    const mapping = mapOperationAuth(requiring("oauth2Auth"), schemes, plan);
    expect(mapping.auth).toBeUndefined();
    expect(mapping.variables).toEqual([]);
    expect(mapping.limitations).toEqual([
      expect.objectContaining({ kind: "unsupported-auth-scheme" }),
    ]);
    expect(mapping.limitations[0].message).toContain("oauth2");
  });

  it("records a limitation for a scheme the specification does not define", () => {
    const mapping = mapOperationAuth(requiring("absentScheme"), schemes, plan);
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
    const mapping = mapOperationAuth(operationWithAlternatives, schemes, plan);
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
      plan,
    );
    expect(mapping.auth?.type).toBe("bearer");
    expect(mapping.limitations).toContainEqual(
      expect.objectContaining({ kind: "unsupported-auth-scheme" }),
    );
  });

  it("never invents an authentication mechanism the specification does not declare", () => {
    const mapping = mapOperationAuth(requiring("oauth2Auth"), schemes, plan);
    expect(JSON.stringify(mapping.auth ?? null)).not.toContain("bearer");
  });

  describe("distinct-credential schemes (specs/021-multi-credential-token-provisioning)", () => {
    const twoBearerPlan = planSchemeVariables(twoBearerSchemes);

    it("routes the primary scheme's operation to the legacy {{token}} variable", () => {
      const mapping = mapOperationAuth(bearerAuthOperation, twoBearerSchemes, twoBearerPlan);
      expect(mapping.auth).toEqual({
        type: "bearer",
        bearer: [{ key: "token", value: "{{token}}", type: "string" }],
      });
      expect(mapping.variables.map((variable) => variable.name)).toEqual(["token"]);
    });

    it("routes the distinct scheme's operation to its own derived variable, not {{token}}", () => {
      const mapping = mapOperationAuth(adminAuthOperation, twoBearerSchemes, twoBearerPlan);
      expect(mapping.auth).toEqual({
        type: "bearer",
        bearer: [{ key: "token", value: "{{adminToken}}", type: "string" }],
      });
      expect(mapping.variables.map((variable) => variable.name)).toEqual(["adminToken"]);
      expect(mapping.limitations).toEqual([]);
    });

    it("ignores tag names entirely: two operations sharing one scheme key resolve to the same variable regardless of an \"Admin\" tag (FR-005, FR-008)", () => {
      const untaggedOperation = operation({
        path: "/reports/summary",
        security: [{ schemes: [{ name: "adminAuth", scopes: [] }] }],
        tags: [],
      });
      const adminTaggedOperation = operation({
        path: "/reports/detail",
        security: [{ schemes: [{ name: "adminAuth", scopes: [] }] }],
        tags: ["Admin"],
      });

      const untaggedMapping = mapOperationAuth(untaggedOperation, twoBearerSchemes, twoBearerPlan);
      const taggedMapping = mapOperationAuth(adminTaggedOperation, twoBearerSchemes, twoBearerPlan);

      // Same scheme key ("adminAuth") ⇒ same variable, whether or not either operation carries an
      // "Admin" tag. Nothing in planSchemeVariables/mapOperationAuth ever reads operation.tags.
      expect(taggedMapping.auth).toEqual(untaggedMapping.auth);
      expect(taggedMapping.variables.map((variable) => variable.name)).toEqual(
        untaggedMapping.variables.map((variable) => variable.name),
      );
      expect(taggedMapping.variables.map((variable) => variable.name)).toEqual(["adminToken"]);
    });
  });
});
