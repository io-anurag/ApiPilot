import { describe, expect, it } from "vitest";
import { mapUploadedResult } from "../../../src/externalCollections/mapUploadedResult";
import type { NewmanExecutionResult } from "../../../src/execution/mapNewmanResult";

const startedAt = new Date(0).toISOString();

describe("mapUploadedResult", () => {
  it("maps a passing execution with passing tests", () => {
    const execution: NewmanExecutionResult = {
      response: { code: 200, responseTime: 42 },
      assertions: [{ assertion: "Status code is 200", skipped: false }],
    };
    const result = mapUploadedResult("Get widget", "GET", execution, startedAt);
    expect(result).toMatchObject({
      requestName: "Get widget",
      requestMethod: "GET",
      outcome: "passed",
      durationMs: 42,
      responseStatusCode: 200,
      testOutcomes: [{ name: "Status code is 200", outcome: "passed" }],
    });
  });

  it("maps a mix of passing and failing tests as failed/assertion-failed", () => {
    const execution: NewmanExecutionResult = {
      response: { code: 500, responseTime: 10 },
      assertions: [
        { assertion: "Status code is 200", skipped: false, error: { name: "AssertionError", message: "expected 200, got 500" } },
        { assertion: "Body has id", skipped: false },
      ],
    };
    const result = mapUploadedResult("Create widget", "POST", execution, startedAt);
    expect(result.outcome).toBe("failed");
    expect(result.failureCategory).toBe("assertion-failed");
    expect(result.testOutcomes).toEqual([
      { name: "Status code is 200", outcome: "failed", detail: "expected 200, got 500" },
      { name: "Body has id", outcome: "passed" },
    ]);
  });

  it("reports an empty testOutcomes for a request with no test script, deriving outcome from status alone", () => {
    const execution: NewmanExecutionResult = { response: { code: 204, responseTime: 5 }, assertions: [] };
    const result = mapUploadedResult("Delete widget", "DELETE", execution, startedAt);
    expect(result).toMatchObject({ outcome: "passed", testOutcomes: [], responseStatusCode: 204 });
  });

  it("maps a connectivity failure", () => {
    const execution: NewmanExecutionResult = { requestError: { code: "ECONNREFUSED", message: "refused" } };
    const result = mapUploadedResult("Get widget", "GET", execution, startedAt);
    expect(result).toMatchObject({ outcome: "failed", failureCategory: "connectivity-failure", durationMs: 0 });
  });

  it("maps a timeout", () => {
    const execution: NewmanExecutionResult = { requestError: { code: "ESOCKETTIMEDOUT", message: "timed out" } };
    const result = mapUploadedResult("Get widget", "GET", execution, startedAt);
    expect(result.failureCategory).toBe("timeout");
  });

  it("attaches rawCapture only when captureRawDetails is true", () => {
    const execution: NewmanExecutionResult = {
      request: { url: { toString: () => "http://localhost/widgets" }, headers: { all: () => [] } },
      response: { code: 200, responseTime: 1, headers: { all: () => [] }, text: () => "{}" },
      assertions: [],
    };
    const withCapture = mapUploadedResult("Get widget", "GET", execution, startedAt, true);
    expect(withCapture.rawCapture).toBeDefined();
    const withoutCapture = mapUploadedResult("Get widget", "GET", execution, startedAt, false);
    expect(withoutCapture.rawCapture).toBeUndefined();
  });
});
