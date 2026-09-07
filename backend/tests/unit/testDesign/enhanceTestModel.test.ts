import { afterEach, describe, expect, it, vi } from "vitest";
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
      // Reads the operation-contract projection introduced by specs/013-ai-enhancement-viability
      // (responseVersion 2), which replaced the serialized ApiModel/TestModel pair.
      const parsed = JSON.parse(request.input) as {
        operations: { path: string; method: string }[];
      };
      const candidates = parsed.operations.map((op) => ({
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
      // specs/013-ai-enhancement-viability replaced the serialized ApiModel/TestModel pair with an
      // operation-contract projection, and specs/014-ai-batching-policy nested `existingCoverage`
      // by operation then category (the flat "METHOD /path category:field" form repeated the
      // operation label on every entry, which at one operation per unit was 47% of the prompt).
      // The invariant under test is unchanged — a batch must only be shown coverage for its own
      // operations.
      const parsed = JSON.parse(input) as {
        operations: { path: string }[];
        existingCoverage: Record<string, Record<string, string[]>>;
      };
      const batchOperationPaths = new Set(parsed.operations.map((op) => op.path));
      for (const operationKey of Object.keys(parsed.existingCoverage)) {
        const [, path] = operationKey.split(" ");
        expect(batchOperationPaths.has(path)).toBe(true);
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

/**
 * specs/014-ai-batching-policy: work-bounded units. Sizing a request by operation rather than by
 * remaining context is what makes a reply short enough to be usable, and turns one oversized failure
 * into many small isolated ones (research.md Decision 1).
 */
describe("enhanceTestModel work-bounded units (specs/014-ai-batching-policy)", () => {
  it("sends one request per operation, so AI contribution scales with specification size (FR-001, FR-003)", async () => {
    const operationCount = 7;
    const largeModel = buildLargeAiScenarioApiModel(operationCount);
    const provider = perOperationCandidateProvider(1_000_000);

    await enhanceTestModel(largeModel, { scenarios: [] }, provider, { operationsPerUnit: 1 });

    expect(provider.calls).toHaveLength(operationCount);
  });

  it("asks each request about exactly one operation", async () => {
    const largeModel = buildLargeAiScenarioApiModel(4);
    const seenOperationCounts: number[] = [];
    const base = perOperationCandidateProvider(1_000_000);
    const spy: AIProvider = {
      ...base,
      infer: async (request) => {
        const parsed = JSON.parse(request.input) as { operations: unknown[] };
        seenOperationCounts.push(parsed.operations.length);
        return base.infer(request);
      },
    };

    await enhanceTestModel(largeModel, { scenarios: [] }, spy, { operationsPerUnit: 1 });

    expect(seenOperationCounts).toEqual([1, 1, 1, 1]);
  });

  it("honours a configured unit size larger than one, so faster hardware can raise it", async () => {
    const largeModel = buildLargeAiScenarioApiModel(6);
    const provider = perOperationCandidateProvider(1_000_000);

    await enhanceTestModel(largeModel, { scenarios: [] }, provider, { operationsPerUnit: 3 });

    expect(provider.calls).toHaveLength(2);
  });

  it("keeps scenarios from successful units when another unit fails, reporting the run partial (FR-007, FR-008)", async () => {
    const largeModel = buildLargeAiScenarioApiModel(4);
    const base = perOperationCandidateProvider(1_000_000);
    let call = 0;
    const flaky: AIProvider = {
      ...base,
      infer: async (request) => {
        call += 1;
        if (call === 2) {
          return {
            contractVersion: 1,
            requestId: request.requestId,
            status: "error",
            errorCategory: "INVALID_RESPONSE",
            errorMessage: "unusable",
            modelId: "scripted-model",
            provider: "mock",
            durationMs: 0,
          } satisfies InferenceResponse;
        }
        return base.infer(request);
      },
    };

    const result = await enhanceTestModel(largeModel, { scenarios: [] }, flaky, {
      operationsPerUnit: 1,
    });

    expect(result.aiProviderOutcome).toBe("partial");
    const aiScenarios = result.enhancedTestModel.scenarios.filter(
      (scenario) => scenario.provenance.source === "AI",
    );
    // Three of four units succeeded; a failing unit costs only its own contribution.
    expect(aiScenarios).toHaveLength(3);
  });

  it("attempts every remaining unit after one fails, rather than abandoning the run (FR-008)", async () => {
    const largeModel = buildLargeAiScenarioApiModel(5);
    const base = perOperationCandidateProvider(1_000_000);
    const attempted: string[] = [];
    let call = 0;
    const flaky: AIProvider = {
      ...base,
      infer: async (request) => {
        attempted.push(request.requestId);
        call += 1;
        if (call === 1) throw new Error("first unit explodes");
        return base.infer(request);
      },
    };

    await enhanceTestModel(largeModel, { scenarios: [] }, flaky, { operationsPerUnit: 1 });

    expect(attempted).toHaveLength(5);
  });

  it("preserves every deterministic scenario when no unit succeeds (FR-022, SC-005)", async () => {
    const largeModel = buildLargeAiScenarioApiModel(3);
    const baseline = buildLargeAiScenarioBaseline(3);
    const alwaysFails = provider("this is not a candidate document");

    const result = await enhanceTestModel(largeModel, baseline, alwaysFails, {
      operationsPerUnit: 1,
    });

    expect(result.enhancedTestModel.scenarios).toEqual(baseline.scenarios);
    expect(result.aiProviderOutcome).not.toBe("success");
  });

  it("produces the same units on repeated runs of an unchanged specification (SC-008)", async () => {
    const largeModel = buildLargeAiScenarioApiModel(6);

    const runOnce = async () => {
      const seen: string[] = [];
      const base = perOperationCandidateProvider(1_000_000);
      const spy: AIProvider = {
        ...base,
        infer: async (request) => {
          const parsed = JSON.parse(request.input) as { operations: { path: string }[] };
          seen.push(parsed.operations.map((op) => op.path).join(","));
          return base.infer(request);
        },
      };
      await enhanceTestModel(largeModel, { scenarios: [] }, spy, { operationsPerUnit: 2 });
      return seen;
    };

    expect(await runOnce()).toEqual(await runOnce());
  });
});

/**
 * specs/014-ai-batching-policy FR-024: a unit shows the model one operation, but validation still
 * runs against the whole ApiModel. Narrowing the model's *view* must never narrow the validator's,
 * or a suggestion referencing something outside the real contract would slip through (constitution
 * I, IV).
 */
describe("enhanceTestModel validates against the full ApiModel, not the unit (specs/014-ai-batching-policy)", () => {
  function candidateProvider(candidate: Record<string, unknown>): AIProvider {
    return provider(JSON.stringify({ responseVersion: 3, candidates: [candidate] }));
  }

  it("rejects a candidate naming an operation that exists in no part of the specification", async () => {
    const largeModel = buildLargeAiScenarioApiModel(3);

    const result = await enhanceTestModel(
      largeModel,
      { scenarios: [] },
      candidateProvider({
        candidateId: "ghost",
        operationPath: "/not-in-the-specification",
        operationMethod: "POST",
        category: "invalid-format",
        request: { pathParameters: {}, queryParameters: {}, headers: {}, body: {} },
        assertions: [{ type: "status-code", expectedStatusCode: "400" }],
        rationale: "References an operation the contract does not contain.",
        confidence: 0.9,
        assumptions: [],
      }),
      { operationsPerUnit: 1 },
    );

    expect(
      result.enhancedTestModel.scenarios.filter((s) => s.provenance.source === "AI"),
    ).toHaveLength(0);
  });

  it("accepts a candidate for a real operation even though the unit showed the model only one", async () => {
    const largeModel = buildLargeAiScenarioApiModel(3);
    // Names the *last* operation, which most units never saw — validation must still recognise it
    // as a genuine contract fact rather than rejecting it for being outside the unit.
    const target = largeModel.operations[largeModel.operations.length - 1];

    const result = await enhanceTestModel(
      largeModel,
      { scenarios: [] },
      candidateProvider({
        candidateId: "real-operation",
        operationPath: target.path,
        operationMethod: target.method,
        category: "invalid-format",
        targetLocation: "body",
        targetField: "email",
        request: {
          pathParameters: {},
          queryParameters: {},
          headers: {},
          body: { email: "not-an-email" },
        },
        assertions: [{ type: "status-code", expectedStatusCode: "409" }],
        rationale: "Exercises a malformed email value.",
        confidence: 0.9,
        assumptions: [],
      }),
      { operationsPerUnit: 1 },
    );

    const aiScenarios = result.enhancedTestModel.scenarios.filter(
      (s) => s.provenance.source === "AI",
    );
    expect(aiScenarios.length).toBeGreaterThan(0);
    expect(aiScenarios[0].operationPath).toBe(target.path);
  });
});

/**
 * The run's wall-clock ceiling (specs/014-ai-batching-policy FR-009/FR-010,
 * contracts/run-budget.md).
 *
 * One operation per unit makes total run time linear in specification size, so a large
 * specification needs a bound distinct from the per-request timeout. This is what stops
 * work-bounded batching from replacing "fails in one minute" with "runs for half an hour": a real
 * 39-operation specification was observed grinding through unit after unit, ~40s each, with no
 * ceiling to stop it, because `enhancementRunBudgetMs` was configured but never read.
 *
 * Time is driven by a stubbed `Date.now` advanced by the provider itself rather than by real
 * sleeping, so every assertion below is exact rather than tolerance-based (constitution XXIV).
 */
describe("enhanceTestModel run ceiling (specs/014-ai-batching-policy)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Stubs `Date.now` and returns a handle whose `advance` the caller drives explicitly. */
  function stubClock(): { advance: (ms: number) => void } {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    return {
      advance: (ms) => {
        now += ms;
      },
    };
  }

  /** A provider that charges `msPerCall` to the stubbed clock for every inference it serves. */
  function timedProvider(clock: { advance: (ms: number) => void }, msPerCall: number) {
    const base = perOperationCandidateProvider(1_000_000);
    const provider: AIProvider & { calls: string[] } = {
      ...base,
      infer: async (request) => {
        clock.advance(msPerCall);
        return base.infer(request);
      },
    };
    return provider;
  }

  it("starts no further unit once the ceiling elapses, recording the remainder not-attempted (FR-010, SC-006)", async () => {
    const clock = stubClock();
    const provider = timedProvider(clock, 1_000);
    const outcomes: string[] = [];

    const result = await enhanceTestModel(
      buildLargeAiScenarioApiModel(8),
      { scenarios: [] },
      provider,
      {
        operationsPerUnit: 1,
        runBudgetMs: 2_500,
        onBatchComplete: (_index, _total, outcome) => outcomes.push(outcome.status),
      },
    );

    // Units settle at 1s, 2s and 3s. The check before unit 4 sees 3s against a 2.5s ceiling.
    expect(provider.calls).toHaveLength(3);
    expect(outcomes).toEqual([
      "success",
      "success",
      "success",
      "not-attempted",
      "not-attempted",
      "not-attempted",
      "not-attempted",
      "not-attempted",
    ]);
    expect(result.aiProviderOutcome).toBe("partial");
    expect(result.runBudgetExhausted).toEqual({ budgetMs: 2_500, notStartedCount: 5 });
  });

  it("retains every scenario from the units that did run (FR-010)", async () => {
    const runWith = async (runBudgetMs: number) => {
      const clock = stubClock();
      const result = await enhanceTestModel(
        buildLargeAiScenarioApiModel(8),
        buildLargeAiScenarioBaseline(8),
        timedProvider(clock, 1_000),
        { operationsPerUnit: 1, runBudgetMs },
      );
      vi.restoreAllMocks();
      return result;
    };

    const truncated = await runWith(2_500);
    const whole = await runWith(Number.MAX_SAFE_INTEGER);

    const deterministic = (result: Awaited<ReturnType<typeof runWith>>) =>
      result.enhancedTestModel.scenarios.filter((s) => s.provenance.source !== "AI");
    const ai = (result: Awaited<ReturnType<typeof runWith>>) =>
      result.enhancedTestModel.scenarios.filter((s) => s.provenance.source === "AI");

    // Three of eight units ran, so the truncated run keeps three units' worth of AI scenarios.
    expect(ai(truncated)).toHaveLength(3);
    expect(ai(whole)).toHaveLength(8);
    // Deterministic scenarios are unaffected by where the ceiling fell (FR-022, SC-005).
    expect(deterministic(truncated)).toEqual(deterministic(whole));
  });

  it("lets a unit already in flight when the ceiling elapses run to completion and keeps its result", async () => {
    const clock = stubClock();
    // A single unit costs four times the whole ceiling, so the ceiling elapses while unit 1 is
    // still in flight. The ceiling governs what is *started*, never what is discarded.
    const provider = timedProvider(clock, 4_000);

    const result = await enhanceTestModel(
      buildLargeAiScenarioApiModel(3),
      { scenarios: [] },
      provider,
      { operationsPerUnit: 1, runBudgetMs: 1_000 },
    );

    expect(provider.calls).toHaveLength(1);
    expect(
      result.enhancedTestModel.scenarios.filter((s) => s.provenance.source === "AI"),
    ).toHaveLength(1);
    expect(result.runBudgetExhausted).toEqual({ budgetMs: 1_000, notStartedCount: 2 });
  });

  it("does not charge model preparation to the ceiling, only generation (contracts/run-budget.md)", async () => {
    const clock = stubClock();
    const provider = timedProvider(clock, 1_000);
    const loadsSlowly: AIProvider & { calls: string[] } = {
      ...provider,
      // Ten times the ceiling spent preparing the model — a first run's download — before the
      // first unit starts. Charging it would refuse every unit of an otherwise viable run.
      getInputBudget: async () => {
        clock.advance(30_000);
        return 1_000_000;
      },
    };

    const result = await enhanceTestModel(
      buildLargeAiScenarioApiModel(3),
      { scenarios: [] },
      loadsSlowly,
      { operationsPerUnit: 1, runBudgetMs: 3_000 },
    );

    expect(loadsSlowly.calls).toHaveLength(3);
    expect(result.aiProviderOutcome).toBe("success");
    expect(result.runBudgetExhausted).toBeUndefined();
  });

  it("is observably identical to an effectively disabled ceiling when the work fits (SC-006)", async () => {
    const runWith = async (runBudgetMs: number) => {
      const clock = stubClock();
      const result = await enhanceTestModel(
        buildLargeAiScenarioApiModel(4),
        buildLargeAiScenarioBaseline(4),
        timedProvider(clock, 1_000),
        { operationsPerUnit: 1, runBudgetMs },
      );
      vi.restoreAllMocks();
      return result;
    };

    const bounded = await runWith(60_000);
    const unbounded = await runWith(Number.MAX_SAFE_INTEGER);

    expect(bounded).toEqual(unbounded);
    expect(bounded.runBudgetExhausted).toBeUndefined();
  });

  it("describes a ceiling-truncated run as such rather than blaming the provider", async () => {
    const clock = stubClock();

    const result = await enhanceTestModel(
      buildLargeAiScenarioApiModel(8),
      { scenarios: [] },
      timedProvider(clock, 1_000),
      { operationsPerUnit: 1, runBudgetMs: 2_500 },
    );

    // `failureCount` counts the never-started units too, so the ordinary provider wording would
    // report five provider failures that never happened.
    expect(result.aiErrorMessage).toContain("run time limit");
    expect(result.aiErrorMessage).toContain("5 of 8 batches not started");
    expect(result.aiErrorMessage).not.toContain("invalid output");
  });
});
