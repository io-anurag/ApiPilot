import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApiModel } from "../../../src/openapi/buildApiModel";
import { parseYaml } from "../../../src/openapi/parseYaml";
import { validateSpec } from "../../../src/openapi/validateSpec";
import { StageNotActiveError } from "../../../src/testGenerationWorkflow/errors";
import { runDependencyAnalysis } from "../../../src/testGenerationWorkflow/dependencyAnalysisStage";
import {
  getCurrentWorkflow,
  resetStore,
  startWorkflow,
  updateStage,
} from "../../../src/testGenerationWorkflow/workflowStore";

async function validApiModel() {
  const content = readFileSync(
    path.join(__dirname, "..", "..", "fixtures", "openapi", "valid.yaml"),
    "utf-8",
  );
  const { document, issues } = await validateSpec(parseYaml(content));
  return buildApiModel(document, issues);
}

describe("dependencyAnalysisStage", () => {
  beforeEach(() => resetStore());

  it("refuses to run while not the active stage", async () => {
    await expect(runDependencyAnalysis()).rejects.toThrow(StageNotActiveError);
  });

  it("runs analyzeDependencies over the ApiModel, stores the result, and advances past workflowReview when empty", async () => {
    const apiModel = await validApiModel();
    startWorkflow({ specificationFilename: "valid.yaml", apiModel });
    updateStage("apiReview", "complete");
    updateStage("deterministicGeneration", "active");
    updateStage("deterministicGeneration", "complete");
    updateStage("aiEnhancement", "active");
    updateStage("aiEnhancement", "complete");
    updateStage("scenarioReview", "active");
    updateStage("scenarioReview", "complete");
    updateStage("dependencyAnalysis", "active");

    const wf = await runDependencyAnalysis();
    expect(wf.stages.dependencyAnalysis.status).toBe("complete");
    expect(wf.dependencyAnalysis).toBeDefined();
    // valid.yaml's fixture has no CONFIRMED/LIKELY chain and no AI provider, so workflowReview
    // auto-completes (D5) straight through to postmanGeneration.
    if (wf.dependencyAnalysis!.workflows.length === 0 && wf.dependencyAnalysis!.manualConfirmationCandidates.length === 0) {
      expect(wf.stages.workflowReview.status).toBe("complete");
      expect(wf.activeStageId).toBe("postmanGeneration");
    } else {
      expect(wf.stages.workflowReview.status).toBe("active");
      expect(wf.activeStageId).toBe("workflowReview");
    }
    expect(getCurrentWorkflow()).toEqual(wf);
  });
});
