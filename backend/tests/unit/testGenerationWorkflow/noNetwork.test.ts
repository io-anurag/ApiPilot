import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider } from "@apipilot/shared-domain";
import { buildApiModel } from "../../../src/openapi/buildApiModel";
import { parseYaml } from "../../../src/openapi/parseYaml";
import { validateSpec } from "../../../src/openapi/validateSpec";
import { continueApiReview } from "../../../src/testGenerationWorkflow/apiReviewStage";
import { runAiEnhancement } from "../../../src/testGenerationWorkflow/aiEnhancementStage";
import { runDeterministicGeneration } from "../../../src/testGenerationWorkflow/deterministicGenerationStage";
import { recordWorkflowDecisions, continueWorkflowReview } from "../../../src/testGenerationWorkflow/workflowReviewStage";
import { runPostmanGeneration } from "../../../src/testGenerationWorkflow/postmanGenerationStage";
import { applyScenarioDecisions, finalizeScenarioReview } from "../../../src/testGenerationWorkflow/scenarioReviewStage";
import { getCurrentWorkflow, resetStore, startWorkflow } from "../../../src/testGenerationWorkflow/workflowStore";

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

beforeEach(() => resetStore());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** FR-013, SC-007: no stage-transition endpoint issues a request to any host described by the ApiModel. */
describe("test generation workflow network isolation", () => {
  it("issues no fetch, http, or https request across the full sequence", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("workflow orchestration must not issue a network request");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const httpRequest = vi.spyOn(http, "request").mockImplementation(() => {
      throw new Error("workflow orchestration must not issue a network request");
    });
    const httpsRequest = vi.spyOn(https, "request").mockImplementation(() => {
      throw new Error("workflow orchestration must not issue a network request");
    });

    const content = readFileSync(path.join(__dirname, "..", "..", "fixtures", "openapi", "valid.yaml"), "utf-8");
    const { document, issues } = await validateSpec(parseYaml(content));
    const apiModel = buildApiModel(document, issues);
    startWorkflow({ specificationFilename: "valid.yaml", apiModel });
    continueApiReview();
    runDeterministicGeneration();
    await runAiEnhancement(mockProvider);

    const scenario = getCurrentWorkflow()!.reviewWorkspace!.scenarios[0];
    applyScenarioDecisions([{ scenarioId: scenario.scenarioId, revision: scenario.revision, action: "accept" }]);
    await finalizeScenarioReview(mockProvider);

    const discovered = getCurrentWorkflow()!.dependencyAnalysis!.workflows;
    if (discovered.length > 0) {
      recordWorkflowDecisions(discovered.map((w) => ({ workflowId: w.id, state: "approved" as const })));
      continueWorkflowReview();
    }
    runPostmanGeneration();

    expect(getCurrentWorkflow()!.stages.postmanGeneration.status).toBe("complete");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
  });
});
