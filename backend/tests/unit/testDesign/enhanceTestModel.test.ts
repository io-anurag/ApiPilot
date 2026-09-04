import { describe, expect, it } from "vitest";
import type {
  AIProvider,
  InferenceRequest,
  InferenceResponse,
} from "@apipilot/shared-domain";
import {
  aiScenarioApiModel,
  aiScenarioBaseline,
  buildLargeAiScenarioApiModel,
} from "../../fixtures/testDesign/aiScenarioDesignerFixtures";
import { enhanceTestModel } from "../../../src/testDesign/enhanceTestModel";
import { buildAIScenarioPrompt } from "../../../src/testDesign/aiScenarioPrompt";

function provider(content: string): AIProvider {
  return {
    mode: "mock",
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    getInputBudget: async () => undefined,
    infer: async (request): Promise<InferenceResponse> => ({
      contractVersion: 1,
      requestId: request.requestId,
      status: "success",
      content,
      modelId: "test-model",
      provider: "mock",
      durationMs: 0,
    }),
  };
}

const emptyCandidatesContent = JSON.stringify({ responseVersion: 1, candidates: [] });

function successResponse(request: InferenceRequest): InferenceResponse {
  return {
    contractVersion: 1,
    requestId: request.requestId,
    status: "success",
    content: emptyCandidatesContent,
    modelId: "scripted-model",
    provider: "mock",
    durationMs: 0,
  };
}

/**
 * A test-only AIProvider that enforces a fixed input-character budget (forcing
 * `splitOperationsIntoBatches` to split a large ApiModel into multiple batches, FR-004) and
 * whose per-call behavior can be scripted via `scriptResponse`.
 */
function scriptedBatchProvider(options: {
  budgetChars: number | undefined;
  scriptResponse?: (request: InferenceRequest) => InferenceResponse | undefined;
}): AIProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    mode: "mock",
    calls,
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    getInputBudget: async () => options.budgetChars,
    infer: async (request): Promise<InferenceResponse> => {
      calls.push(request.requestId);
      return options.scriptResponse?.(request) ?? successResponse(request);
    },
  };
}

describe("enhanceTestModel", () => {
  it("adds valid candidates, withholds unsafe references, and preserves the baseline", async () => {
    const result = await enhanceTestModel(
      aiScenarioApiModel,
      aiScenarioBaseline,
      provider(
        JSON.stringify({
          responseVersion: 1,
          candidates: [
            {
              candidateId: "valid-1",
              operationPath: "/accounts",
              operationMethod: "POST",
              category: "invalid-format",
              targetLocation: "body",
              targetField: "email",
              request: {
                pathParameters: {},
                queryParameters: {},
                headers: {},
                body: { email: "bad" },
              },
              assertions: [{ type: "status-code", expectedStatusCode: "409" }],
              rationale: "Exercise a malformed email value.",
              confidence: 0.8,
              assumptions: [],
            },
            {
              candidateId: "unsafe-1",
              operationPath: "/missing",
              operationMethod: "POST",
              category: "positive",
              request: { pathParameters: {}, queryParameters: {}, headers: {} },
              assertions: [],
              rationale: "Unknown operation should not execute.",
              confidence: 0.8,
              assumptions: [],
            },
          ],
        }),
      ),
    );

    expect(result.aiProviderOutcome).toBe("success");
    expect(result.enhancedTestModel.scenarios).toHaveLength(1);
    expect(result.enhancedTestModel.scenarios[0].provenance.source).toBe("AI");
    expect(result.aiCandidates.added).toHaveLength(1);
    expect(result.aiCandidates.nonExecutable[0].findings[0].code).toBe(
      "operation-not-found",
    );
  });

  it.each([
    ["PROVIDER_UNAVAILABLE", "unavailable"],
    ["TIMEOUT", "timeout"],
  ] as const)(
    "preserves the baseline for %s provider failures",
    async (category, outcome) => {
      const result = await enhanceTestModel(aiScenarioApiModel, aiScenarioBaseline, {
        ...provider(""),
        infer: async (request) => ({
          contractVersion: 1,
          requestId: request.requestId,
          status: "error",
          errorCategory: category,
          errorMessage: "internal provider detail",
          modelId: "test-model",
          provider: "mock",
          durationMs: 0,
        }),
      });

      expect(result.aiProviderOutcome).toBe(outcome);
      expect(result.enhancedTestModel).toEqual(aiScenarioBaseline);
      expect(result.aiErrorMessage).not.toContain("internal provider detail");
    },
  );

  it("preserves the baseline for malformed provider output", async () => {
    const result = await enhanceTestModel(
      aiScenarioApiModel,
      aiScenarioBaseline,
      provider("{}"),
    );

    expect(result.aiProviderOutcome).toBe("invalid-response");
    expect(result.enhancedTestModel).toEqual(aiScenarioBaseline);
  });

  it("partitions duplicate AI candidates and preserves their identities", async () => {
    const candidate = {
      candidateId: "duplicate-1",
      operationPath: "/accounts",
      operationMethod: "POST",
      category: "invalid-format" as const,
      targetLocation: "body" as const,
      targetField: "email",
      request: {
        pathParameters: {},
        queryParameters: {},
        headers: {},
        body: { email: "bad" },
      },
      assertions: [{ type: "status-code" as const, expectedStatusCode: "409" }],
      rationale: "Exercise a malformed email value.",
      confidence: 0.8,
      assumptions: [],
    };
    const result = await enhanceTestModel(
      aiScenarioApiModel,
      aiScenarioBaseline,
      provider(
        JSON.stringify({
          responseVersion: 1,
          candidates: [candidate, { ...candidate, candidateId: "duplicate-2" }],
        }),
      ),
    );

    expect(result.enhancedTestModel.scenarios).toHaveLength(1);
    expect(result.aiCandidates.added).toHaveLength(1);
    expect(result.aiCandidates.deduplicated).toHaveLength(1);
    expect(result.enhancedTestModel.scenarios[0].provenance).toMatchObject({
      source: "AI",
      aiCandidateId: "duplicate-1",
      duplicateOfAICandidates: ["duplicate-2"],
    });
  });

  it("rejects repeated candidate IDs without adding the repeated candidate", async () => {
    const candidate = {
      candidateId: "same-id",
      operationPath: "/accounts",
      operationMethod: "POST",
      category: "invalid-format" as const,
      targetLocation: "body" as const,
      targetField: "email",
      request: {
        pathParameters: {},
        queryParameters: {},
        headers: {},
        body: { email: "bad" },
      },
      assertions: [{ type: "status-code" as const, expectedStatusCode: "409" }],
      rationale: "Exercise a malformed email value.",
      confidence: 0.8,
      assumptions: [],
    };
    const result = await enhanceTestModel(
      aiScenarioApiModel,
      aiScenarioBaseline,
      provider(
        JSON.stringify({ responseVersion: 1, candidates: [candidate, candidate] }),
      ),
    );

    expect(result.aiCandidates.added).toHaveLength(1);
    expect(result.aiCandidates.rejected).toHaveLength(1);
    expect(result.aiCandidates.rejected[0].findings[0].code).toBe("duplicate");
  });

  it("produces stable identities and ordering for equivalent repeated enhancement", async () => {
    const content = JSON.stringify({
      responseVersion: 1,
      candidates: [
        {
          candidateId: "stable-id",
          operationPath: "/accounts",
          operationMethod: "POST",
          category: "invalid-format",
          targetLocation: "body",
          targetField: "email",
          request: {
            pathParameters: {},
            queryParameters: {},
            headers: {},
            body: { email: "bad" },
          },
          assertions: [{ type: "status-code", expectedStatusCode: "409" }],
          rationale: "Exercise a malformed email value.",
          confidence: 0.8,
          assumptions: [],
        },
      ],
    });
    const first = await enhanceTestModel(
      aiScenarioApiModel,
      aiScenarioBaseline,
      provider(content),
    );
    const second = await enhanceTestModel(
      aiScenarioApiModel,
      aiScenarioBaseline,
      provider(content),
    );

    expect(second).toEqual(first);
  });
});

describe("enhanceTestModel (AI-assisted batching, US1/US2/US3)", () => {
  it("regression: a small ApiModel produces exactly one provider.infer() call (FR-006)", async () => {
    const scripted = scriptedBatchProvider({ budgetChars: undefined });

    const result = await enhanceTestModel(
      aiScenarioApiModel,
      aiScenarioBaseline,
      scripted,
    );

    expect(scripted.calls).toHaveLength(1);
    expect(result.aiProviderOutcome).toBe("success");
  });

  it("splits a large ApiModel into multiple batches, all succeeding (T013)", async () => {
    const largeModel = buildLargeAiScenarioApiModel(20);
    const budgetChars = Math.floor(
      buildAIScenarioPrompt(largeModel, aiScenarioBaseline).length / 3,
    );
    const scripted = scriptedBatchProvider({ budgetChars });

    const result = await enhanceTestModel(largeModel, aiScenarioBaseline, scripted);

    expect(scripted.calls.length).toBeGreaterThan(1);
    expect(new Set(scripted.calls).size).toBe(scripted.calls.length);
    expect(result.aiProviderOutcome).toBe("success");
  });

  it("reports 'partial' when one of several batches times out while others succeed (T024)", async () => {
    const largeModel = buildLargeAiScenarioApiModel(20);
    const budgetChars = Math.floor(
      buildAIScenarioPrompt(largeModel, aiScenarioBaseline).length / 3,
    );
    let timedOutOnce = false;
    const scripted = scriptedBatchProvider({
      budgetChars,
      scriptResponse: (request) => {
        if (!timedOutOnce) {
          timedOutOnce = true;
          return {
            contractVersion: 1,
            requestId: request.requestId,
            status: "error",
            errorCategory: "TIMEOUT",
            errorMessage: "provider timed out",
            modelId: "scripted-model",
            provider: "mock",
            durationMs: 0,
          };
        }
        return undefined;
      },
    });

    const result = await enhanceTestModel(largeModel, aiScenarioBaseline, scripted);

    expect(scripted.calls.length).toBeGreaterThan(1);
    expect(result.aiProviderOutcome).toBe("partial");
    expect(result.aiErrorCategory).toBe("TIMEOUT");
    expect(result.aiErrorMessage).toMatch(/timed out/);
    expect(result.aiErrorMessage).toMatch(/of \d+ batches/);
    expect(result.enhancedTestModel.scenarios).toEqual(aiScenarioBaseline.scenarios);
  });

  it("never reports 'partial' when every batch fails, matching today's single-batch failure semantics (T026)", async () => {
    const largeModel = buildLargeAiScenarioApiModel(20);
    const budgetChars = Math.floor(
      buildAIScenarioPrompt(largeModel, aiScenarioBaseline).length / 3,
    );
    const scripted = scriptedBatchProvider({
      budgetChars,
      scriptResponse: (request) => ({
        contractVersion: 1,
        requestId: request.requestId,
        status: "error",
        errorCategory: "TIMEOUT",
        errorMessage: "provider timed out",
        modelId: "scripted-model",
        provider: "mock",
        durationMs: 0,
      }),
    });

    const result = await enhanceTestModel(largeModel, aiScenarioBaseline, scripted);

    expect(scripted.calls.length).toBeGreaterThan(1);
    expect(result.aiProviderOutcome).toBe("timeout");
    expect(result.enhancedTestModel).toEqual(aiScenarioBaseline);
    expect(result.aiCandidates).toEqual({
      added: [],
      deduplicated: [],
      rejected: [],
      nonExecutable: [],
    });
  });
});
