import type { ExportOptions, TestGenerationWorkflow } from "@apipilot/shared-domain";
import { generateCollection } from "../postman/generateCollection";
import { EmptyApprovedScenariosError, PostmanGenerationRefusedError, StageNotActiveError } from "./errors";
import { getCurrentWorkflow, patchWorkflow, updateStage } from "./workflowStore";

/**
 * Wraps the unmodified AP-007 `generateCollection` — approved integration workflows are never
 * attached (research.md D2, no workflow-intent rendering). Requires `workflowReview` complete;
 * since a stale stage is never `complete`, this single check also refuses whenever an upstream
 * revision left `workflowReview` (or anything before it) stale (FR-007). Re-running once already
 * `complete` regenerates idempotently (e.g., with different export options) without re-transitioning.
 */
export function runPostmanGeneration(options?: ExportOptions): TestGenerationWorkflow {
  const workflow = getCurrentWorkflow();
  if (!workflow || workflow.stages.workflowReview.status !== "complete") {
    throw new StageNotActiveError("postmanGeneration requires workflowReview to be complete.");
  }
  if (!workflow.approvedTestModel || workflow.approvedTestModel.scenarios.length === 0) {
    throw new EmptyApprovedScenariosError();
  }
  const outcome = generateCollection(workflow.apiModel!, workflow.approvedTestModel, options);
  if (!outcome.ok) {
    throw new PostmanGenerationRefusedError(outcome.failure.code, outcome.failure.message, outcome.failure.problems);
  }
  patchWorkflow({ postmanArtifact: outcome.result });
  if (workflow.stages.postmanGeneration.status !== "complete") {
    updateStage("postmanGeneration", "complete");
  }
  return getCurrentWorkflow()!;
}
