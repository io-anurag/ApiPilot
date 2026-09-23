import type { FailureCause, RawRequestCapture, UploadedRequestResult } from "@apipilot/shared-domain";
import { connectivityFailure, failedResult } from "./fixtures";
import { CREATE_STEP_ITEM_ID } from "./workflowFixtures";

/**
 * Labelled evaluation corpus for AP-031 (specs/030-ai-failure-analysis research D11, constitution
 * XXII). Used only by the opt-in real-model evaluation (`failureAnalysis.real.test.ts`).
 *
 * `origin: "real"` cases must come from real recorded, redacted runs (tasks.md T055). None are
 * included yet: no real recorded run was available when this corpus was written, and inventing one
 * would defeat the point. See `specs/030-ai-failure-analysis/evaluation.md`.
 */
export interface EvaluationCase {
  id: string;
  origin: "real" | "synthetic";
  expected: FailureCause | "insufficient-evidence";
  result: UploadedRequestResult;
  /** Analyze against the users-API guided-workflow fixture (matched specification context). */
  withWorkflow?: boolean;
}

function capture(overrides: Partial<RawRequestCapture>): RawRequestCapture {
  return {
    requestUrl: "http://api.example.test/users",
    requestHeaders: [{ key: "Content-Type", value: "application/json" }],
    responseHeaders: [{ key: "Content-Type", value: "application/json" }],
    ...overrides,
  };
}

function failedTest(name: string, detail?: string) {
  return [{ name, outcome: "failed" as const, ...(detail ? { detail } : {}) }];
}

export const EVALUATION_CORPUS: readonly EvaluationCase[] = [
  {
    id: "env-connection-refused",
    origin: "synthetic",
    expected: "environment-issue",
    result: connectivityFailure({ requestName: "List users" }),
  },
  {
    id: "env-timeout",
    origin: "synthetic",
    expected: "environment-issue",
    result: connectivityFailure({ requestName: "List users", failureCategory: "timeout" }),
  },
  {
    id: "env-gateway-502",
    origin: "synthetic",
    expected: "environment-issue",
    result: failedResult({
      requestName: "List users",
      requestMethod: "GET",
      responseStatusCode: 502,
      testOutcomes: failedTest("Status code is 200", "expected response to have status code 200 but got 502"),
      rawCapture: capture({
        responseHeaders: [{ key: "Content-Type", value: "text/html" }],
        responseBody: "<html><body><h1>502 Bad Gateway</h1>nginx: no live upstreams for host api.example.test</body></html>",
      }),
    }),
  },
  {
    id: "env-bad-credentials-401",
    origin: "synthetic",
    expected: "environment-issue",
    result: failedResult({
      requestName: "List users",
      requestMethod: "GET",
      responseStatusCode: 401,
      testOutcomes: failedTest("Status code is 200", "expected response to have status code 200 but got 401"),
      rawCapture: capture({ responseBody: JSON.stringify({ error: "invalid_client", message: "The API key is not valid for this environment" }) }),
    }),
  },
  {
    id: "spec-200-instead-of-documented-201",
    origin: "synthetic",
    expected: "specification-mismatch",
    withWorkflow: true,
    result: failedResult({
      itemId: CREATE_STEP_ITEM_ID,
      responseStatusCode: 200,
      testOutcomes: failedTest("Status code is 201", "expected response to have status code 201 but got 200"),
      rawCapture: capture({ requestBody: JSON.stringify({ displayName: "Ada" }), responseBody: JSON.stringify({ id: "u-1", name: "Ada" }) }),
    }),
  },
  {
    id: "spec-missing-required-field",
    origin: "synthetic",
    expected: "specification-mismatch",
    result: failedResult({
      requestName: "Get user",
      requestMethod: "GET",
      responseStatusCode: 200,
      testOutcomes: [
        { name: "Status code is 200", outcome: "passed" },
        { name: "Response matches schema", outcome: "failed", detail: "data should have required property 'name'" },
      ],
      rawCapture: capture({ requestUrl: "http://api.example.test/users/u-1", responseBody: JSON.stringify({ id: "u-1" }) }),
    }),
  },
  {
    id: "spec-wrong-content-type",
    origin: "synthetic",
    expected: "specification-mismatch",
    result: failedResult({
      requestName: "Get user",
      requestMethod: "GET",
      responseStatusCode: 200,
      testOutcomes: [
        { name: "Status code is 200", outcome: "passed" },
        { name: "Content-Type is application/json", outcome: "failed", detail: "expected 'text/plain' to include 'application/json'" },
      ],
      rawCapture: capture({
        requestUrl: "http://api.example.test/users/u-1",
        responseHeaders: [{ key: "Content-Type", value: "text/plain" }],
        responseBody: "id=u-1;name=Ada",
      }),
    }),
  },
  {
    id: "spec-400-on-documented-request",
    origin: "synthetic",
    expected: "specification-mismatch",
    withWorkflow: true,
    result: failedResult({
      itemId: CREATE_STEP_ITEM_ID,
      responseStatusCode: 400,
      testOutcomes: failedTest("Status code is 201", "expected response to have status code 201 but got 400"),
      rawCapture: capture({
        requestBody: JSON.stringify({ displayName: "Ada" }),
        responseBody: JSON.stringify({ error: "unknown field 'displayName'; expected 'name'" }),
      }),
    }),
  },
  {
    id: "downstream-503",
    origin: "synthetic",
    expected: "downstream-service-issue",
    result: failedResult({
      requestName: "Create order",
      responseStatusCode: 503,
      testOutcomes: failedTest("Status code is 201", "expected response to have status code 201 but got 503"),
      rawCapture: capture({
        requestUrl: "http://api.example.test/orders",
        responseBody: JSON.stringify({ error: "Service Unavailable", detail: "payment-service did not respond" }),
      }),
    }),
  },
  {
    id: "downstream-500-dependency",
    origin: "synthetic",
    expected: "downstream-service-issue",
    result: failedResult({
      requestName: "Get stock",
      requestMethod: "GET",
      responseStatusCode: 500,
      testOutcomes: failedTest("Status code is 200", "expected response to have status code 200 but got 500"),
      rawCapture: capture({
        requestUrl: "http://api.example.test/stock/sku-1",
        responseBody: JSON.stringify({ error: "Internal error calling inventory-service: connection refused" }),
      }),
    }),
  },
  {
    id: "insufficient-bare-500",
    origin: "synthetic",
    expected: "insufficient-evidence",
    result: failedResult({ requestName: "Update user", requestMethod: "PUT", testOutcomes: failedTest("Status code is 200") }),
  },
  {
    id: "insufficient-bare-assertion",
    origin: "synthetic",
    expected: "insufficient-evidence",
    result: failedResult({
      requestName: "Get user",
      requestMethod: "GET",
      responseStatusCode: 200,
      testOutcomes: failedTest("Check response"),
    }),
  },
];
