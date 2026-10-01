import { describe, expect, it } from "vitest";
import type { AIProvider, InferenceRequest, InferenceResponse } from "@apipilot/shared-domain";
import {
  analyzeDependencies,
  DependencyAnalysisTimeoutError,
} from "../../../src/dependencies/analyzeDependencies";
import { buildLargeApiModel, crudChainApiModel } from "../../fixtures/dependencies/dependencyFixtures";
import { AI_DEPENDENCY_RESPONSE_VERSION } from "../../../src/dependencies/aiDependencyPrompt";

/**
 * A provider whose single inference takes `delayMs` and then resolves however `respond` says.
 * Deliberately slower than the analysis budget the tests below pass, standing in for a local
 * model whose synchronous generation cannot be preempted by the provider's own timeout.
 */
function slowProvider(delayMs: number, respond: (request: InferenceRequest) => InferenceResponse): AIProvider {
  return {
    mode: "mock",
    getReadiness: () => ({
      state: "ready",
      modelId: "slow-test-model",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: new Date().toISOString(),
    }),
    getInputBudget: async () => undefined,
    infer: async (request: InferenceRequest) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return respond(request);
    },
  };
}

function timedOutResponse(request: InferenceRequest): InferenceResponse {
  return {
    contractVersion: 1,
    requestId: request.requestId,
    status: "error",
    errorCategory: "TIMEOUT",
    errorMessage: "provider timed out",
    modelId: "slow-test-model",
    provider: "mock",
    durationMs: 0,
  };
}

function successResponse(request: InferenceRequest): InferenceResponse {
  return {
    contractVersion: 1,
    requestId: request.requestId,
    status: "success",
    content: JSON.stringify({ responseVersion: AI_DEPENDENCY_RESPONSE_VERSION, candidates: [] }),
    modelId: "slow-test-model",
    provider: "mock",
    durationMs: 0,
  };
}

/**
 * Budget for the deterministic work in the AI-pass tests below, and a provider delay well past it.
 * The budget must leave real headroom: deterministic matching + workflow assembly is cheap but
 * shares CPU with the rest of the parallel suite, and a 10ms budget flaked under that load. The
 * delay must still clearly exceed the budget so a regression that charges the AI pass's
 * wall-clock to it would throw.
 */
const DETERMINISTIC_BUDGET_MS = 150;
const SLOW_AI_DELAY_MS = 400;

describe("analyzeDependencies timeout guard", () => {
  it("rejects with DependencyAnalysisTimeoutError when the budget is exceeded, rather than hanging or returning a partial result", async () => {
    const largeModel = buildLargeApiModel(200);

    await expect(
      analyzeDependencies(largeModel, undefined, { timeoutMs: -1 }),
    ).rejects.toBeInstanceOf(DependencyAnalysisTimeoutError);
  });

  it("still succeeds under a generous budget", async () => {
    const largeModel = buildLargeApiModel(200);
    const result = await analyzeDependencies(largeModel, undefined, { timeoutMs: 60_000 });
    expect(result.graph.relationships.length).toBeGreaterThan(0);
  });

  /**
   * Regression: a single-batch AI pass that overruns the budget must still degrade to the
   * deterministic-only result, not throw. The guard previously charged the AI pass's wall-clock
   * to this budget and only spared a run that had *skipped* a batch — impossible with one batch —
   * so every overrunning single-batch run threw, which reached an async Express handler as an
   * unhandled rejection and terminated the backend process mid-workflow.
   */
  it("degrades rather than throwing when a single-batch AI pass overruns the analysis budget", async () => {
    const provider = slowProvider(SLOW_AI_DELAY_MS, timedOutResponse);

    // Work-bounded sizing disabled (`maxOperationsPerBatch: 0`) so this stays genuinely
    // single-batch as titled, isolated from specs/014's default unit size.
    const result = await analyzeDependencies(crudChainApiModel, provider, {
      timeoutMs: DETERMINISTIC_BUDGET_MS,
      maxOperationsPerBatch: 0,
    });

    expect(result.aiOutcome).toBe("timeout");
    expect(result.aiErrorCategory).toBe("TIMEOUT");
    // The deterministic relationships survive the AI pass's failure.
    expect(result.graph.relationships.length).toBeGreaterThan(0);
  });

  /** A *successful* AI pass slower than the budget must keep its result rather than have it discarded. */
  it("keeps the result of a successful AI pass that took longer than the analysis budget", async () => {
    const provider = slowProvider(SLOW_AI_DELAY_MS, successResponse);

    const result = await analyzeDependencies(crudChainApiModel, provider, {
      timeoutMs: DETERMINISTIC_BUDGET_MS,
      maxOperationsPerBatch: 0,
    });

    expect(result.aiOutcome).toBe("success");
    expect(result.graph.relationships.length).toBeGreaterThan(0);
  });
});
