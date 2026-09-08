import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { AIProvider } from "@apipilot/shared-domain";
import { buildApiModel } from "../../../src/openapi/buildApiModel";
import { parseYaml } from "../../../src/openapi/parseYaml";
import { validateSpec } from "../../../src/openapi/validateSpec";
import { continueApiReview } from "../../../src/testGenerationWorkflow/apiReviewStage";
import {
  runAiEnhancement,
  retryAiEnhancementBatch,
} from "../../../src/testGenerationWorkflow/aiEnhancementStage";
import { runDeterministicGeneration } from "../../../src/testGenerationWorkflow/deterministicGenerationStage";
import {
  AiEnhancementAlreadyRunningError,
  BatchNotFoundError,
  BatchNotRetryableError,
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

async function reachAiEnhancement() {
  const apiModel = await validApiModel();
  startWorkflow({ specificationFilename: "valid.yaml", apiModel });
  continueApiReview();
  runDeterministicGeneration();
}

/**
 * `valid.yaml`'s 3 operations are batched one-per-batch (`getInputBudget` returns 10). `behavior`
 * controls, per `"METHOD /path"` key, whether that operation's calls fail (PROVIDER_UNAVAILABLE —
 * retryable) or succeed with one fixed candidate. Defaults to succeeding.
 */
function makeControllableProvider() {
  const behavior = new Map<string, "fail" | "succeed">();
  let candidateSeq = 0;
  const provider: AIProvider = {
    mode: "mock",
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: new Date(0).toISOString(),
    }),
    getInputBudget: async () => 10,
    infer: async (request) => {
      const parsed = JSON.parse(request.input) as {
        operations: { path: string; method: string }[];
      };
      const op = parsed.operations[0];
      const key = `${op.method} ${op.path}`;
      if (behavior.get(key) === "fail") {
        throw Object.assign(new Error("unavailable"), {
          category: "PROVIDER_UNAVAILABLE",
        });
      }
      candidateSeq += 1;
      const candidates = [
        {
          candidateId: `cand-${key}-${candidateSeq}`,
          operationPath: op.path,
          operationMethod: op.method,
          category: "positive",
          request: { pathParameters: {}, queryParameters: {}, headers: {}, body: {} },
          assertions: [],
          rationale: `Exercise ${key}.`,
          confidence: 0.7,
          assumptions: [],
        },
      ];
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
  return { provider, behavior };
}

const FAILING_KEY = "POST /pets";
const FAILING_INDEX = 1; // GET /pets=0, POST /pets=1, GET /pets/{petId}=2, per valid.yaml order.

async function settlePartialRun() {
  const { provider, behavior } = makeControllableProvider();
  behavior.set(FAILING_KEY, "fail");
  await reachAiEnhancement();
  const wf = await runAiEnhancement(provider);
  expect(wf.stages.aiEnhancement.status).toBe("partial");
  return { provider, behavior };
}

describe("retryAiEnhancementBatch (specs/015-ai-batch-retry US1)", () => {
  beforeEach(() => resetStore());

  it("a successful retry adds only that batch's scenarios and leaves every other batch untouched", async () => {
    const { provider, behavior } = await settlePartialRun();
    const before = getCurrentWorkflow()!.reviewWorkspace!.scenarios;
    const beforeIds = new Set(before.map((s) => s.scenarioId));
    const beforeOtherScenarios = before.filter(
      (s) => s.scenario.provenance.source !== "AI" || s.scenario.operationPath !== "/pets",
    );

    behavior.set(FAILING_KEY, "succeed");
    const wf = await retryAiEnhancementBatch(FAILING_INDEX, provider);

    const outcomes = wf.stages.aiEnhancement.batchOutcomes!;
    expect(outcomes[FAILING_INDEX].status).toBe("succeeded");
    expect(outcomes[0].status).toBe("succeeded"); // untouched
    expect(outcomes[2].status).toBe("succeeded"); // untouched

    const after = wf.reviewWorkspace!.scenarios;
    const added = after.filter((s) => !beforeIds.has(s.scenarioId));
    expect(added).toHaveLength(1);
    expect(added[0].scenario.provenance).toMatchObject({
      source: "AI",
      aiBatchIndex: FAILING_INDEX,
    });
    // Every scenario that existed before the retry is still present, unchanged.
    for (const scenario of beforeOtherScenarios) {
      expect(after.find((s) => s.scenarioId === scenario.scenarioId)).toEqual(scenario);
    }
  });

  it("retrying the only outstanding batch to success recomputes the stage status to complete", async () => {
    const { provider, behavior } = await settlePartialRun();
    behavior.set(FAILING_KEY, "succeed");

    const wf = await retryAiEnhancementBatch(FAILING_INDEX, provider);

    expect(wf.stages.aiEnhancement.status).toBe("complete");
  });

  it("a repeat failure updates only that batch's own record", async () => {
    const { provider } = await settlePartialRun();
    const before = getCurrentWorkflow()!.reviewWorkspace!.scenarios;

    const wf = await retryAiEnhancementBatch(FAILING_INDEX, provider);

    expect(wf.stages.aiEnhancement.status).toBe("partial");
    const outcomes = wf.stages.aiEnhancement.batchOutcomes!;
    expect(outcomes[FAILING_INDEX].status).toBe("failed");
    expect(outcomes[FAILING_INDEX].errorCategory).toBe("PROVIDER_UNAVAILABLE");
    expect(outcomes[0].status).toBe("succeeded");
    expect(outcomes[2].status).toBe("succeeded");
    expect(wf.reviewWorkspace!.scenarios).toEqual(before);
  });

  it("rejects retrying a batch that already succeeded", async () => {
    const { provider } = await settlePartialRun();
    await expect(retryAiEnhancementBatch(0, provider)).rejects.toThrow(
      BatchNotRetryableError,
    );
  });

  it("rejects retrying a batch whose failure category is not retryable", async () => {
    await reachAiEnhancement();
    let callCount = 0;
    const timeoutThenSucceed: AIProvider = {
      mode: "mock",
      getReadiness: () => ({
        state: "ready",
        acceleratorRequested: false,
        acceleratorActive: false,
        updatedAt: new Date(0).toISOString(),
      }),
      getInputBudget: async () => 10,
      infer: async (request) => {
        callCount += 1;
        if (callCount <= 2) {
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
    const wf = await runAiEnhancement(timeoutThenSucceed);
    expect(wf.stages.aiEnhancement.batchOutcomes![0].status).toBe("failed");

    await expect(retryAiEnhancementBatch(0, timeoutThenSucceed)).rejects.toThrow(
      BatchNotRetryableError,
    );
  });

  it("rejects an out-of-range batch index", async () => {
    const { provider } = await settlePartialRun();
    await expect(retryAiEnhancementBatch(99, provider)).rejects.toThrow(BatchNotFoundError);
  });

  it("rejects a batch retry while another AI enhancement operation is already in progress", async () => {
    await reachAiEnhancement();
    let rejectionObserved = false;
    const provider: AIProvider = {
      mode: "mock",
      getReadiness: () => ({
        state: "ready",
        acceleratorRequested: false,
        acceleratorActive: false,
        updatedAt: new Date(0).toISOString(),
      }),
      getInputBudget: async () => 10,
      infer: async (request) => {
        if (request.requestId.endsWith("-batch1") && !rejectionObserved) {
          rejectionObserved = true;
          await expect(retryAiEnhancementBatch(0, provider)).rejects.toThrow(
            AiEnhancementAlreadyRunningError,
          );
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

    await runAiEnhancement(provider);
    expect(rejectionObserved).toBe(true);
  });

  it("rejects a batch retry once scenarioReview has been finalized (specs/015-ai-batch-retry US3)", async () => {
    const { provider } = await settlePartialRun();
    const first = getCurrentWorkflow()!.reviewWorkspace!.scenarios[0];
    applyScenarioDecisions([
      { scenarioId: first.scenarioId, revision: first.revision, action: "accept" },
    ]);
    await finalizeScenarioReview();

    await expect(retryAiEnhancementBatch(FAILING_INDEX, provider)).rejects.toThrow(
      StageNotActiveError,
    );
  });
});
