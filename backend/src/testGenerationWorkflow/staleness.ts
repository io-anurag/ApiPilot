import { WORKFLOW_STAGE_ORDER, type TestGenerationWorkflow, type WorkflowStageId } from "@apipilot/shared-domain";

/**
 * Every stage after `revisedStageId` (in WORKFLOW_STAGE_ORDER) that is currently `complete` and
 * therefore depends on the decision just revised (FR-006, SC-003). Never includes a stage at or
 * before `revisedStageId`. Written generically over stage order (data-model.md) rather than
 * hard-coded to the two stages that currently revise (`scenarioReview`, `workflowReview`), so it
 * stays correct if a future feature adds a revisable decision elsewhere.
 */
export function computeDownstreamStaleness(
  workflow: TestGenerationWorkflow,
  revisedStageId: WorkflowStageId,
): WorkflowStageId[] {
  const revisedIndex = WORKFLOW_STAGE_ORDER.indexOf(revisedStageId);
  return WORKFLOW_STAGE_ORDER.filter(
    (stageId, index) => index > revisedIndex && workflow.stages[stageId].status === "complete",
  );
}
