import { describe, expect, it } from "vitest";
import type { ApiModel, Environment, TestModel } from "@apipilot/shared-domain";
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

/** One approved scenario per listed operation — `operationMethod` exactly as given. */
function approvedFor(operations: Array<{ path: string; method: string }>): TestModel {
  return {
    scenarios: operations.map((operation, index) => ({
      id: `scenario-${index}`,
      category: "positive",
      operationPath: operation.path,
      operationMethod: operation.method,
      request: { pathParameters: {}, queryParameters: {}, headers: {} },
      assertions: [],
      provenance: { source: "RULE", rule: "positive", description: "d", duplicateOfRules: [] },
    })),
  };
}

/** Every operation in `model` approved — the pre-specs/029 cases' implicit assumption. */
function approvedAll(model: ApiModel): TestModel {
  return approvedFor(model.operations);
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
    expect(destructiveOperations(model, approvedAll(model))).toEqual([
      { operationPath: "/things/1", operationMethod: "POST" },
      { operationPath: "/things/2", operationMethod: "PUT" },
      { operationPath: "/things/3", operationMethod: "PATCH" },
      { operationPath: "/things/4", operationMethod: "DELETE" },
    ]);
  });

  it("omits a destructive operation that has no approved scenario (specs/029 FR-011)", () => {
    const model = apiModel(["GET", "DELETE"]);
    expect(destructiveOperations(model, approvedFor([{ path: "/things/0", method: "GET" }]))).toEqual([]);
  });

  it("lists an operation once even when several approved scenarios target it (specs/029 FR-011)", () => {
    const model = apiModel(["POST"]);
    const approved = approvedFor([
      { path: "/things/0", method: "POST" },
      { path: "/things/0", method: "POST" },
    ]);
    expect(destructiveOperations(model, approved)).toEqual([{ operationPath: "/things/0", operationMethod: "POST" }]);
  });

  it("keeps ApiModel order, not approved-scenario order", () => {
    const model = apiModel(["DELETE", "POST"]);
    const approved = approvedFor([
      { path: "/things/1", method: "POST" },
      { path: "/things/0", method: "DELETE" },
    ]);
    expect(destructiveOperations(model, approved)).toEqual([
      { operationPath: "/things/0", operationMethod: "DELETE" },
      { operationPath: "/things/1", operationMethod: "POST" },
    ]);
  });

  it("matches the approved scenario's method case-insensitively", () => {
    const model = apiModel(["DELETE"]);
    expect(destructiveOperations(model, approvedFor([{ path: "/things/0", method: "delete" }]))).toEqual([
      { operationPath: "/things/0", operationMethod: "DELETE" },
    ]);
  });
});

describe("confirmationRequirement", () => {
  it("requires no confirmation for a local/dev/qa environment with no destructive operations", () => {
    const model = apiModel(["GET"]);
    expect(confirmationRequirement(model, approvedAll(model), environment({ tier: "local" }))).toBeUndefined();
    expect(confirmationRequirement(model, approvedAll(model), environment({ tier: "qa" }))).toBeUndefined();
  });

  it("requires confirmation for staging/production regardless of destructive operations", () => {
    const model = apiModel(["GET"]);
    const requirement = confirmationRequirement(model, approvedAll(model), environment({ tier: "staging" }));
    expect(requirement).toEqual({ environmentTier: "staging", destructiveOperations: [] });
  });

  it("requires confirmation for a low-risk tier when destructive operations are present", () => {
    const model = apiModel(["GET", "DELETE"]);
    const requirement = confirmationRequirement(model, approvedAll(model), environment({ tier: "local" }));
    expect(requirement).toEqual({
      environmentTier: "local",
      destructiveOperations: [{ operationPath: "/things/1", operationMethod: "DELETE" }],
    });
  });

  it("requires no confirmation on local/dev/qa when only GET scenarios are approved, even though the specification has a DELETE (specs/029 FR-013)", () => {
    const model = apiModel(["GET", "DELETE"]);
    const getOnly = approvedFor([{ path: "/things/0", method: "GET" }]);
    for (const tier of ["local", "dev", "qa"] as const) {
      expect(confirmationRequirement(model, getOnly, environment({ tier }))).toBeUndefined();
    }
  });

  it("still requires confirmation on staging/production when only GET scenarios are approved, listing nothing (specs/029 FR-012)", () => {
    const model = apiModel(["GET", "DELETE"]);
    const getOnly = approvedFor([{ path: "/things/0", method: "GET" }]);
    for (const tier of ["staging", "production"] as const) {
      expect(confirmationRequirement(model, getOnly, environment({ tier }))).toEqual({
        environmentTier: tier,
        destructiveOperations: [],
      });
    }
  });
});
