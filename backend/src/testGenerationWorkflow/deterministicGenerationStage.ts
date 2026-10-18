import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { generateTestModelWithNotes } from "../testDesign/generateTestModel";
import { createLogger } from "../logger";
import { StageNotActiveError } from "./errors";
import { scopeApiModelToSelection } from "./operationSelection";
import { advanceActiveStage, getCurrentWorkflow, patchWorkflow, updateStage } from "./workflowStore";

const logger = createLogger("testGenerationWorkflow.deterministicGenerationStage");

/**
 * Runs the unmodified AP-003 `generateTestModel` over the operations chosen at apiReview (every
 * operation when none were chosen) and stores the result (data-model.md).
 */
export function runDeterministicGeneration(): TestGenerationWorkflow {
  const startedAt = Date.now();
  try {
    const workflow = getCurrentWorkflow();
    if (!workflow || workflow.stages.deterministicGeneration.status !== "active") {
      throw new StageNotActiveError("deterministicGeneration is not the active stage.");
    }
    const { testModel: deterministicTestModel, notes } = generateTestModelWithNotes(scopeApiModelToSelection(workflow));
    // Operations that produced no scenario keep their reason (specs/056 FR-040); absent when there are none.
    patchWorkflow({ deterministicTestModel, generationNotes: notes.length > 0 ? notes : undefined });
    updateStage("deterministicGeneration", "complete");
    const result = advanceActiveStage("aiEnhancement");
    logger.info("stage_complete", {
      stage: "deterministicGeneration",
      workflowId: result.id,
      scenarioCount: deterministicTestModel.scenarios.length,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logger.error("stage_error", {
      stage: "deterministicGeneration",
      workflowId: getCurrentWorkflow()?.id,
      errorCategory: error instanceof Error ? error.name : "UNKNOWN",
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
