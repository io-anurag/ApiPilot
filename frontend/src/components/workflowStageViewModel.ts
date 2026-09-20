import {
  WORKFLOW_STAGE_ORDER,
  type TestGenerationWorkflow,
  type WorkflowStageId,
} from "@apipilot/shared-domain";

/**
 * Single source of truth for stage display labels (moved out of WorkflowStageTracker so
 * getLockReason below can share it — spec 027 FR-002/FR-004).
 */
export const STAGE_LABELS: Record<WorkflowStageId, string> = {
  upload: "Upload",
  analysis: "Analysis",
  apiReview: "API Review",
  deterministicGeneration: "Deterministic Generation",
  aiEnhancement: "AI Enhancement",
  scenarioReview: "Scenario Review",
  dependencyAnalysis: "Dependency Analysis",
  workflowReview: "Workflow Review",
  postmanGeneration: "Postman Generation",
  execution: "Execution",
};

/**
 * Why a `not-yet-reached` stage is locked (FR-004). This workflow is strictly sequential
 * (WORKFLOW_STAGE_ORDER, one activeStageId at a time — data-model.md D4), so a locked stage is
 * always locked for exactly one reason: the nearest predecessor in stage order that isn't
 * `complete` yet. Returns undefined for a stage that isn't locked, or has no predecessor.
 */
export function getLockReason(
  stageId: WorkflowStageId,
  workflow: TestGenerationWorkflow,
): string | undefined {
  const index = WORKFLOW_STAGE_ORDER.indexOf(stageId);
  if (index <= 0 || workflow.stages[stageId].status !== "not-yet-reached") {
    return undefined;
  }

  for (let i = index - 1; i >= 0; i--) {
    const predecessorId = WORKFLOW_STAGE_ORDER[i];
    if (workflow.stages[predecessorId].status !== "complete") {
      return `Complete ${STAGE_LABELS[predecessorId]} first`;
    }
  }
  return undefined;
}
