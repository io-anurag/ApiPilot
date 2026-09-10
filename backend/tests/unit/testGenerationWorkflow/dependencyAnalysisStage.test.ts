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
  patchWorkflow,
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
    // finalizeScenarioReview always sets approvedTestModel before this stage runs (research.md,
    // updated: dependencyAnalysis now scopes its input to the operations these scenarios touch),
    // so this stand-in must too rather than leaving it unset.
    patchWorkflow({
      approvedTestModel: {
        scenarios: [
          {
            id: "s1",
            operationPath: "/pets",
            operationMethod: "GET",
            category: "positive",
            request: { pathParameters: {}, queryParameters: {}, headers: {} },
            assertions: [],
            provenance: {
              source: "RULE",
              rule: "positive",
              description: "baseline positive case",
              duplicateOfRules: [],
            },
          },
        ],
      },
    });
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

  function scenario(operationPath: string, operationMethod: string, id: string) {
    return {
      id,
      operationPath,
      operationMethod,
      category: "positive" as const,
      request: { pathParameters: {}, queryParameters: {}, headers: {} },
      assertions: [],
      provenance: {
        source: "RULE" as const,
        rule: "positive",
        description: "baseline positive case",
        duplicateOfRules: [],
      },
    };
  }

  async function activateDependencyAnalysis(approvedScenarios: ReturnType<typeof scenario>[]) {
    const apiModel = await validApiModel();
    startWorkflow({ specificationFilename: "valid.yaml", apiModel });
    updateStage("apiReview", "complete");
    updateStage("deterministicGeneration", "active");
    updateStage("deterministicGeneration", "complete");
    updateStage("aiEnhancement", "active");
    updateStage("aiEnhancement", "complete");
    updateStage("scenarioReview", "active");
    patchWorkflow({ approvedTestModel: { scenarios: approvedScenarios } });
    updateStage("scenarioReview", "complete");
    updateStage("dependencyAnalysis", "active");
  }

  it("excludes a relationship whose consumer operation has no approved scenario, even though a deterministic match would otherwise be found (the whole reason to scope)", async () => {
    // POST /pets (producer 'id') -> GET /pets/{petId} (consumer 'petId') is a genuine
    // deterministic LIKELY match (resource-path prefix + the bare-'id' naming idiom) — but only
    // POST /pets is approved here, so the consumer side is out of scope and the relationship must
    // not appear, even though full-ApiModel analysis would have found it.
    await activateDependencyAnalysis([scenario("/pets", "POST", "s1")]);

    const wf = await runDependencyAnalysis();

    expect(wf.dependencyAnalysis!.graph.relationships).toEqual([]);
    expect(wf.dependencyAnalysis!.workflows).toEqual([]);
  });

  it("still finds that same relationship once both its producer and consumer operations have an approved scenario", async () => {
    await activateDependencyAnalysis([
      scenario("/pets", "POST", "s1"),
      scenario("/pets/{petId}", "GET", "s2"),
    ]);

    const wf = await runDependencyAnalysis();

    const found = wf.dependencyAnalysis!.graph.relationships.some(
      (r) => r.producer.operationPath === "/pets" && r.consumer.operationPath === "/pets/{petId}",
    );
    expect(found).toBe(true);
  });
});
