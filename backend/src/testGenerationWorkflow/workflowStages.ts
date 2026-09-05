import { WORKFLOW_STAGE_ORDER, type TestGenerationWorkflow, type WorkflowStageId } from "@apipilot/shared-domain";

export { WORKFLOW_STAGE_ORDER };

/** The stage immediately before `stageId` in WORKFLOW_STAGE_ORDER, or undefined for "upload". */
export function previousStageId(stageId: WorkflowStageId): WorkflowStageId | undefined {
  const index = WORKFLOW_STAGE_ORDER.indexOf(stageId);
  return index > 0 ? WORKFLOW_STAGE_ORDER[index - 1] : undefined;
}

/** The stage immediately after `stageId` in WORKFLOW_STAGE_ORDER, or undefined for the last stage ("postmanGeneration"). */
export function nextStageId(stageId: WorkflowStageId): WorkflowStageId | undefined {
  const index = WORKFLOW_STAGE_ORDER.indexOf(stageId);
  return index >= 0 && index < WORKFLOW_STAGE_ORDER.length - 1
    ? WORKFLOW_STAGE_ORDER[index + 1]
    : undefined;
}

/**
 * Whether `stageId` can be entered right now (FR-002), per data-model.md's stage-dependency
 * table. `scenarioReview` is reachable once `aiEnhancement` is either `complete` or `skipped`
 * (FR-008); every other stage requires its immediate predecessor to be `complete`.
 */
export function isStageEnterable(workflow: TestGenerationWorkflow, stageId: WorkflowStageId): boolean {
  if (stageId === "upload") return true;
  if (stageId === "analysis") return workflow.stages.upload.status === "complete";
  if (stageId === "scenarioReview") {
    const status = workflow.stages.aiEnhancement.status;
    return status === "complete" || status === "skipped";
  }
  const prior = previousStageId(stageId);
  if (!prior) return true;
  return workflow.stages[prior].status === "complete";
}
