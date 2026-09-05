import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { createLogger } from "../logger";
import { StageNotActiveError } from "./errors";
import { advanceActiveStage, getCurrentWorkflow, updateStage } from "./workflowStore";

const logger = createLogger("testGenerationWorkflow.apiReviewStage");

/**
 * Completes the confirmation-gate `apiReview` stage (research.md D3 — there is no selectable
 * data here, only an explicit "I've reviewed the discovered APIs" action, FR-009).
 */
export function continueApiReview(): TestGenerationWorkflow {
  const startedAt = Date.now();
  try {
    const workflow = getCurrentWorkflow();
    if (!workflow || workflow.stages.apiReview.status !== "active") {
      throw new StageNotActiveError("apiReview is not the active stage.");
    }
    updateStage("apiReview", "complete");
    const result = advanceActiveStage("deterministicGeneration");
    logger.info("stage_complete", {
      stage: "apiReview",
      workflowId: result.id,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logger.error("stage_error", {
      stage: "apiReview",
      workflowId: getCurrentWorkflow()?.id,
      errorCategory: error instanceof Error ? error.name : "UNKNOWN",
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
