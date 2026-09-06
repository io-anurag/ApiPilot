/** A stage-transition endpoint was called while its stage was not enterable/active (FR-002). */
export class StageNotActiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StageNotActiveError";
  }
}

/** `POST /api/test-generation-workflow` was called while a workflow is already in progress (FR-010). */
export class WorkflowInProgressError extends Error {
  constructor() {
    super("A workflow is already in progress. Retry with discardExisting=true to replace it.");
    this.name = "WorkflowInProgressError";
  }
}

/** `scenario-review/finalize` was called with zero approved scenarios (FR-011). */
export class EmptyApprovedScenariosError extends Error {
  constructor() {
    super("At least one scenario must be approved before finalizing scenario review.");
    this.name = "EmptyApprovedScenariosError";
  }
}

/**
 * `ai-enhancement` was called while a run is already in progress for the current workflow
 * (specs/012-ai-enhancement-progress FR-008).
 */
export class AiEnhancementAlreadyRunningError extends Error {
  constructor() {
    super("AI enhancement is already in progress; wait for it to finish before retrying.");
    this.name = "AiEnhancementAlreadyRunningError";
  }
}

/** `workflow-review/continue` was called while a discovered workflow still has no decision. */
export class PendingWorkflowDecisionsError extends Error {
  constructor(pendingCount: number) {
    super(`${pendingCount} discovered workflow(s) still need an approve/reject decision.`);
    this.name = "PendingWorkflowDecisionsError";
  }
}

/** A `workflow-review/decisions` request named an id absent from the current dependency analysis. */
export class UnknownWorkflowIdError extends Error {
  constructor(workflowId: string) {
    super(`No IntegrationWorkflow with id '${workflowId}' was found in the current dependency analysis.`);
    this.name = "UnknownWorkflowIdError";
  }
}

/** AP-007's `generateCollection` refused the request; carries its original failure for the route to map. */
export class PostmanGenerationRefusedError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly problems?: string[],
  ) {
    super(message);
    this.name = "PostmanGenerationRefusedError";
  }
}

/**
 * A cancel request arrived when no AI enhancement run was in progress
 * (specs/013-ai-enhancement-viability/contracts/ai-enhancement-cancel.md). Determined from the
 * same "is a run active?" signal as `AiEnhancementAlreadyRunningError` — the presence of
 * `stages.aiEnhancement.progress` — read in the opposite direction, so the two cannot disagree.
 */
export class NoAiEnhancementRunInProgressError extends Error {
  constructor() {
    super("No AI enhancement run is currently in progress.");
    this.name = "NoAiEnhancementRunInProgressError";
  }
}
