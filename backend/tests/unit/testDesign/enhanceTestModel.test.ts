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
  buildLargeAiScenarioBaseline,
} from "../../fixtures/testDesign/aiScenarioDesignerFixtures";
import { enhanceTestModel } from "../../../src/testDesign/enhanceTestModel";
import {
  AI_SCENARIO_MAX_OUTPUT_TOKENS,
  buildAIScenarioPrompt,
} from "../../../src/testDesign/aiScenarioPrompt";

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
}): AIProvider & {
  calls: string[];
  inputs: string[];
  getInputBudgetCalls: (number | undefined)[];
} {
  const calls: string[] = [];
  const inputs: string[] = [];
  const getInputBudgetCalls: (number | undefined)[] = [];
  return {
    mode: "mock",
    calls,
    inputs,
    getInputBudgetCalls,
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    getInputBudget: async (maxOutputTokens) => {
      getInputBudgetCalls.push(maxOutputTokens);
      return options.budgetChars;
    },
    infer: async (request): Promise<InferenceResponse> => {
      calls.push(request.requestId);
      inputs.push(request.input);
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

/**
 * A scripted provider whose response, for any batch, contains exactly one `invalid-format`
 * candidate per operation present in that batch's request (parsed from the real serialized
 * prompt, mirroring how a real model would respond per-operation). Used to verify
 * `onBatchComplete`'s incremental reveal against a batching split where each batch covers a
 * disjoint set of operations.
 */
function perOperationCandidateProvider(budgetChars: number): AIProvider & {
  calls: string[];
} {
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
    getInputBudget: async () => budgetChars,
    infer: async (request): Promise<InferenceResponse> => {
      calls.push(request.requestId);
      const parsed = JSON.parse(request.input) as {
        apiModel: { operations: { path: string; method: string }[] };
      };
      const candidates = parsed.apiModel.operations.map((op) => ({
        candidateId: `cand-${op.path}`,
        operationPath: op.path,
        operationMethod: op.method,
        category: "invalid-format",
        targetLocation: "body",
        targetField: "email",
        request: { pathParameters: {}, queryParameters: {}, headers: {}, body: { email: "bad" } },
        assertions: [{ type: "status-code", expectedStatusCode: "409" }],
        rationale: `Exercise a malformed email value for ${op.path}.`,
        confidence: 0.8,
        assumptions: [],
      }));
      return {
        contractVersion: 1,
        requestId: request.requestId,
        status: "success",
        content: JSON.stringify({ responseVersion: 1, candidates }),
        modelId: "scripted-model",
        provider: "mock",
        durationMs: 0,
      };
    },
  };
}

describe("enhanceTestModel (progress + incremental reveal, specs/012-ai-enhancement-progress)", () => {
  it("invokes onBatchComplete once per batch, each time with exactly that batch's newly-retained scenarios", async () => {
    const operationCount = 5;
    const largeModel = buildLargeAiScenarioApiModel(operationCount);
    const emptyBaseline = { scenarios: [] };
    // Tight budget forces one operation per batch (5 batches).
    const budgetChars = Math.floor(
      buildAIScenarioPrompt(
        { ...largeModel, operations: [largeModel.operations[0]] },
        emptyBaseline,
      ).length * 1.2,
    );
    const provider = perOperationCandidateProvider(budgetChars);

    const calls: { index: number; total: number; outcome: string; paths: string[] }[] = [];
    const result = await enhanceTestModel(largeModel, emptyBaseline, provider, {
      onBatchComplete: (index, total, outcome, newlyRetainedScenarios) => {
        calls.push({
          index,
          total,
          outcome: outcome.status,
          paths: newlyRetainedScenarios.map((s) => s.operationPath),
        });
      },
    });

    expect(provider.calls.length).toBe(operationCount);
    expect(calls).toHaveLength(operationCount);
    // Each batch reports exactly its own operation's scenario, never another batch's.
    calls.forEach((call, i) => {
      expect(call).toMatchObject({ index: i, total: operationCount, outcome: "success" });
      expect(call.paths).toEqual([`/resource${i}`]);
    });
    // The union across all calls matches the final result exactly (no under/over-reporting).
    const allReportedPaths = calls.flatMap((c) => c.paths).sort();
    const finalAiPaths = result.enhancedTestModel.scenarios
      .filter((s) => s.provenance.source === "AI")
      .map((s) => s.operationPath)
      .sort();
    expect(allReportedPaths).toEqual(finalAiPaths);
  });

  it("never re-reports or removes a scenario already retained from an earlier batch (FR-012 proof-in-practice)", async () => {
    const operationCount = 4;
    const largeModel = buildLargeAiScenarioApiModel(operationCount);
    const emptyBaseline = { scenarios: [] };
    const budgetChars = Math.floor(
      buildAIScenarioPrompt(
        { ...largeModel, operations: [largeModel.operations[0]] },
        emptyBaseline,
      ).length * 1.2,
    );
    const provider = perOperationCandidateProvider(budgetChars);

    const seenScenarioIds = new Set<string>();
    let duplicateReported = false;
    await enhanceTestModel(largeModel, emptyBaseline, provider, {
      onBatchComplete: (_index, _total, _outcome, newlyRetainedScenarios) => {
        for (const scenario of newlyRetainedScenarios) {
          if (seenScenarioIds.has(scenario.id)) duplicateReported = true;
          seenScenarioIds.add(scenario.id);
        }
      },
    });

    expect(duplicateReported).toBe(false);
    expect(seenScenarioIds.size).toBe(operationCount);
  });

  it("a single-batch run fires onBatchComplete exactly once with total: 1, and output is byte-identical to a run with no callbacks (FR-005 regression)", async () => {
    const provider = perOperationCandidateProvider(1_000_000);
    const calls: { index: number; total: number }[] = [];

    const withCallback = await enhanceTestModel(aiScenarioApiModel, aiScenarioBaseline, provider, {
      onBatchComplete: (index, total) => calls.push({ index, total }),
    });
    const without = await enhanceTestModel(
      aiScenarioApiModel,
      aiScenarioBaseline,
      perOperationCandidateProvider(1_000_000),
    );

    expect(calls).toEqual([{ index: 0, total: 1 }]);
    expect(withCallback).toEqual(without);
  });

  it("produces identical output whether or not onBatchComplete/onBatchStart are provided", async () => {
    const largeModel = buildLargeAiScenarioApiModel(3);
    const emptyBaseline = { scenarios: [] };
    const budgetChars = Math.floor(
      buildAIScenarioPrompt(
        { ...largeModel, operations: [largeModel.operations[0]] },
        emptyBaseline,
      ).length * 1.2,
    );

    const without = await enhanceTestModel(
      largeModel,
      emptyBaseline,
      perOperationCandidateProvider(budgetChars),
    );
    const withCallbacks = await enhanceTestModel(
      largeModel,
      emptyBaseline,
      perOperationCandidateProvider(budgetChars),
      { onBatchStart: () => undefined, onBatchComplete: () => undefined },
    );

    expect(withCallbacks).toEqual(without);
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

  it("regression: requests an input budget sized for a real candidate response, not LocalProvider's tiny unset default", async () => {
    // A candidate's request/assertions/rationale/assumptions make it far heavier than a
    // one-line reply; budgeting off the unset default (256, LocalProvider's own fallback)
    // left no room for a real candidate and always truncated mid-JSON (INVALID_RESPONSE on
    // every real request, regardless of provider health).
    const scripted = scriptedBatchProvider({ budgetChars: undefined });

    await enhanceTestModel(aiScenarioApiModel, aiScenarioBaseline, scripted);

    expect(scripted.getInputBudgetCalls).toEqual([AI_SCENARIO_MAX_OUTPUT_TOKENS]);
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

  it("scopes each batch's deterministic baseline to its own operations, not the whole specification's baseline", async () => {
    // Regression: aiScenarioBaseline is empty in every other test here, so it can never
    // reveal a bug where the full baseline is embedded in every batch's prompt regardless of
    // how far operations were split. A baseline that scales with operation count (mirroring
    // the real deterministic test designer's output) does reveal it: if scoping is missing,
    // every batch's prompt would carry all 100 scenarios instead of only its own operations',
    // and the budget-driven split below would never shrink batches to fewer operations.
    const operationCount = 20;
    const largeModel = buildLargeAiScenarioApiModel(operationCount);
    const largeBaseline = buildLargeAiScenarioBaseline(operationCount, 5);
    // Sized for roughly one operation's own scenarios plus its own operation entry, not the
    // whole specification.
    const budgetChars = Math.floor(
      buildAIScenarioPrompt(
        { ...largeModel, operations: [largeModel.operations[0]] },
        { scenarios: largeBaseline.scenarios.slice(0, 5) },
      ).length * 1.5,
    );
    const scripted = scriptedBatchProvider({ budgetChars });

    const result = await enhanceTestModel(largeModel, largeBaseline, scripted);

    expect(scripted.calls.length).toBeGreaterThan(1);
    expect(result.aiProviderOutcome).toBe("success");
    for (const input of scripted.inputs) {
      const parsed = JSON.parse(input) as {
        apiModel: { operations: { path: string }[] };
        deterministicTestModel: { scenarios: { operationPath: string }[] };
      };
      const batchOperationPaths = new Set(
        parsed.apiModel.operations.map((op) => op.path),
      );
      for (const scenario of parsed.deterministicTestModel.scenarios) {
        expect(batchOperationPaths.has(scenario.operationPath)).toBe(true);
      }
    }
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
