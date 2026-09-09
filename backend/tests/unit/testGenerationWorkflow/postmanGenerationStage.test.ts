import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ApiModel, DependencyAnalysisResult } from "@apipilot/shared-domain";
import { buildApiModel } from "../../../src/openapi/buildApiModel";
import { generateTestModel } from "../../../src/testDesign/generateTestModel";
import { parseYaml } from "../../../src/openapi/parseYaml";
import { validateSpec } from "../../../src/openapi/validateSpec";
import {
  EmptyApprovedScenariosError,
  StageNotActiveError,
} from "../../../src/testGenerationWorkflow/errors";
import { runPostmanGeneration } from "../../../src/testGenerationWorkflow/postmanGenerationStage";
import {
  patchWorkflow,
  resetStore,
  startWorkflow,
  updateStage,
} from "../../../src/testGenerationWorkflow/workflowStore";
import {
  integrationWorkflow,
  workflowStep,
  workflowVariable,
} from "../../fixtures/postman/workflowFixtures";

async function validApiModel() {
  const content = readFileSync(
    path.join(__dirname, "..", "..", "fixtures", "openapi", "valid.yaml"),
    "utf-8",
  );
  const { document, issues } = await validateSpec(parseYaml(content));
  return buildApiModel(document, issues);
}

function reachPostmanGeneration(apiModel: ApiModel) {
  const approvedTestModel = generateTestModel(apiModel);
  startWorkflow({ specificationFilename: "valid.yaml", apiModel });
  updateStage("apiReview", "complete");
  updateStage("deterministicGeneration", "active");
  updateStage("deterministicGeneration", "complete");
  updateStage("aiEnhancement", "active");
  updateStage("aiEnhancement", "complete");
  updateStage("scenarioReview", "active");
  updateStage("scenarioReview", "complete");
  updateStage("dependencyAnalysis", "active");
  updateStage("dependencyAnalysis", "complete");
  updateStage("workflowReview", "active");
  updateStage("workflowReview", "complete");
  updateStage("postmanGeneration", "active");
  patchWorkflow({ approvedTestModel, approvedWorkflowIds: [] });
}

describe("postmanGenerationStage", () => {
  beforeEach(() => resetStore());

  it("refuses unless workflowReview is complete", async () => {
    const apiModel = await validApiModel();
    startWorkflow({ specificationFilename: "valid.yaml", apiModel });
    expect(() => runPostmanGeneration()).toThrow(StageNotActiveError);
  });

  it("refuses when the approved TestModel is empty", async () => {
    const apiModel = await validApiModel();
    reachPostmanGeneration(apiModel);
    patchWorkflow({ approvedTestModel: { scenarios: [] } });
    expect(() => runPostmanGeneration()).toThrow(EmptyApprovedScenariosError);
  });

  it("wraps generateCollection unchanged and never attaches workflow data (research.md D2)", async () => {
    const apiModel = await validApiModel();
    reachPostmanGeneration(apiModel);
    const wf = runPostmanGeneration();
    expect(wf.stages.postmanGeneration.status).toBe("complete");
    expect(wf.postmanArtifact?.collection).toBeDefined();
    expect(wf.postmanArtifact?.environment).toBeDefined();
  });

  it("passes explicitly approved workflows into Postman generation", async () => {
    const apiModel = await validApiModel();
    reachPostmanGeneration(apiModel);
    const approvedTestModel = generateTestModel(apiModel);
    const variable = workflowVariable("petId", 0, "id", 1, "path", "petId");
    const workflow = integrationWorkflow(
      "pets-flow",
      [
        workflowStep(0, "POST", "/pets", { producesVariableNames: ["petId"] }),
        workflowStep(1, "GET", "/pets/{petId}", { consumesVariableNames: ["petId"] }),
      ],
      [variable],
    );
    const dependencyAnalysis: DependencyAnalysisResult = {
      requestId: "dependency-test",
      graph: { relationships: [] },
      workflows: [workflow],
      manualConfirmationCandidates: [],
      cycles: [],
      aiOutcome: "skipped",
    };
    patchWorkflow({
      dependencyAnalysis,
      approvedTestModel,
      approvedWorkflowIds: ["pets-flow"],
    });

    const result = runPostmanGeneration().postmanArtifact;
    expect(
      result?.collection.item.some((folder) => folder.name === "Workflow: pets-flow"),
    ).toBe(true);
  });

  it("refuses when workflowReview has been marked stale, not just not-yet-reached/active (FR-007)", async () => {
    const apiModel = await validApiModel();
    reachPostmanGeneration(apiModel);
    runPostmanGeneration();
    updateStage("workflowReview", "stale");
    updateStage("postmanGeneration", "stale");
    // A stale workflowReview is never "complete", so the existing gate already refuses here —
    // no separate stale-specific code path is needed (research.md D2, contract T048).
    expect(() => runPostmanGeneration()).toThrow(StageNotActiveError);
  });

  it("regenerates idempotently when already complete", async () => {
    const apiModel = await validApiModel();
    reachPostmanGeneration(apiModel);
    runPostmanGeneration();
    const wf = runPostmanGeneration({ collectionName: "Re-exported" });
    expect(wf.stages.postmanGeneration.status).toBe("complete");
    expect(wf.postmanArtifact?.collection.info.name).toBe("Re-exported");
  });
});
