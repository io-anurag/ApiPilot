import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { generateTestModel } from "../testDesign/generateTestModel";
import { StageNotActiveError } from "./errors";
import { advanceActiveStage, getCurrentWorkflow, patchWorkflow, updateStage } from "./workflowStore";

/** Runs the unmodified AP-003 `generateTestModel` and stores the result (data-model.md). */
export function runDeterministicGeneration(): TestGenerationWorkflow {
  const workflow = getCurrentWorkflow();
  if (!workflow || workflow.stages.deterministicGeneration.status !== "active") {
    throw new StageNotActiveError("deterministicGeneration is not the active stage.");
  }
  const deterministicTestModel = generateTestModel(workflow.apiModel!);
  patchWorkflow({ deterministicTestModel });
  updateStage("deterministicGeneration", "complete");
  return advanceActiveStage("aiEnhancement");
}
