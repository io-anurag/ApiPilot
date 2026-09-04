import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { StageNotActiveError } from "./errors";
import { advanceActiveStage, getCurrentWorkflow, updateStage } from "./workflowStore";

/**
 * Completes the confirmation-gate `apiReview` stage (research.md D3 — there is no selectable
 * data here, only an explicit "I've reviewed the discovered APIs" action, FR-009).
 */
export function continueApiReview(): TestGenerationWorkflow {
  const workflow = getCurrentWorkflow();
  if (!workflow || workflow.stages.apiReview.status !== "active") {
    throw new StageNotActiveError("apiReview is not the active stage.");
  }
  updateStage("apiReview", "complete");
  return advanceActiveStage("deterministicGeneration");
}
