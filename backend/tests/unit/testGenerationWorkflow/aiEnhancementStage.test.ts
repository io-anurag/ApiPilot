import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { AIProvider } from "@apipilot/shared-domain";
import { buildApiModel } from "../../../src/openapi/buildApiModel";
import { parseYaml } from "../../../src/openapi/parseYaml";
import { validateSpec } from "../../../src/openapi/validateSpec";
import { continueApiReview } from "../../../src/testGenerationWorkflow/apiReviewStage";
import { runAiEnhancement } from "../../../src/testGenerationWorkflow/aiEnhancementStage";
import { runDeterministicGeneration } from "../../../src/testGenerationWorkflow/deterministicGenerationStage";
import {
  AiEnhancementAlreadyRunningError,
  StageNotActiveError,
} from "../../../src/testGenerationWorkflow/errors";
import {
  applyScenarioDecisions,
  finalizeScenarioReview,
} from "../../../src/testGenerationWorkflow/scenarioReviewStage";
import {
  getCurrentWorkflow,
  resetStore,
  startWorkflow,
} from "../../../src/testGenerationWorkflow/workflowStore";

async function validApiModel() {
  const content = readFileSync(
    path.join(__dirname, "..", "..", "fixtures", "openapi", "valid.yaml"),
    "utf-8",
  );
  const { document, issues } = await validateSpec(parseYaml(content));
  return buildApiModel(document, issues);
}

const mockProvider: AIProvider = {
  mode: "mock",
  getReadiness: () => ({
    state: "ready",
    acceleratorRequested: false,
    acceleratorActive: false,
    updatedAt: new Date(0).toISOString(),
  }),
  getInputBudget: async () => undefined,
  infer: async (request) => ({
    contractVersion: 1,
    requestId: request.requestId,
    status: "success",
    content: JSON.stringify({ responseVersion: 1, candidates: [] }),
    modelId: "mock-model",
    provider: "mock",
    durationMs: 1,
  }),
};

async function reachAiEnhancement() {
  const apiModel = await validApiModel();
  startWorkflow({ specificationFilename: "valid.yaml", apiModel });
  continueApiReview();
  runDeterministicGeneration();
}

describe("aiEnhancementStage (happy path)", () => {
  beforeEach(() => resetStore());

  it("refuses to run while not the active stage", async () => {
    await expect(runAiEnhancement(mockProvider)).rejects.toThrow(StageNotActiveError);
  });

  it("a successful call completes the stage and seeds reviewWorkspace from enhancedTestModel", async () => {
    await reachAiEnhancement();
    const wf = await runAiEnhancement(mockProvider);
    expect(wf.stages.aiEnhancement.status).toBe("complete");
    expect(wf.aiEnhancement?.aiProviderOutcome).toBe("success");
    expect(wf.reviewWorkspace?.scenarios.length).toBe(
      wf.aiEnhancement?.enhancedTestModel.scenarios.length,
    );
    expect(wf.activeStageId).toBe("scenarioReview");
    expect(wf.stages.scenarioReview.status).toBe("active");
  });
});

const unavailableProvider: AIProvider = {
  mode: "mock",
  getReadiness: () => ({
    state: "unavailable",
    reason: "test",
    acceleratorRequested: false,
    acceleratorActive: false,
    updatedAt: new Date(0).toISOString(),
  }),
  getInputBudget: async () => undefined,
  infer: async () => {
    throw Object.assign(new Error("unavailable"), { category: "PROVIDER_UNAVAILABLE" });
  },
};

const aiCandidateResponse = JSON.stringify({
  responseVersion: 1,
  candidates: [
    {
      candidateId: "retry-candidate",
      operationPath: "/pets",
      operationMethod: "POST",
      category: "invalid-format",
      targetLocation: "body",
      targetField: "name",
      request: {
        pathParameters: {},
        queryParameters: {},
        headers: {},
        body: { name: "" },
      },
      assertions: [{ type: "status-code", expectedStatusCode: "201" }],
      rationale: "Exercise an empty pet name.",
      confidence: 0.8,
      assumptions: [],
    },
  ],
});

const successProvider: AIProvider = {
  ...mockProvider,
  infer: async (request) => ({
    contractVersion: 1,
    requestId: request.requestId,
    status: "success",
    content: aiCandidateResponse,
    modelId: "mock-model",
    provider: "mock",
    durationMs: 1,
  }),
};

describe("aiEnhancementStage (skip/retry, US4)", () => {
  beforeEach(() => resetStore());

  it("an unavailable provider marks the stage skipped, records the error, and still advances (FR-008)", async () => {
    await reachAiEnhancement();
    const wf = await runAiEnhancement(unavailableProvider);
    expect(wf.stages.aiEnhancement.status).toBe("skipped");
    expect(wf.stages.aiEnhancement.aiErrorCategory).toBe("PROVIDER_UNAVAILABLE");
    expect(wf.aiEnhancement?.aiProviderOutcome).toBe("unavailable");
    expect(wf.activeStageId).toBe("scenarioReview");
    const reviewIds = wf.reviewWorkspace?.scenarios.map((s) => s.scenarioId).sort();
    const deterministicIds = wf.deterministicTestModel?.scenarios.map((s) => s.id).sort();
    expect(reviewIds).toEqual(deterministicIds);
  });

  it("retrying after skip while scenarioReview is not complete folds new AI scenarios into the live workspace (FR-008a)", async () => {
    await reachAiEnhancement();
    await runAiEnhancement(unavailableProvider);
    const beforeRetryCount = getCurrentWorkflow()!.reviewWorkspace!.scenarios.length;

    const wf = await runAiEnhancement(successProvider);
    expect(wf.stages.aiEnhancement.status).toBe("complete");
    expect(wf.reviewWorkspace?.scenarios.length).toBe(beforeRetryCount + 1);
    // Existing deterministic scenarios are untouched, not reset to a fresh workspace.
    const added = wf.reviewWorkspace?.scenarios.find(
      (s) => s.scenario.provenance.source === "AI",
    );
    expect(added?.state).toBe("pending");
  });

  it("a partial outcome (some batches fail) marks the stage 'partial', not 'skipped', records the error, and still advances (FR-011, T028)", async () => {
    await reachAiEnhancement();
    let callCount = 0;
    const partialProvider: AIProvider = {
      ...mockProvider,
      // Small enough budget to split the fixture's 3 operations into per-operation batches.
      getInputBudget: async () => 10,
      infer: async (request) => {
        callCount += 1;
        if (callCount === 1) {
          throw Object.assign(new Error("timed out"), { category: "TIMEOUT" });
        }
        return {
          contractVersion: 1,
          requestId: request.requestId,
          status: "success",
          content: JSON.stringify({ responseVersion: 1, candidates: [] }),
          modelId: "mock-model",
          provider: "mock",
          durationMs: 1,
        };
      },
    };

    const wf = await runAiEnhancement(partialProvider);

    expect(callCount).toBeGreaterThan(1);
    expect(wf.aiEnhancement?.aiProviderOutcome).toBe("partial");
    expect(wf.stages.aiEnhancement.status).toBe("partial");
    expect(wf.stages.aiEnhancement.aiErrorCategory).toBe("TIMEOUT");
    expect(wf.activeStageId).toBe("scenarioReview");
  });

  it("refuses a retry once scenarioReview has been finalized", async () => {
    await reachAiEnhancement();
    await runAiEnhancement(unavailableProvider);
    const first = getCurrentWorkflow()!.reviewWorkspace!.scenarios[0];
    applyScenarioDecisions([
      { scenarioId: first.scenarioId, revision: first.revision, action: "accept" },
    ]);
    await finalizeScenarioReview();

    await expect(runAiEnhancement(successProvider)).rejects.toThrow(StageNotActiveError);
  });
});

/**
 * A scripted provider whose response, for any batch, contains one `positive` candidate per
 * operation present in that batch's request (parsed from the real serialized prompt) —
 * fixture-agnostic (no assertions/targetField, so it passes semantic validation against
 * whatever operations `valid.yaml` defines) and deterministic across calls with the same
 * input. `getInputBudget` returns 10, which — per the existing "partial outcome" test above —
 * is small enough to split `valid.yaml`'s 3 operations into one batch each.
 */
function perOperationCandidateProvider(): AIProvider & { infer: AIProvider["infer"] } {
  return {
    ...mockProvider,
    getInputBudget: async () => 10,
    infer: async (request) => {
      const parsed = JSON.parse(request.input) as {
        operations: { path: string; method: string }[];
      };
      const candidates = parsed.operations.map((op, i) => ({
        candidateId: `cand-${op.method}-${op.path}-${i}`,
        operationPath: op.path,
        operationMethod: op.method,
        category: "positive",
        request: { pathParameters: {}, queryParameters: {}, headers: {}, body: {} },
        assertions: [],
        rationale: `Exercise ${op.method} ${op.path}.`,
        confidence: 0.7,
        assumptions: [],
      }));
      return {
        contractVersion: 1,
        requestId: request.requestId,
        status: "success",
        content: JSON.stringify({ responseVersion: 1, candidates }),
        modelId: "mock-model",
        provider: "mock",
        durationMs: 1,
      };
    },
  };
}

describe("aiEnhancementStage (progress + incremental reveal, specs/012-ai-enhancement-progress)", () => {
  beforeEach(() => resetStore());

  it("populates and updates stages.aiEnhancement.progress as batches start/settle, revealing scenarios incrementally before the run finishes", async () => {
    await reachAiEnhancement();
    const provider = perOperationCandidateProvider();
    const originalInfer = provider.infer;
    const progressSnapshots: unknown[] = [];
    const reviewCountSnapshots: number[] = [];
    provider.infer = async (request) => {
      progressSnapshots.push(getCurrentWorkflow()!.stages.aiEnhancement.progress);
      reviewCountSnapshots.push(getCurrentWorkflow()!.reviewWorkspace!.scenarios.length);
      return originalInfer(request);
    };

    const wf = await runAiEnhancement(provider);

    expect(progressSnapshots).toHaveLength(3);
    expect(progressSnapshots[0]).toMatchObject({
      totalBatches: 3,
      batches: [
        { index: 0, status: "in-progress" },
        { index: 1, status: "pending" },
        { index: 2, status: "pending" },
      ],
    });
    expect(progressSnapshots[1]).toMatchObject({
      totalBatches: 3,
      batches: [
        { index: 0, status: "succeeded" },
        { index: 1, status: "in-progress" },
        { index: 2, status: "pending" },
      ],
    });
    expect(progressSnapshots[2]).toMatchObject({
      totalBatches: 3,
      batches: [
        { index: 0, status: "succeeded" },
        { index: 1, status: "succeeded" },
        { index: 2, status: "in-progress" },
      ],
    });
    // reviewWorkspace already grew before later batches even started (FR-009).
    expect(reviewCountSnapshots[1]).toBeGreaterThan(reviewCountSnapshots[0]);
    expect(reviewCountSnapshots[2]).toBeGreaterThan(reviewCountSnapshots[1]);
    // Final state: progress cleared, exactly one unambiguous terminal status (FR-006/FR-007).
    expect(wf.stages.aiEnhancement.progress).toBeUndefined();
    expect(wf.stages.aiEnhancement.status).toBe("complete");
  });

  it("preserves a review decision made on an early-revealed scenario after later batches subsequently settle, during a retry (FR-012)", async () => {
    // FR-012 is only reachable once scenarioReview is actually active/reachable, which today
    // happens only once a run finishes (the fresh-run case builds reviewWorkspace
    // incrementally too, but it isn't reviewable by the user until then) — a retry, per
    // FR-008a, is the realistic case where a user can be actively deciding on already-revealed
    // scenarios while a new, still-running batch set settles.
    await reachAiEnhancement();
    await runAiEnhancement(unavailableProvider);

    const provider = perOperationCandidateProvider();
    const originalInfer = provider.infer;
    let decided = false;
    provider.infer = async (request) => {
      if (!decided) {
        const firstAi = getCurrentWorkflow()!.reviewWorkspace!.scenarios.find(
          (s) => s.scenario.provenance.source === "AI",
        );
        if (firstAi) {
          applyScenarioDecisions([
            { scenarioId: firstAi.scenarioId, revision: firstAi.revision, action: "accept" },
          ]);
          decided = true;
        }
      }
      return originalInfer(request);
    };

    const wf = await runAiEnhancement(provider);

    expect(decided).toBe(true);
    const accepted = wf.reviewWorkspace?.scenarios.filter((s) => s.state === "accepted");
    expect(accepted?.length).toBe(1);
  });

  /**
   * Supersedes specs/012's FR-005 premise that a realistic specification is one batch. It never was
   * a design goal — it was a consequence of sizing batches by remaining context window, which is
   * what specs/014-ai-batching-policy replaces. A multi-operation specification now plans one unit
   * per operation, which is what makes progress, cancellation, and partial results reachable at all.
   * The invariant the original test protected — progress cleared once the stage settles — still
   * holds and is asserted here.
   */
  it("plans one unit per operation for a multi-operation specification (specs/014-ai-batching-policy FR-001)", async () => {
    await reachAiEnhancement();
    const operationCount = getCurrentWorkflow()!.apiModel!.operations.length;
    expect(operationCount).toBeGreaterThan(1);

    let capturedProgress: { totalBatches: number } | undefined;
    const provider: AIProvider = {
      ...mockProvider,
      infer: async (request) => {
        capturedProgress = getCurrentWorkflow()!.stages.aiEnhancement.progress;
        return mockProvider.infer(request);
      },
    };

    const wf = await runAiEnhancement(provider);

    expect(capturedProgress?.totalBatches).toBe(operationCount);
    // Progress is cleared the moment the stage reaches a terminal status.
    expect(wf.stages.aiEnhancement.progress).toBeUndefined();
    expect(wf.stages.aiEnhancement.status).toBe("complete");
  });
});

describe("aiEnhancementStage (concurrency guard, specs/012-ai-enhancement-progress FR-008)", () => {
  beforeEach(() => resetStore());

  it("rejects a second call while a run is already in progress, without disturbing the original run's progress", async () => {
    await reachAiEnhancement();
    let rejectionObserved = false;
    let progressAfterRejection: unknown;
    const provider: AIProvider = {
      ...mockProvider,
      getInputBudget: async () => 10,
      infer: async (request) => {
        if (request.requestId.endsWith("-batch1")) {
          await expect(runAiEnhancement(mockProvider)).rejects.toThrow(
            AiEnhancementAlreadyRunningError,
          );
          rejectionObserved = true;
          progressAfterRejection = getCurrentWorkflow()!.stages.aiEnhancement.progress;
        }
        return {
          contractVersion: 1,
          requestId: request.requestId,
          status: "success",
          content: JSON.stringify({ responseVersion: 1, candidates: [] }),
          modelId: "mock-model",
          provider: "mock",
          durationMs: 1,
        };
      },
    };

    const wf = await runAiEnhancement(provider);

    expect(rejectionObserved).toBe(true);
    // The rejected concurrent call must not have cleared the original run's own progress.
    expect(progressAfterRejection).toMatchObject({
      batches: [
        { index: 0, status: "succeeded" },
        { index: 1, status: "in-progress" },
        { index: 2, status: "pending" },
      ],
    });
    expect(wf.stages.aiEnhancement.status).toBe("complete");
  });

  it("clears progress immediately once the stage reaches a terminal status", async () => {
    await reachAiEnhancement();
    const wf = await runAiEnhancement(mockProvider);
    expect(wf.stages.aiEnhancement.progress).toBeUndefined();
  });
});
