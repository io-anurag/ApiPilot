import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { createLogger } from "../logger";
import { StageNotActiveError } from "./errors";
import { getCurrentWorkflow, updateStage } from "./workflowStore";

const logger = createLogger("testGenerationWorkflow.executionStage");

/**
 * `execution` is the last guided-workflow stage, added by the 2026-09-20 amendment (specs/009
 * Clarifications) to split it out of the `postmanGeneration` screen and make it explicitly
 * skippable. It becomes `"active"` automatically once `postmanGeneration` first completes
 * (`postmanGenerationStage.ts`'s `advanceActiveStage("execution")` call) — there is no separate
 * "enter" action.
 */
function requireActive(): TestGenerationWorkflow {
  const workflow = getCurrentWorkflow();
  if (!workflow || workflow.stages.execution.status !== "active") {
    throw new StageNotActiveError("execution is not the active stage.");
  }
  return workflow;
}

/**
 * Explicitly marks `execution` skipped without running anything (FR-002 amendment) — the user
 * decided no run is needed for this workflow. May later be reopened by starting a run
 * (`reactivateExecutionStage()` below) or by calling this again after that.
 */
export function skipExecution(): TestGenerationWorkflow {
  requireActive();
  const result = updateStage("execution", "skipped");
  logger.info("stage_complete", { stage: "execution", workflowId: result.id, outcome: "skipped" });
  return result;
}

/**
 * Explicitly marks `execution` complete — the user is done running requests against this
 * workflow's approved collection (whether or not any run actually happened yet).
 */
export function finishExecution(): TestGenerationWorkflow {
  requireActive();
  const result = updateStage("execution", "complete");
  logger.info("stage_complete", { stage: "execution", workflowId: result.id, outcome: "complete" });
  return result;
}

/**
 * Reopens `execution` (`"skipped"`/`"complete"` -> `"active"`) the moment a run actually starts,
 * so starting one after skipping (or after an earlier "finish") always reflects an active stage
 * rather than a stale terminal status. A no-op while already `"active"`.
 */
export function reactivateExecutionStage(): void {
  const workflow = getCurrentWorkflow();
  if (workflow && workflow.stages.execution.status !== "active") {
    updateStage("execution", "active");
  }
}
