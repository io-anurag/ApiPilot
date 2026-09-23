import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { createLogger } from "../logger";
import { StageNotActiveError } from "./errors";
import { normalizeOperationSelection } from "./operationSelection";
import { advanceActiveStage, getCurrentWorkflow, patchWorkflow, updateStage } from "./workflowStore";

const logger = createLogger("testGenerationWorkflow.apiReviewStage");

/**
 * Completes the `apiReview` stage on an explicit "Continue" action (FR-009), recording which
 * operations the user chose to carry forward (specs/009 Clarifications 2026-09-23, superseding
 * research.md D3's confirmation-only gate). An absent or empty `selectedOperationKeys` keeps every
 * discovered operation in scope. Unknown keys are refused with `UnknownOperationKeyError` before
 * any state changes, so a rejected request leaves the stage active and retryable.
 */
export function continueApiReview(
  selectedOperationKeys?: readonly string[],
): TestGenerationWorkflow {
  const startedAt = Date.now();
  try {
    const workflow = getCurrentWorkflow();
    if (!workflow || workflow.stages.apiReview.status !== "active") {
      throw new StageNotActiveError("apiReview is not the active stage.");
    }
    const selection = normalizeOperationSelection(workflow.apiModel!, selectedOperationKeys);
    patchWorkflow({ selectedOperationKeys: selection });
    updateStage("apiReview", "complete");
    const result = advanceActiveStage("deterministicGeneration");
    logger.info("stage_complete", {
      stage: "apiReview",
      workflowId: result.id,
      // Counts only — operation paths can be sensitive and are not needed to diagnose anything.
      selectedOperationCount: selection?.length ?? workflow.apiModel!.operations.length,
      selectionScoped: selection !== undefined,
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
