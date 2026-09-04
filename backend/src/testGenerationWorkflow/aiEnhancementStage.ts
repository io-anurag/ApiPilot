import type {
  AIProvider,
  ReviewScenario,
  TestGenerationWorkflow,
  TestModel,
} from "@apipilot/shared-domain";
import {
  computeReviewSummary,
  createReviewWorkspace,
} from "../testDesign/reviewTestModel";
import { enhanceTestModel } from "../testDesign/enhanceTestModel";
import { StageNotActiveError } from "./errors";
import {
  advanceActiveStage,
  getCurrentWorkflow,
  patchWorkflow,
  updateStage,
} from "./workflowStore";

/** ReviewScenario wrappers for scenarios in `testModel` not already present in `existingIds`. */
function newlyAddedReviewScenarios(
  testModel: TestModel,
  existingIds: Set<string>,
): ReviewScenario[] {
  return testModel.scenarios
    .filter((scenario) => !existingIds.has(scenario.id))
    .map((scenario) => ({
      scenarioId: scenario.id,
      revision: 0,
      scenario,
      state: "pending" as const,
      isUserModified: false,
      history: [],
    }));
}

/**
 * Runs (or retries) AI enhancement. A successful run completes the stage and seeds/extends
 * `reviewWorkspace`. A `"partial"` outcome (some but not all batches succeeded, FR-011)
 * marks the stage `"partial"` — distinct from `"skipped"` — while still seeding/extending
 * `reviewWorkspace` from whatever AI-derived scenarios did succeed, alongside the
 * deterministic baseline (research.md Decision 7). Any other outcome marks the stage
 * `"skipped"` with the recorded error (FR-008) but still advances to `scenarioReview` on the
 * deterministic-only baseline.
 *
 * Retrying after `"skipped"` or `"partial"` is allowed only while `scenarioReview` has not
 * been finalized (FR-008a); a successful retry folds newly AI-derived scenarios into the
 * still-live workspace rather than resetting decisions already made on the deterministic
 * scenarios.
 */
export async function runAiEnhancement(
  provider: AIProvider,
): Promise<TestGenerationWorkflow> {
  const workflow = getCurrentWorkflow();
  if (!workflow) {
    throw new StageNotActiveError("aiEnhancement is not the active stage.");
  }
  const status = workflow.stages.aiEnhancement.status;
  if (status === "active") {
    // first attempt
  } else if (status === "skipped" || status === "partial") {
    if (workflow.stages.scenarioReview.status === "complete") {
      throw new StageNotActiveError(
        "AI enhancement can no longer be retried: scenario review is already finalized.",
      );
    }
    updateStage("aiEnhancement", "active");
  } else {
    throw new StageNotActiveError("aiEnhancement is not the active stage.");
  }

  const result = await enhanceTestModel(
    workflow.apiModel!,
    workflow.deterministicTestModel!,
    provider,
  );
  patchWorkflow({ aiEnhancement: result });

  const existingIds = new Set(
    (workflow.reviewWorkspace?.scenarios ?? []).map((s) => s.scenarioId),
  );
  const isRetry = workflow.reviewWorkspace !== undefined;

  if (result.aiProviderOutcome === "success" || result.aiProviderOutcome === "partial") {
    updateStage(
      "aiEnhancement",
      result.aiProviderOutcome === "success" ? "complete" : "partial",
      result.aiProviderOutcome === "partial"
        ? {
            aiErrorCategory: result.aiErrorCategory,
            aiErrorMessage: result.aiErrorMessage,
          }
        : {},
    );
    if (isRetry) {
      const added = newlyAddedReviewScenarios(result.enhancedTestModel, existingIds);
      const scenarios = [...workflow.reviewWorkspace!.scenarios, ...added];
      patchWorkflow({
        reviewWorkspace: {
          ...workflow.reviewWorkspace!,
          scenarios,
          summary: computeReviewSummary(scenarios, workflow.reviewWorkspace!.policy),
        },
      });
    } else {
      patchWorkflow({ reviewWorkspace: createReviewWorkspace(result.enhancedTestModel) });
    }
    return advanceActiveStage("scenarioReview");
  }

  updateStage("aiEnhancement", "skipped", {
    aiErrorCategory: result.aiErrorCategory,
    aiErrorMessage: result.aiErrorMessage,
  });
  if (!isRetry) {
    patchWorkflow({ reviewWorkspace: createReviewWorkspace(result.enhancedTestModel) });
    return advanceActiveStage("scenarioReview");
  }
  return getCurrentWorkflow()!;
}
