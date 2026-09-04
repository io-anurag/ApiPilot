import type {
  ApiModel,
  StageStatus,
  TestGenerationWorkflow,
  WorkflowStageId,
  WorkflowStageState,
} from "@apipilot/shared-domain";
import { WORKFLOW_STAGE_ORDER } from "@apipilot/shared-domain";

/** The single global instance (FR-018, research.md D7). No database, no session identity. */
let currentWorkflow: TestGenerationWorkflow | undefined;
let nextWorkflowSequence = 0;

export class InvalidStageTransitionError extends Error {
  constructor(stageId: WorkflowStageId, from: StageStatus, to: StageStatus) {
    super(`Cannot transition stage "${stageId}" from "${from}" to "${to}".`);
    this.name = "InvalidStageTransitionError";
  }
}

export function getCurrentWorkflow(): TestGenerationWorkflow | undefined {
  return currentWorkflow;
}

/** Test-only hook to clear the store between test runs (mirrors resetAIProvider). */
export function resetStore(): void {
  currentWorkflow = undefined;
  nextWorkflowSequence = 0;
}

function freshWorkflowId(now: Date): string {
  nextWorkflowSequence += 1;
  return `wf-${now.getTime()}-${nextWorkflowSequence}`;
}

function initialStages(): Record<WorkflowStageId, WorkflowStageState> {
  return Object.fromEntries(
    WORKFLOW_STAGE_ORDER.map((stageId) => [stageId, { stageId, status: "not-yet-reached" as StageStatus }]),
  ) as Record<WorkflowStageId, WorkflowStageState>;
}

/**
 * Creates a fresh workflow from an already-built ApiModel (upload + analysis complete
 * atomically, research.md D4) and makes it the current one, replacing any prior workflow.
 */
export function startWorkflow(input: { specificationFilename: string; apiModel: ApiModel }): TestGenerationWorkflow {
  const now = new Date();
  const nowIso = now.toISOString();
  const stages = initialStages();
  stages.upload = { stageId: "upload", status: "complete", enteredAt: nowIso, completedAt: nowIso };
  stages.analysis = { stageId: "analysis", status: "complete", enteredAt: nowIso, completedAt: nowIso };
  stages.apiReview = { stageId: "apiReview", status: "active", enteredAt: nowIso };

  currentWorkflow = {
    id: freshWorkflowId(now),
    createdAt: nowIso,
    updatedAt: nowIso,
    activeStageId: "apiReview",
    stages,
    specificationFilename: input.specificationFilename,
    apiModel: input.apiModel,
  };
  return currentWorkflow;
}

/** Valid `from -> to` StageStatus transitions (data-model.md). Skip/retry is aiEnhancement-only. */
function isValidTransition(stageId: WorkflowStageId, from: StageStatus, to: StageStatus): boolean {
  if (from === to) return false;
  if (from === "not-yet-reached" && to === "active") return true;
  if (from === "active" && to === "complete") return true;
  if (from === "active" && to === "skipped") return stageId === "aiEnhancement";
  if (from === "skipped" && to === "active") return stageId === "aiEnhancement";
  if (from === "complete" && to === "stale") return true;
  if (from === "complete" && to === "active") return true;
  if (from === "stale" && to === "active") return true;
  return false;
}

export interface UpdateStageOptions {
  aiErrorCategory?: WorkflowStageState["aiErrorCategory"];
  aiErrorMessage?: string;
  /** Also moves `activeStageId` to this stage (typically `stageId` itself or the next one). */
  activeStageId?: WorkflowStageId;
}

/**
 * Applies one validated stage-status transition (throws InvalidStageTransitionError otherwise)
 * and returns the updated workflow. Requires a current workflow to exist.
 */
export function updateStage(
  stageId: WorkflowStageId,
  status: StageStatus,
  options: UpdateStageOptions = {},
): TestGenerationWorkflow {
  if (!currentWorkflow) {
    throw new Error("No workflow is currently in progress.");
  }
  const current = currentWorkflow.stages[stageId];
  if (!isValidTransition(stageId, current.status, status)) {
    throw new InvalidStageTransitionError(stageId, current.status, status);
  }
  const now = new Date().toISOString();
  let completedAt = current.completedAt;
  if (status === "complete") completedAt = now;
  else if (status === "active") completedAt = undefined;
  const nextState: WorkflowStageState = {
    ...current,
    status,
    enteredAt: current.enteredAt ?? now,
    completedAt,
    aiErrorCategory: status === "skipped" ? options.aiErrorCategory : undefined,
    aiErrorMessage: status === "skipped" ? options.aiErrorMessage : undefined,
  };
  currentWorkflow = {
    ...currentWorkflow,
    updatedAt: now,
    activeStageId: options.activeStageId ?? currentWorkflow.activeStageId,
    stages: { ...currentWorkflow.stages, [stageId]: nextState },
  };
  return currentWorkflow;
}

/**
 * Moves `activeStageId` to `stageId`, activating it first (not-yet-reached -> active) if it has
 * not already been entered. Used by every forward stage transition in US1.
 */
export function advanceActiveStage(stageId: WorkflowStageId): TestGenerationWorkflow {
  if (!currentWorkflow) {
    throw new Error("No workflow is currently in progress.");
  }
  const status = currentWorkflow.stages[stageId].status;
  if (status === "not-yet-reached" || status === "stale") {
    updateStage(stageId, "active");
  }
  return patchWorkflow({ activeStageId: stageId });
}

/** Merges arbitrary top-level fields (produced artifacts, activeStageId) onto the current workflow. */
export function patchWorkflow(patch: Partial<TestGenerationWorkflow>): TestGenerationWorkflow {
  if (!currentWorkflow) {
    throw new Error("No workflow is currently in progress.");
  }
  currentWorkflow = { ...currentWorkflow, ...patch, updatedAt: new Date().toISOString() };
  return currentWorkflow;
}
