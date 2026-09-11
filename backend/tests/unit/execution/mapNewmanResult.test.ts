import { describe, expect, it } from "vitest";
import type { TestScenario } from "@apipilot/shared-domain";
import { mapNewmanResult, type NewmanExecutionResult } from "../../../src/execution/mapNewmanResult";

function scenario(assertions: TestScenario["assertions"]): TestScenario {
  return {
    id: "scenario-1",
    operationPath: "/pets",
    operationMethod: "POST",
    category: "positive",
    request: { pathParameters: {}, queryParameters: {}, headers: {} },
    assertions,
    provenance: { source: "RULE", rule: "positive", description: "d", duplicateOfRules: [] },
  };
}

const statusAndSchema = scenario([
  { type: "status-code", expectedStatusCode: "201" },
  { type: "schema-conformance", expectedSchema: { type: "object", required: [], properties: {} } },
]);

const startedAt = new Date(0).toISOString();

describe("mapNewmanResult", () => {
  it("maps a fully passing execution to outcome passed", () => {
    const execution: NewmanExecutionResult = {
      response: { code: 201, responseTime: 42 },
      assertions: [
        { assertion: "Status code is 201", skipped: false },
        { assertion: "Response body conforms to the documented schema", skipped: false },
      ],
    };
    const result = mapNewmanResult(statusAndSchema, execution, startedAt);
    expect(result.outcome).toBe("passed");
    expect(result.failureCategory).toBeUndefined();
    expect(result.responseStatusCode).toBe(201);
    expect(result.durationMs).toBe(42);
    expect(result.assertionOutcomes).toEqual([
      { assertionIndex: 0, type: "status-code", outcome: "passed" },
      { assertionIndex: 1, type: "schema-conformance", outcome: "passed" },
    ]);
  });

  it("maps a failing status-code assertion to unexpected-status", () => {
    const execution: NewmanExecutionResult = {
      response: { code: 500, responseTime: 10 },
      assertions: [
        {
          assertion: "Status code is 201",
          skipped: false,
          error: { name: "AssertionError", message: "expected response to have status code 201 but got 500" },
        },
        { assertion: "Response body conforms to the documented schema", skipped: false },
      ],
    };
    const result = mapNewmanResult(statusAndSchema, execution, startedAt);
    expect(result.outcome).toBe("failed");
    expect(result.failureCategory).toBe("unexpected-status");
    expect(result.assertionOutcomes[0]).toMatchObject({ outcome: "failed" });
    expect(result.assertionOutcomes[0].detail).toContain("201");
  });

  it("maps a failing schema-conformance assertion to assertion-failed", () => {
    const execution: NewmanExecutionResult = {
      response: { code: 201, responseTime: 10 },
      assertions: [
        { assertion: "Status code is 201", skipped: false },
        {
          assertion: "Response body conforms to the documented schema",
          skipped: false,
          error: {
            name: "AssertionError",
            message: "expected data to satisfy schema but found following errors: \ndata.name should be string",
          },
        },
      ],
    };
    const result = mapNewmanResult(statusAndSchema, execution, startedAt);
    expect(result.outcome).toBe("failed");
    expect(result.failureCategory).toBe("assertion-failed");
    expect(result.assertionOutcomes[1].detail).toContain("should be string");
  });

  it("redacts a schema-failure detail that names a credential-like field, never surfacing it verbatim (FR-017)", () => {
    const execution: NewmanExecutionResult = {
      response: { code: 201, responseTime: 10 },
      assertions: [
        { assertion: "Status code is 201", skipped: false },
        {
          assertion: "Response body conforms to the documented schema",
          skipped: false,
          error: {
            name: "AssertionError",
            message:
              "expected data to satisfy schema but found following errors: \ndata.apiKey should be string",
          },
        },
      ],
    };
    const result = mapNewmanResult(statusAndSchema, execution, startedAt);
    expect(result.assertionOutcomes[1].detail).not.toContain("apiKey");
    expect(result.assertionOutcomes[1].detail).toBeTruthy();
  });

  it("maps an unparseable response body to could-not-evaluate rather than assertion-failed", () => {
    const execution: NewmanExecutionResult = {
      response: { code: 201, responseTime: 10 },
      assertions: [
        { assertion: "Status code is 201", skipped: false },
        {
          assertion: "Response body conforms to the documented schema",
          skipped: false,
          error: { name: "JSONError", message: "Unexpected token 'n' at 1:1\nnot json at all\n^" },
        },
      ],
    };
    const result = mapNewmanResult(statusAndSchema, execution, startedAt);
    expect(result.outcome).toBe("failed");
    expect(result.failureCategory).toBe("could-not-evaluate");
    // Never echoes the raw response body snippet Newman's own JSONError message carries (FR-017).
    expect(result.assertionOutcomes[1].detail).not.toContain("not json at all");
  });

  it("maps a connection-level failure to connectivity-failure without inspecting assertions", () => {
    const execution: NewmanExecutionResult = {
      requestError: { code: "ECONNREFUSED", message: "connect ECONNREFUSED 127.0.0.1:1" },
      assertions: [
        { assertion: "Status code is 201", skipped: false, error: { name: "AssertionError", message: "..." } },
      ],
    };
    const result = mapNewmanResult(statusAndSchema, execution, startedAt);
    expect(result.outcome).toBe("failed");
    expect(result.failureCategory).toBe("connectivity-failure");
    expect(result.responseStatusCode).toBeUndefined();
    expect(result.assertionOutcomes).toEqual([]);
  });

  it("maps a timed-out request to timeout, not connectivity-failure", () => {
    const execution: NewmanExecutionResult = {
      requestError: { code: "ESOCKETTIMEDOUT", message: "ESOCKETTIMEDOUT" },
    };
    const result = mapNewmanResult(statusAndSchema, execution, startedAt);
    expect(result.failureCategory).toBe("timeout");
  });

  it("treats a scenario with no expressible assertions as passed", () => {
    const bare = scenario([]);
    const execution: NewmanExecutionResult = { response: { code: 200, responseTime: 5 } };
    const result = mapNewmanResult(bare, execution, startedAt);
    expect(result.outcome).toBe("passed");
    expect(result.assertionOutcomes).toEqual([]);
  });
});
