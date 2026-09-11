import { describe, expect, it } from "vitest";
import type { ApiModel, Environment } from "@apipilot/shared-domain";
import { confirmationRequirement, destructiveOperations } from "../../../src/execution/destructiveOperations";

function apiModel(methods: string[]): ApiModel {
  return {
    operations: methods.map((method, index) => ({
      path: `/things/${index}`,
      method,
      operationId: `op-${index}`,
      tags: [],
      parameters: [],
      responses: [],
      security: [],
    })) as unknown as ApiModel["operations"],
    securitySchemes: {},
    summary: { operationCount: methods.length, schemaCount: 0, securitySchemeCount: 0, issues: [] },
  };
}

function environment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: "env-1",
    name: "Local",
    tier: "local",
    baseUrl: "http://localhost:4000",
    variableValues: {},
    requestDelayMs: 0,
    ...overrides,
  };
}

describe("destructiveOperations", () => {
  it("names every POST/PUT/PATCH/DELETE operation, excluding GET/HEAD/OPTIONS", () => {
    const model = apiModel(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
    expect(destructiveOperations(model)).toEqual([
      { operationPath: "/things/1", operationMethod: "POST" },
      { operationPath: "/things/2", operationMethod: "PUT" },
      { operationPath: "/things/3", operationMethod: "PATCH" },
      { operationPath: "/things/4", operationMethod: "DELETE" },
    ]);
  });
});

describe("confirmationRequirement", () => {
  it("requires no confirmation for a local/dev/qa environment with no destructive operations", () => {
    const model = apiModel(["GET"]);
    expect(confirmationRequirement(model, environment({ tier: "local" }))).toBeUndefined();
    expect(confirmationRequirement(model, environment({ tier: "qa" }))).toBeUndefined();
  });

  it("requires confirmation for staging/production regardless of destructive operations", () => {
    const model = apiModel(["GET"]);
    const requirement = confirmationRequirement(model, environment({ tier: "staging" }));
    expect(requirement).toEqual({ environmentTier: "staging", destructiveOperations: [] });
  });

  it("requires confirmation for a low-risk tier when destructive operations are present", () => {
    const model = apiModel(["GET", "DELETE"]);
    const requirement = confirmationRequirement(model, environment({ tier: "local" }));
    expect(requirement).toEqual({
      environmentTier: "local",
      destructiveOperations: [{ operationPath: "/things/1", operationMethod: "DELETE" }],
    });
  });
});
