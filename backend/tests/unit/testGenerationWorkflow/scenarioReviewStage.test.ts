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
  EmptyApprovedScenariosError,
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

async function reachScenarioReview() {
  const content = readFileSync(
    path.join(__dirname, "..", "..", "fixtures", "openapi", "valid.yaml"),
    "utf-8",
  );
  const { document, issues } = await validateSpec(parseYaml(content));
  const apiModel = buildApiModel(document, issues);
  startWorkflow({ specificationFilename: "valid.yaml", apiModel });
  continueApiReview();
  runDeterministicGeneration();
  await runAiEnhancement(unavailableProvider);
}

describe("scenarioReviewStage", () => {
  beforeEach(() => resetStore());

  it("refuses decisions while scenarioReview is not active", () => {
    expect(() => applyScenarioDecisions([])).toThrow(StageNotActiveError);
  });

  it("applies accept/reject decisions against the stored workspace", async () => {
    await reachScenarioReview();
    const first = getCurrentWorkflow()!.reviewWorkspace!.scenarios[0];
    const { workflow, outcomes } = applyScenarioDecisions([
      { scenarioId: first.scenarioId, revision: first.revision, action: "accept" },
    ]);
    expect(outcomes[0].applied).toBe(true);
    expect(
      workflow.reviewWorkspace?.scenarios.find((s) => s.scenarioId === first.scenarioId)
        ?.state,
    ).toBe("accepted");
  });

  it("finalize refuses with EmptyApprovedScenariosError when nothing was approved", async () => {
    await reachScenarioReview();
    await expect(finalizeScenarioReview()).rejects.toThrow(EmptyApprovedScenariosError);
  });

  it("revising a completed review reopens it and cascades staleness downstream (FR-006)", async () => {
    await reachScenarioReview();
    const first = getCurrentWorkflow()!.reviewWorkspace!.scenarios[0];
    applyScenarioDecisions([
      { scenarioId: first.scenarioId, revision: first.revision, action: "accept" },
    ]);
    const afterFinalize = await finalizeScenarioReview();
    expect(afterFinalize.stages.scenarioReview.status).toBe("complete");
    const completeDownstream = [
      "dependencyAnalysis",
      "workflowReview",
      "postmanGeneration",
    ].filter(
      (id) =>
        (afterFinalize.stages as Record<string, { status: string }>)[id].status ===
        "complete",
    );

    const rejected = getCurrentWorkflow()!.reviewWorkspace!.scenarios[0];
    const { workflow: reopened } = applyScenarioDecisions([
      {
        scenarioId: rejected.scenarioId,
        revision: rejected.revision,
        action: "reject",
        reason: "changed my mind",
      },
    ]);
    expect(reopened.stages.scenarioReview.status).toBe("active");
    for (const id of completeDownstream) {
      expect((reopened.stages as Record<string, { status: string }>)[id].status).toBe(
        "stale",
      );
    }
  });

  it("finalize refuses to re-finalize an already-complete review", async () => {
    await reachScenarioReview();
    const first = getCurrentWorkflow()!.reviewWorkspace!.scenarios[0];
    applyScenarioDecisions([
      { scenarioId: first.scenarioId, revision: first.revision, action: "accept" },
    ]);
    await finalizeScenarioReview();
    await expect(finalizeScenarioReview()).rejects.toThrow(StageNotActiveError);
  });

  it("finalize commits approvedTestModel and runs dependency analysis through to workflowReview", async () => {
    await reachScenarioReview();
    const first = getCurrentWorkflow()!.reviewWorkspace!.scenarios[0];
    applyScenarioDecisions([
      { scenarioId: first.scenarioId, revision: first.revision, action: "accept" },
    ]);
    const wf = await finalizeScenarioReview();
    expect(wf.stages.scenarioReview.status).toBe("complete");
    expect(wf.approvedTestModel?.scenarios).toHaveLength(1);
    expect(wf.stages.dependencyAnalysis.status).toBe("complete");
    expect(wf.dependencyAnalysis).toBeDefined();
    expect(["active", "complete"]).toContain(wf.stages.workflowReview.status);
  });

  /**
   * Regression: finalize completes `scenarioReview` and activates `dependencyAnalysis` *before*
   * running the analysis, and `dependencyAnalysis` has no HTTP trigger of its own. A failure
   * there therefore used to leave the review closed with no supported way to retry finalizing —
   * every subsequent attempt refused as `stage_not_active`.
   */
  it("reopens scenarioReview when dependency analysis fails, so finalizing can be retried", async () => {
    await reachScenarioReview();
    const first = getCurrentWorkflow()!.reviewWorkspace!.scenarios[0];
    applyScenarioDecisions([
      { scenarioId: first.scenarioId, revision: first.revision, action: "accept" },
    ]);

    // Fails inside dependency analysis rather than before it: the budget is consulted at the
    // very start of the AI-assisted pass, outside any per-batch degradation.
    const brokenProvider: AIProvider = {
      ...unavailableProvider,
      getInputBudget: async () => {
        throw new Error("engine unavailable");
      },
    };

    await expect(finalizeScenarioReview(brokenProvider)).rejects.toThrow("engine unavailable");

    const afterFailure = getCurrentWorkflow()!;
    expect(afterFailure.stages.scenarioReview.status).toBe("active");
    expect(afterFailure.activeStageId).toBe("scenarioReview");

    // The retry is a plain repeat of the same call — no intervening decision needed to reopen.
    const retried = await finalizeScenarioReview();
    expect(retried.stages.scenarioReview.status).toBe("complete");
    expect(retried.stages.dependencyAnalysis.status).toBe("complete");
  });
});
