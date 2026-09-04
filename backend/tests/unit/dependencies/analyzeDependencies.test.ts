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
} from "../../fixtures/dependencies/dependencyFixtures";
import { buildAIDependencyPrompt } from "../../../src/dependencies/aiDependencyPrompt";

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
  it("regression: a small ApiModel produces exactly one provider.infer() call (FR-006)", async () => {
    const provider = scriptedBatchProvider({ budgetChars: undefined });

    const result = await analyzeDependencies(crudChainApiModel, provider);

    expect(provider.calls).toHaveLength(1);
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
    const hugeOperation = {
      ...crudChainApiModel.operations[0],
      path: "/huge-operation",
      operationId: "hugeOperation",
      tags: Array.from({ length: 3000 }, (_, i) => `filler-tag-${i}`),
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
        const parsed = JSON.parse(request.input) as {
          apiModel: { operations: unknown[] };
        };
        const containsHugeOp = request.input.includes("hugeOperation");
        if (containsHugeOp) {
          hugeOperationBatchSize = parsed.apiModel.operations.length;
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

  it("gracefully degrades (never throws) once the overall analysis budget is exhausted mid-run, marking remaining batches not-attempted (FR-010, T027)", async () => {
    const largeModel = buildLargeApiModel(20);
    const budgetChars = Math.floor(buildAIDependencyPrompt(largeModel).length / 6);
    const provider = scriptedBatchProvider({ budgetChars, delayMs: 20 });

    const result = await analyzeDependencies(largeModel, provider, { timeoutMs: 15 });

    expect(provider.calls.length).toBeGreaterThanOrEqual(1);
    expect(provider.calls.length).toBeLessThan(6);
    expect(result.aiOutcome).toBe("partial");
  });
});
