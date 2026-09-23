import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider, TestGenerationWorkflow } from "@apipilot/shared-domain";

// Holds finalize open at its dependency-analysis step until the test releases it, so the
// in-flight window can be exercised deterministically rather than by racing a real analysis.
let releaseAnalysis: (() => void) | undefined;
vi.mock("../../../src/testGenerationWorkflow/dependencyAnalysisStage", async () => {
  const store = await import("../../../src/testGenerationWorkflow/workflowStore");
  return {
    runDependencyAnalysis: () =>
      new Promise<TestGenerationWorkflow>((resolve) => {
        releaseAnalysis = () => {
          store.updateStage("dependencyAnalysis", "complete");
          resolve(store.advanceActiveStage("workflowReview"));
        };
      }),
  };
});

const { buildApiModel } = await import("../../../src/openapi/buildApiModel");
const { parseYaml } = await import("../../../src/openapi/parseYaml");
const { validateSpec } = await import("../../../src/openapi/validateSpec");
const { continueApiReview } = await import("../../../src/testGenerationWorkflow/apiReviewStage");
const { runAiEnhancement } = await import("../../../src/testGenerationWorkflow/aiEnhancementStage");
const { runDeterministicGeneration } = await import(
  "../../../src/testGenerationWorkflow/deterministicGenerationStage"
);
const { StageNotActiveError } = await import("../../../src/testGenerationWorkflow/errors");
const { applyScenarioDecisions, editScenario, finalizeScenarioReview } = await import(
  "../../../src/testGenerationWorkflow/scenarioReviewStage"
);
const { getCurrentWorkflow, resetStore, startWorkflow } = await import(
  "../../../src/testGenerationWorkflow/workflowStore"
);

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

async function reachScenarioReviewWithOneAccepted() {
  const content = readFileSync(
    path.join(__dirname, "..", "..", "fixtures", "openapi", "valid.yaml"),
    "utf-8",
  );
  const { document, issues } = await validateSpec(parseYaml(content));
  startWorkflow({ specificationFilename: "valid.yaml", apiModel: buildApiModel(document, issues) });
  continueApiReview();
  runDeterministicGeneration();
  await runAiEnhancement(unavailableProvider);
  const [first] = getCurrentWorkflow()!.reviewWorkspace!.scenarios;
  applyScenarioDecisions([{ scenarioId: first.scenarioId, revision: first.revision, action: "accept" }]);
}

describe("scenario review is locked while finalize is in flight", () => {
  beforeEach(() => {
    resetStore();
    releaseAnalysis = undefined;
  });

  it("refuses decisions and edits until finalize settles, then allows revisiting again", async () => {
    await reachScenarioReviewWithOneAccepted();
    const finalizing = finalizeScenarioReview();
    const second = getCurrentWorkflow()!.reviewWorkspace!.scenarios[1];

    expect(() =>
      applyScenarioDecisions([{ scenarioId: second.scenarioId, revision: second.revision, action: "accept" }]),
    ).toThrow(StageNotActiveError);
    const edit = { request: second.scenario.request, assertions: second.scenario.assertions };
    expect(() => editScenario(second.scenarioId, second.revision, edit)).toThrow(StageNotActiveError);
    // The refused request changed nothing: finalize's projected suite and stage state are intact.
    expect(getCurrentWorkflow()!.stages.scenarioReview.status).toBe("complete");
    expect(getCurrentWorkflow()!.activeStageId).toBe("dependencyAnalysis");

    releaseAnalysis!();
    const settled = await finalizing;
    expect(settled.activeStageId).toBe("workflowReview");
    expect(settled.approvedTestModel!.scenarios).toHaveLength(1);

    // Once finalize has settled, revising reopens the review as before (FR-006).
    const { outcomes } = applyScenarioDecisions([
      { scenarioId: second.scenarioId, revision: second.revision, action: "accept" },
    ]);
    expect(outcomes[0].applied).toBe(true);
    expect(getCurrentWorkflow()!.activeStageId).toBe("scenarioReview");
  });
});
