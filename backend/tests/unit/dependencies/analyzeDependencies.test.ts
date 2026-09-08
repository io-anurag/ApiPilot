import { describe, expect, it } from "vitest";
import type {
  AIProvider,
  InferenceRequest,
  InferenceResponse,
} from "@apipilot/shared-domain";
import { analyzeDependencies } from "../../../src/dependencies/analyzeDependencies";
import {
  crudChainApiModel,
  minimalApiModelForNoRelationships,
  buildLargeApiModel,
  dissimilarNameAiApiModel,
} from "../../fixtures/dependencies/dependencyFixtures";
import {
  knownRelationships,
  knownRelationshipsApiModel,
} from "../../fixtures/dependencies/knownRelationships";
import {
  AI_DEPENDENCY_RESPONSE_VERSION,
  AI_DEPENDENCY_TIMEOUT_MS,
  buildAIDependencyPrompt,
} from "../../../src/dependencies/aiDependencyPrompt";

const emptyCandidatesContent = JSON.stringify({
  responseVersion: AI_DEPENDENCY_RESPONSE_VERSION,
  candidates: [],
});

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
 * whose per-call behavior can be scripted via `scriptResponse`, which inspects the raw prompt
 * so tests can identify which batch is being requested without depending on call ordering.
 */
function scriptedBatchProvider(options: {
  budgetChars: number | undefined;
  scriptResponse?: (request: InferenceRequest) => InferenceResponse | undefined;
  delayMs?: number;
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
      if (options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      return options.scriptResponse?.(request) ?? successResponse(request);
    },
  };
}

describe("analyzeDependencies (deterministic-only)", () => {
  it("produces the expected CONFIRMED relationship with source 'deterministic'", async () => {
    const result = await analyzeDependencies(crudChainApiModel);
    const created = result.graph.relationships.find(
      (r) =>
        r.producer.operationPath === "/users" &&
        r.consumer.operationPath === "/users/{userId}",
    );
    expect(created?.confidence).toBe("CONFIRMED");
    expect(created?.source).toBe("deterministic");
  });

  it("returns an explicit empty graph when there are no candidate relationships (FR-009)", async () => {
    const result = await analyzeDependencies(minimalApiModelForNoRelationships);
    expect(result.graph.relationships).toEqual([]);
  });

  it("reports aiOutcome 'skipped' when no AIProvider is supplied", async () => {
    const result = await analyzeDependencies(crudChainApiModel);
    expect(result.aiOutcome).toBe("skipped");
  });

  it("returns an explicit empty workflow/candidate/cycle set when there are no candidate relationships", async () => {
    const result = await analyzeDependencies(minimalApiModelForNoRelationships);
    expect(result.workflows).toEqual([]);
    expect(result.manualConfirmationCandidates).toEqual([]);
    expect(result.cycles).toEqual([]);
  });

  // Workflow assembly itself (ordering, variable naming, POSSIBLE/disambiguation/cycle handling)
  // is covered by assembleWorkflows.test.ts and buildDependencyGraph.test.ts (User Story 2); this
  // file only asserts that analyzeDependencies wires those results into its return value.
  it("wires assembled workflows into its result", async () => {
    const result = await analyzeDependencies(crudChainApiModel);
    expect(result.workflows.length).toBeGreaterThan(0);
  });
});

describe("analyzeDependencies (AI-assisted batching, US1/US2/US3)", () => {
  it("still issues exactly one provider.infer() call when work-bounded sizing is explicitly disabled and everything fits (specs/011-ai-prompt-batching FR-006)", async () => {
    const provider = scriptedBatchProvider({ budgetChars: undefined });

    // A non-positive override disables the work bound entirely (requestBatching.ts), isolating
    // the original context-only-splitting guarantee from the work bound specs/014 adds by default.
    const result = await analyzeDependencies(crudChainApiModel, provider, {
      maxOperationsPerBatch: 0,
    });

    expect(provider.calls).toHaveLength(1);
    expect(result.aiOutcome).toBe("success");
  });

  it("applies a work bound by default, splitting even a small ApiModel into more than one unit (specs/014-ai-batching-policy FR-028, FR-029, T055)", async () => {
    const provider = scriptedBatchProvider({ budgetChars: undefined });

    const result = await analyzeDependencies(crudChainApiModel, provider, {
      maxOperationsPerBatch: 2,
    });

    expect(provider.calls.length).toBeGreaterThan(1);
    expect(result.aiOutcome).toBe("success");
  });

  it("splits a large ApiModel into multiple batches and merges every successful batch's results (T012)", async () => {
    const largeModel = buildLargeApiModel(20);
    const budgetChars = Math.floor(buildAIDependencyPrompt(largeModel).length / 3);
    const provider = scriptedBatchProvider({ budgetChars });

    const result = await analyzeDependencies(largeModel, provider);

    expect(provider.calls.length).toBeGreaterThan(1);
    expect(new Set(provider.calls).size).toBe(provider.calls.length); // every batch got a distinct requestId
    expect(result.aiOutcome).toBe("success");
  });

  it("treats a single oversized operation as its own one-operation batch, which fails independently of other batches (FR-011, T014)", async () => {
    const largeModel = buildLargeApiModel(10);
    // Bloats via requestFields (a large request-body schema) rather than `tags`: the contract
    // projection (specs/014-ai-batching-policy T051) no longer serializes tags at all, so padding
    // that field would no longer inflate the prompt as this test needs.
    const hugeOperation = {
      ...crudChainApiModel.operations[0],
      path: "/huge-operation",
      operationId: "hugeOperation",
      requestBody: {
        required: true,
        contentTypes: {
          "application/json": {
            required: [],
            properties: Object.fromEntries(
              Array.from({ length: 3000 }, (_, i) => [`field${i}`, { required: [], properties: {}, type: "string" }]),
            ),
          },
        },
      },
    };
    const modelWithHugeOp = {
      ...largeModel,
      operations: [...largeModel.operations, hugeOperation],
    };
    const budgetChars = Math.floor(buildAIDependencyPrompt(largeModel).length / 3);
    let hugeOperationBatchSize: number | undefined;
    const provider = scriptedBatchProvider({
      budgetChars,
      scriptResponse: (request) => {
        const parsed = JSON.parse(request.input) as { operations: unknown[] };
        const containsHugeOp = request.input.includes("hugeOperation");
        if (containsHugeOp) {
          hugeOperationBatchSize = parsed.operations.length;
          return {
            contractVersion: 1,
            requestId: request.requestId,
            status: "error",
            errorCategory: "INVALID_REQUEST",
            errorMessage: "prompt exceeds provider input budget",
            modelId: "scripted-model",
            provider: "mock",
            durationMs: 0,
          };
        }
        return undefined;
      },
    });

    const result = await analyzeDependencies(modelWithHugeOp, provider);

    expect(hugeOperationBatchSize).toBe(1);
    expect(provider.calls.length).toBeGreaterThan(1);
    expect(result.aiOutcome).toBe("partial");
    expect(result.aiErrorCategory).toBe("INVALID_REQUEST");
  });

  it("reports 'partial' when one of several batches times out while others succeed (T023)", async () => {
    const largeModel = buildLargeApiModel(20);
    const budgetChars = Math.floor(buildAIDependencyPrompt(largeModel).length / 3);
    let timedOutOnce = false;
    const provider = scriptedBatchProvider({
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

    const result = await analyzeDependencies(largeModel, provider);

    expect(provider.calls.length).toBeGreaterThan(1);
    expect(result.aiOutcome).toBe("partial");
    expect(result.aiErrorCategory).toBe("TIMEOUT");
    expect(result.aiErrorMessage).toMatch(/timed out/);
    expect(result.aiErrorMessage).toMatch(/of \d+ batches/);
  });

  it("never reports 'partial' when every batch fails, matching today's single-batch failure semantics (T025)", async () => {
    const largeModel = buildLargeApiModel(20);
    const budgetChars = Math.floor(buildAIDependencyPrompt(largeModel).length / 3);
    const provider = scriptedBatchProvider({
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

    const result = await analyzeDependencies(largeModel, provider);

    expect(provider.calls.length).toBeGreaterThan(1);
    expect(result.aiOutcome).toBe("timeout");
    expect(result.aiErrorCategory).toBe("TIMEOUT");
  });

  it("gracefully degrades (never throws) once the AI pass's own run ceiling is exhausted mid-run, marking remaining batches not-attempted (FR-010, FR-033, T027, T056)", async () => {
    const largeModel = buildLargeApiModel(20);
    const budgetChars = Math.floor(buildAIDependencyPrompt(largeModel).length / 6);
    // The budget must be large enough that deterministic matching and workflow assembly fit inside
    // it even when the suite runs in parallel, and small enough that the scripted provider's own
    // delay exhausts it after the first batch or two. A 15ms budget could not separate those: under
    // load the deterministic portion alone exceeded it, so the run failed the budget guard for a
    // reason this test is not about (specs/014-ai-batching-policy).
    const provider = scriptedBatchProvider({ budgetChars, delayMs: 80 });

    // `aiRunBudgetMs` rather than `timeoutMs`: the AI-assisted pass now has its own run ceiling,
    // decoupled from `ANALYSIS_TIMEOUT_MS` (which governs only deterministic matching and workflow
    // assembly, FR-033) — that decoupling is exactly what this test now exercises.
    const result = await analyzeDependencies(largeModel, provider, { aiRunBudgetMs: 150 });

    expect(provider.calls.length).toBeGreaterThanOrEqual(1);
    expect(provider.calls.length).toBeLessThan(6);
    expect(result.aiOutcome).toBe("partial");
    // The deterministic relationships survive budget exhaustion, unaffected by however many
    // AI units were actually attempted (FR-031, SC-012).
    expect(result.graph.relationships.length).toBeGreaterThan(0);
  });

  it("keeps deterministic relationships present after the AI-assisted pass fails entirely (FR-031, SC-012)", async () => {
    const provider = scriptedBatchProvider({
      budgetChars: undefined,
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

    // Work-bounded sizing disabled so the AI pass runs in exactly one unit, isolating this
    // assertion from batch-count specifics.
    const result = await analyzeDependencies(crudChainApiModel, provider, {
      maxOperationsPerBatch: 0,
    });

    expect(result.aiOutcome).toBe("timeout");
    const deterministicRelationship = result.graph.relationships.find(
      (r) =>
        r.producer.operationPath === "/users" && r.consumer.operationPath === "/users/{userId}",
    );
    expect(deterministicRelationship).toMatchObject({
      confidence: "CONFIRMED",
      source: "deterministic",
    });
  });

  it("preserves a relationship found by a successful unit alongside a failing one, reporting partial (FR-030)", async () => {
    // Combines the dissimilar-name fixture (findable only by AI) with two unrelated operations,
    // then forces exactly two units so one can fail independently of the other.
    const combinedModel = {
      ...dissimilarNameAiApiModel,
      operations: [
        ...dissimilarNameAiApiModel.operations,
        ...crudChainApiModel.operations.slice(1, 3),
      ],
    };
    const aiCandidateContent = JSON.stringify({
      responseVersion: AI_DEPENDENCY_RESPONSE_VERSION,
      candidates: [
        {
          candidateId: "c1",
          producer: { operationPath: "/accounts", operationMethod: "POST", field: "accountId" },
          consumer: {
            operationPath: "/transfers",
            operationMethod: "POST",
            field: "accountRef",
            location: "body",
          },
          rationale: "semantically related",
          confidence: 0.9,
        },
      ],
    });
    const provider = scriptedBatchProvider({
      budgetChars: undefined,
      scriptResponse: (request) => {
        if (request.input.includes("createAccount")) {
          return {
            contractVersion: 1,
            requestId: request.requestId,
            status: "success",
            content: aiCandidateContent,
            modelId: "scripted-model",
            provider: "mock",
            durationMs: 0,
          };
        }
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
      },
    });

    const result = await analyzeDependencies(combinedModel, provider, {
      maxOperationsPerBatch: 2,
    });

    expect(provider.calls.length).toBeGreaterThan(1);
    expect(result.aiOutcome).toBe("partial");
    const aiRelationship = result.graph.relationships.find(
      (r) => r.producer.field === "accountId",
    );
    expect(aiRelationship).toMatchObject({ source: "ai", confidence: "LIKELY" });
  });

  it("resolves a relationship inferred by more than one unit to a single relationship (FR-032)", async () => {
    const aiCandidateContent = JSON.stringify({
      responseVersion: AI_DEPENDENCY_RESPONSE_VERSION,
      candidates: [
        {
          candidateId: "dup",
          producer: { operationPath: "/accounts", operationMethod: "POST", field: "accountId" },
          consumer: {
            operationPath: "/transfers",
            operationMethod: "POST",
            field: "accountRef",
            location: "body",
          },
          rationale: "semantically related",
          confidence: 0.9,
        },
      ],
    });
    const provider = scriptedBatchProvider({
      budgetChars: undefined,
      scriptResponse: (request) => ({
        contractVersion: 1,
        requestId: request.requestId,
        status: "success",
        content: aiCandidateContent,
        modelId: "scripted-model",
        provider: "mock",
        durationMs: 0,
      }),
    });

    // Every unit (one operation each) independently "finds" the identical relationship, exercising
    // the merge-level dedup rather than any realism about what a one-operation unit could infer.
    const result = await analyzeDependencies(dissimilarNameAiApiModel, provider, {
      maxOperationsPerBatch: 1,
    });

    expect(provider.calls.length).toBe(2);
    const matches = result.graph.relationships.filter((r) => r.producer.field === "accountId");
    expect(matches).toHaveLength(1);
  });
});

/**
 * Pre-flight viability check (T059): mirrors enhanceTestModel.ts's own refusal so this pass never
 * spends real minutes discovering, one timed-out batch at a time, that its most expensive unit
 * could never have fit the per-request budget.
 */
describe("analyzeDependencies pre-flight viability (specs/014-ai-batching-policy, T059)", () => {
  it("refuses the AI pass before any inference call when a unit's projected cost cannot fit the per-request budget", async () => {
    const provider = scriptedBatchProvider({ budgetChars: undefined });

    const result = await analyzeDependencies(crudChainApiModel, provider, {
      // An impossibly tiny per-request budget makes every unit's projection exceed it, regardless
      // of actual size — deterministic and independent of real throughput rates.
      perRequestBudgetMs: 1,
    });

    expect(provider.calls).toHaveLength(0);
    expect(result.aiOutcome).toBe("unavailable");
    expect(result.notViable).toMatchObject({ budgetMs: 1 });
    expect(result.aiErrorMessage).toMatch(/local AI model would need/);
    // Deterministic relationships are unaffected by the refusal.
    expect(result.graph.relationships.length).toBeGreaterThan(0);
  });

  it("attempts the AI pass normally when the projected cost fits the budget", async () => {
    const provider = scriptedBatchProvider({ budgetChars: undefined });

    const result = await analyzeDependencies(crudChainApiModel, provider, {
      perRequestBudgetMs: AI_DEPENDENCY_TIMEOUT_MS,
    });

    expect(provider.calls.length).toBeGreaterThan(0);
    expect(result.aiOutcome).toBe("success");
    expect(result.notViable).toBeUndefined();
  });
});

/**
 * specs/014-ai-batching-policy SC-013 / T050: batching must not cost coverage relative to
 * today's single-unit sizing. Deterministic matching already finds every relationship in the
 * `knownRelationships` fixture by exact field name (the fixture's own documented point), and runs
 * once over the whole `ApiModel` before any AI batching occurs — so this is a regression guard
 * against a future change that scopes deterministic matching to per-unit subsets, which would
 * silently lose cross-unit coverage exactly where batching is riskiest.
 */
describe("analyzeDependencies coverage against known relationships (SC-013)", () => {
  it("finds every known relationship regardless of AI unit size", async () => {
    const provider = scriptedBatchProvider({ budgetChars: undefined });

    for (const maxOperationsPerBatch of [0, 1, 3, 6]) {
      const result = await analyzeDependencies(knownRelationshipsApiModel, provider, {
        maxOperationsPerBatch,
      });
      for (const known of knownRelationships) {
        const [producerMethod, producerPath] = known.producer.split(" ");
        const [consumerMethod, consumerPath] = known.consumer.split(" ");
        const found = result.graph.relationships.some(
          (r) =>
            r.producer.operationMethod === producerMethod &&
            r.producer.operationPath === producerPath &&
            r.producer.field === known.producerField &&
            r.consumer.operationMethod === consumerMethod &&
            r.consumer.operationPath === consumerPath &&
            r.consumer.field === known.consumerField,
        );
        expect(found).toBe(true);
      }
    }
  });
});
