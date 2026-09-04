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
import { StageNotActiveError } from "../../../src/testGenerationWorkflow/errors";
import { applyScenarioDecisions, finalizeScenarioReview } from "../../../src/testGenerationWorkflow/scenarioReviewStage";
import { getCurrentWorkflow, resetStore, startWorkflow } from "../../../src/testGenerationWorkflow/workflowStore";

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
    expect(wf.reviewWorkspace?.scenarios.length).toBe(wf.aiEnhancement?.enhancedTestModel.scenarios.length);
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
      request: { pathParameters: {}, queryParameters: {}, headers: {}, body: { name: "" } },
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
    const added = wf.reviewWorkspace?.scenarios.find((s) => s.scenario.provenance.source === "AI");
    expect(added?.state).toBe("pending");
  });

  it("refuses a retry once scenarioReview has been finalized", async () => {
    await reachAiEnhancement();
    await runAiEnhancement(unavailableProvider);
    const first = getCurrentWorkflow()!.reviewWorkspace!.scenarios[0];
    applyScenarioDecisions([{ scenarioId: first.scenarioId, revision: first.revision, action: "accept" }]);
    await finalizeScenarioReview();

    await expect(runAiEnhancement(successProvider)).rejects.toThrow(StageNotActiveError);
  });
});
