import type {
  AIProvider,
  ReviewEditContent,
  ReviewUpdateOutcome,
  ReviewUpdateRequest,
  TestGenerationWorkflow,
} from "@apipilot/shared-domain";
import {
  applyReviewEdit,
  applyReviewUpdates,
  applyRegeneratedScenario,
  beginRegeneration,
  projectApprovedTestModel,
  regenerationFailureOutcome,
} from "../testDesign/reviewTestModel";
import { regenerateReviewScenario } from "../testDesign/regenerateReviewScenario";
import { createLogger } from "../logger";
import { EmptyApprovedScenariosError, StageNotActiveError } from "./errors";
import { computeDownstreamStaleness } from "./staleness";
import { advanceActiveStage, getCurrentWorkflow, patchWorkflow, updateStage } from "./workflowStore";
import { runDependencyAnalysis } from "./dependencyAnalysisStage";

const logger = createLogger("testGenerationWorkflow.scenarioReviewStage");

/** Allows a revision (FR-006): decisions/edit/regenerate may reopen an already-finalized review. */
function requireReviewable(workflow: TestGenerationWorkflow | undefined): TestGenerationWorkflow {
  const status = workflow?.stages.scenarioReview.status;
  if (!workflow || (status !== "active" && status !== "complete")) {
    throw new StageNotActiveError("scenarioReview is not the active stage.");
  }
  return workflow;
}

/** finalize only ever moves active -> complete; re-finalizing an already-complete stage is refused. */
function requireActive(workflow: TestGenerationWorkflow | undefined): TestGenerationWorkflow {
  if (!workflow || workflow.stages.scenarioReview.status !== "active") {
    throw new StageNotActiveError("scenarioReview is not the active stage.");
  }
  return workflow;
}

/**
 * If scenarioReview was already `complete`, reopens it (`active`) and marks every currently
 * `complete` downstream stage `stale` (FR-006, research.md D6). A no-op while still `active`.
 */
function reopenIfComplete(): void {
  const workflow = getCurrentWorkflow()!;
  if (workflow.stages.scenarioReview.status !== "complete") return;
  const stale = computeDownstreamStaleness(workflow, "scenarioReview");
  updateStage("scenarioReview", "active");
  for (const stageId of stale) updateStage(stageId, "stale");
  patchWorkflow({ activeStageId: "scenarioReview" });
}

/** Applies one or more approve/reject/comment decisions to the review workspace, reopening a finalized review first if needed (FR-006). */
export function applyScenarioDecisions(
  updates: ReviewUpdateRequest[],
): { workflow: TestGenerationWorkflow; outcomes: ReviewUpdateOutcome[] } {
  const workflow = requireReviewable(getCurrentWorkflow());
  reopenIfComplete();
  const { workspace, outcomes } = applyReviewUpdates(workflow.reviewWorkspace!, updates);
  const next = patchWorkflow({ reviewWorkspace: workspace });
  return { workflow: next, outcomes };
}

/** Applies a user edit to one scenario's content in the review workspace, reopening a finalized review first if needed (FR-006). */
export function editScenario(
  scenarioId: string,
  revision: number,
  edit: ReviewEditContent,
): { workflow: TestGenerationWorkflow; outcome: ReviewUpdateOutcome } {
  const workflow = requireReviewable(getCurrentWorkflow());
  reopenIfComplete();
  const { workspace, outcome } = applyReviewEdit(
    workflow.reviewWorkspace!,
    workflow.apiModel!,
    scenarioId,
    revision,
    edit,
  );
  const next = patchWorkflow({ reviewWorkspace: workspace });
  return { workflow: next, outcome };
}

/** Re-runs AI generation for one scenario via `regenerateReviewScenario`, replacing it in the workspace on success (reopening a finalized review first if needed). */
export async function regenerateScenario(
  scenarioId: string,
  revision: number,
  provider: AIProvider,
): Promise<{ workflow: TestGenerationWorkflow; outcome: ReviewUpdateOutcome }> {
  const workflow = requireReviewable(getCurrentWorkflow());
  const started = beginRegeneration(workflow.reviewWorkspace!, scenarioId, revision);
  if ("error" in started) {
    return { workflow, outcome: started.error };
  }
  const result = await regenerateReviewScenario(workflow.apiModel!, started.existing, provider);
  if (!result.ok) {
    return { workflow, outcome: regenerationFailureOutcome(started.existing, result.message) };
  }
  reopenIfComplete();
  const { workspace, outcome } = applyRegeneratedScenario(
    getCurrentWorkflow()!.reviewWorkspace!,
    scenarioId,
    result.scenario,
  );
  const next = patchWorkflow({ reviewWorkspace: workspace });
  return { workflow: next, outcome };
}

/**
 * Commits the current workspace's projected approved TestModel as this stage's output
 * (research.md D6), advances to `dependencyAnalysis`, and immediately runs it — that stage has
 * no separate trigger (data-model.md). Refuses when nothing was approved (FR-011).
 */
export async function finalizeScenarioReview(provider?: AIProvider): Promise<TestGenerationWorkflow> {
  const startedAt = Date.now();
  try {
    const workflow = requireActive(getCurrentWorkflow());
    const approvedTestModel = projectApprovedTestModel(workflow.reviewWorkspace!);
    if (approvedTestModel.scenarios.length === 0) {
      throw new EmptyApprovedScenariosError();
    }
    patchWorkflow({ approvedTestModel });
    updateStage("scenarioReview", "complete");
    advanceActiveStage("dependencyAnalysis");
    const result = await runDependencyAnalysis(provider);
    logger.info("stage_complete", {
      stage: "scenarioReview",
      workflowId: result.id,
      scenarioCount: approvedTestModel.scenarios.length,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logger.error("stage_error", {
      stage: "scenarioReview",
      workflowId: getCurrentWorkflow()?.id,
      errorCategory: error instanceof Error ? error.name : "UNKNOWN",
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
