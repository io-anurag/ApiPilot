import type { AIProvider, TestGenerationWorkflow } from "@apipilot/shared-domain";
import { analyzeDependencies } from "../dependencies/analyzeDependencies";
import { StageNotActiveError } from "./errors";
import { advanceActiveStage, getCurrentWorkflow, patchWorkflow, updateStage } from "./workflowStore";
import { maybeAutoCompleteWorkflowReview } from "./workflowReviewStage";

/**
 * Runs the unmodified AP-008 `analyzeDependencies` over the workflow's `apiModel` (independent
 * of which scenarios were approved, since AP-008 operates at ApiModel granularity) and advances
 * to `workflowReview`, auto-completing it immediately when there is nothing to review (D5).
 * Has no separate HTTP trigger — called automatically once `scenarioReview` is finalized.
 */
export async function runDependencyAnalysis(provider?: AIProvider): Promise<TestGenerationWorkflow> {
  const workflow = getCurrentWorkflow();
  if (!workflow || workflow.stages.dependencyAnalysis.status !== "active") {
    throw new StageNotActiveError("dependencyAnalysis is not the active stage.");
  }
  const dependencyAnalysis = await analyzeDependencies(workflow.apiModel!, provider);
  patchWorkflow({ dependencyAnalysis });
  updateStage("dependencyAnalysis", "complete");
  advanceActiveStage("workflowReview");
  return maybeAutoCompleteWorkflowReview();
}
