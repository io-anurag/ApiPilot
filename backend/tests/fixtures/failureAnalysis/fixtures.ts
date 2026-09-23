import type {
  AIErrorCategory,
  AIProvider,
  FailureAnalysis,
  InferenceHooks,
  InferenceRequest,
  InferenceResponse,
  RawRequestCapture,
  UploadedRequestResult,
} from "@apipilot/shared-domain";
import { FAILURE_ANALYSIS_RESPONSE_VERSION } from "../../../src/failureAnalysis/failureAnalysisPrompt";

/** Values that must never survive redaction (SC-003). */
export const SECRET_VALUES = ["SECRET1", "SECRET2", "abc.def.ghi"] as const;

export function failedResult(overrides: Partial<UploadedRequestResult> = {}): UploadedRequestResult {
  return {
    requestName: "Create user",
    requestMethod: "POST",
    outcome: "failed",
    failureCategory: "assertion-failed",
    startedAt: new Date(0).toISOString(),
    durationMs: 120,
    responseStatusCode: 500,
    testOutcomes: [
      { name: "Status code is 201", outcome: "failed", detail: "expected response to have status code 201 but got 500" },
    ],
    ...overrides,
  };
}

export function connectivityFailure(overrides: Partial<UploadedRequestResult> = {}): UploadedRequestResult {
  return {
    requestName: "Get user",
    requestMethod: "GET",
    outcome: "failed",
    failureCategory: "connectivity-failure",
    startedAt: new Date(0).toISOString(),
    durationMs: 0,
    testOutcomes: [],
    ...overrides,
  };
}

export function rawCaptureWithSecrets(): RawRequestCapture {
  return {
    requestUrl: "http://localhost:4010/users?api_key=SECRET1&page=2",
    requestHeaders: [
      { key: "Authorization", value: "Bearer abc.def.ghi" },
      { key: "Content-Type", value: "application/json" },
    ],
    requestBody: JSON.stringify({ user: "u", password: "SECRET2", nested: [{ token: "SECRET1" }] }),
    responseHeaders: [{ key: "Content-Type", value: "application/json" }],
    responseBody: JSON.stringify({ error: "Internal Server Error", detail: "database unavailable" }),
  };
}

export function withRawCapture(
  result: UploadedRequestResult,
  capture: RawRequestCapture = rawCaptureWithSecrets(),
): UploadedRequestResult {
  return { ...result, rawCapture: capture };
}

export interface ScriptedProvider extends AIProvider {
  readonly requests: InferenceRequest[];
}

/** A realistic `AIProvider` stand-in: `MockProvider` only ever returns a hash (research D11). */
export function scriptedProvider(
  contents: string[] | ((request: InferenceRequest) => string),
  options: { inputBudget?: number; delayMs?: number; modelId?: string } = {},
): ScriptedProvider {
  const requests: InferenceRequest[] = [];
  let call = 0;
  return {
    mode: "local",
    requests,
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: new Date(0).toISOString(),
    }),
    getInputBudget: async () => options.inputBudget,
    async infer(request: InferenceRequest, hooks?: InferenceHooks): Promise<InferenceResponse> {
      requests.push(request);
      hooks?.onStarted?.();
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      const content = typeof contents === "function" ? contents(request) : contents[Math.min(call, contents.length - 1)];
      call += 1;
      return {
        contractVersion: 1,
        requestId: request.requestId,
        status: "success",
        content,
        modelId: options.modelId ?? "test-model",
        provider: "local",
        durationMs: 1,
      };
    },
  };
}

export function failingProvider(category: AIErrorCategory): ScriptedProvider {
  const requests: InferenceRequest[] = [];
  return {
    mode: "local",
    requests,
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: new Date(0).toISOString(),
    }),
    getInputBudget: async () => undefined,
    async infer(request: InferenceRequest, hooks?: InferenceHooks): Promise<InferenceResponse> {
      requests.push(request);
      hooks?.onStarted?.();
      return {
        contractVersion: 1,
        requestId: request.requestId,
        status: "error",
        errorCategory: category,
        errorMessage: "provider failure detail that must not reach the user verbatim",
        modelId: "test-model",
        provider: "local",
        durationMs: 1,
      };
    },
  };
}

/** A valid model answer citing the given evidence ids. */
export function modelAnswer(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    responseVersion: FAILURE_ANALYSIS_RESPONSE_VERSION,
    cause: "environment-issue",
    confidence: 0.72,
    summary: "The service returned 500 because a dependency was unavailable.",
    evidenceIds: ["E1", "E2"],
    steps: ["Check the database connection used by the service."],
    ...overrides,
  });
}

export function sampleAnalysis(overrides: Partial<FailureAnalysis> = {}): FailureAnalysis {
  return {
    runId: "run-1",
    resultIndex: 0,
    requestName: "Create user",
    requestMethod: "POST",
    conclusion: { kind: "likely-cause", cause: "environment-issue", confidence: 0.72 },
    summary: "A summary that must stay encrypted at rest.",
    investigationSteps: ["Check the database."],
    citedEvidenceIds: ["E1"],
    evidence: [{ id: "E1", kind: "failure-category", source: "run-result", text: "Request failed: assertion failed" }],
    specificationContext: { status: "unavailable", reason: "no-request-identity" },
    provenance: {
      source: "AI",
      aiModel: "test-model",
      aiProvider: "local",
      responseVersion: 1,
      confidenceThreshold: 0.5,
      generatedAt: new Date(0).toISOString(),
    },
    ...overrides,
  };
}
