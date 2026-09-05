import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { generateTestModel } from "../testDesign/generateTestModel";
import { createLogger } from "../logger";
import { StageNotActiveError } from "./errors";
import { advanceActiveStage, getCurrentWorkflow, patchWorkflow, updateStage } from "./workflowStore";

const logger = createLogger("testGenerationWorkflow.deterministicGenerationStage");

/** Runs the unmodified AP-003 `generateTestModel` and stores the result (data-model.md). */
export function runDeterministicGeneration(): TestGenerationWorkflow {
  const startedAt = Date.now();
  try {
    const workflow = getCurrentWorkflow();
    if (!workflow || workflow.stages.deterministicGeneration.status !== "active") {
      throw new StageNotActiveError("deterministicGeneration is not the active stage.");
    }
    const deterministicTestModel = generateTestModel(workflow.apiModel!);
    patchWorkflow({ deterministicTestModel });
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
