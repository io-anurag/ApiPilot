import type {
  AiEnhancementProgress,
  ApiModel,
  BatchOutcomeRecord,
  StageStatus,
  TestGenerationWorkflow,
  WorkflowStageId,
  WorkflowStageState,
} from "@apipilot/shared-domain";
import { WORKFLOW_STAGE_ORDER } from "@apipilot/shared-domain";
import { createLogger } from "../logger";
import { getSessionId } from "../session/sessionContext";
import { markActive, onExpire } from "../session/sessionRegistry";

const logger = createLogger("testGenerationWorkflow.workflowStore");

/** One entry per session (specs/017-session-workflow-isolation) — previously two bare module-level variables shared by every caller (FR-018, research.md D7 of specs/009-e2e-test-generation-workflow). */
interface SessionWorkflowState {
  currentWorkflow: TestGenerationWorkflow | undefined;
  nextWorkflowSequence: number;
}

const sessionStates = new Map<string, SessionWorkflowState>();

/** Discards a session's workflow state the moment it is idle-evicted (specs/017-session-workflow-isolation research.md D3/D4), bounding memory growth without this module needing a periodic sweep of its own. */
onExpire((sessionId) => {
  sessionStates.delete(sessionId);
});

/** Resolves the calling session's own state, creating a fresh one on first use. */
function getState(): SessionWorkflowState {
  const sessionId = getSessionId();
  let state = sessionStates.get(sessionId);
  if (!state) {
    state = { currentWorkflow: undefined, nextWorkflowSequence: 0 };
    sessionStates.set(sessionId, state);
  }
  return state;
}

/** Thrown by `updateStage` when the requested `from -> to` StageStatus change is not permitted (data-model.md). */
export class InvalidStageTransitionError extends Error {
  constructor(stageId: WorkflowStageId, from: StageStatus, to: StageStatus) {
    super(`Cannot transition stage "${stageId}" from "${from}" to "${to}".`);
    this.name = "InvalidStageTransitionError";
  }
}

/** Returns the calling session's in-progress workflow, or `undefined` if none has been started yet. */
export function getCurrentWorkflow(): TestGenerationWorkflow | undefined {
  return getState().currentWorkflow;
}

/** Test-only hook to clear every session's state between test runs (mirrors resetAIProvider). */
export function resetStore(): void {
  sessionStates.clear();
}

function initialStages(): Record<WorkflowStageId, WorkflowStageState> {
  return Object.fromEntries(
    WORKFLOW_STAGE_ORDER.map((stageId) => [
      stageId,
      { stageId, status: "not-yet-reached" as StageStatus },
    ]),
  ) as Record<WorkflowStageId, WorkflowStageState>;
}

/**
 * Creates a fresh workflow from an already-built ApiModel (upload + analysis complete
 * atomically, research.md D4) and makes it the calling session's current one, replacing any
 * prior workflow that same session had (FR-003) and clearing an idle-expired tombstone for this
 * session, if any (FR-007a's notice only applies until the session starts fresh — data-model.md).
 */
export function startWorkflow(input: {
  specificationFilename: string;
  apiModel: ApiModel;
}): TestGenerationWorkflow {
  const sessionId = getSessionId();
  const state = getState();
  const now = new Date();
  const nowIso = now.toISOString();
  const stages = initialStages();
  stages.upload = {
    stageId: "upload",
    status: "complete",
    enteredAt: nowIso,
    completedAt: nowIso,
  };
  stages.analysis = {
    stageId: "analysis",
    status: "complete",
    enteredAt: nowIso,
    completedAt: nowIso,
  };
  stages.apiReview = { stageId: "apiReview", status: "active", enteredAt: nowIso };

  state.nextWorkflowSequence += 1;
  state.currentWorkflow = {
    id: `wf-${now.getTime()}-${state.nextWorkflowSequence}`,
    createdAt: nowIso,
    updatedAt: nowIso,
    activeStageId: "apiReview",
    stages,
    specificationFilename: input.specificationFilename,
    apiModel: input.apiModel,
  };
  markActive(sessionId);
  return state.currentWorkflow;
}

/** Valid `from -> to` StageStatus transitions (data-model.md). Skip/retry/partial is aiEnhancement-only. */
const GENERAL_TRANSITIONS: ReadonlySet<string> = new Set([
  "not-yet-reached->active",
  "active->complete",
  "complete->stale",
  "complete->active",
  "stale->active",
]);

const AI_ENHANCEMENT_ONLY_TRANSITIONS: ReadonlySet<string> = new Set([
  "active->skipped",
  "active->partial",
  "skipped->active",
  "partial->active",
]);

function isValidTransition(
  stageId: WorkflowStageId,
  from: StageStatus,
  to: StageStatus,
): boolean {
  if (from === to) return false;
  const transition = `${from}->${to}`;
  if (GENERAL_TRANSITIONS.has(transition)) return true;
  return stageId === "aiEnhancement" && AI_ENHANCEMENT_ONLY_TRANSITIONS.has(transition);
}

/** Optional extras for `updateStage`: aiEnhancement-only error details and an active-stage move. */
export interface UpdateStageOptions {
  aiErrorCategory?: WorkflowStageState["aiErrorCategory"];
  aiErrorMessage?: string;
  /** What the user is shown for a non-success outcome (specs/013-ai-enhancement-viability). */
  failureExplanation?: WorkflowStageState["failureExplanation"];
  /** Marks a terminal skipped/partial as user-cancelled rather than failed (FR-021). */
  cancelled?: boolean;
  /** Also moves `activeStageId` to this stage (typically `stageId` itself or the next one). */
  activeStageId?: WorkflowStageId;
}

/**
 * Applies one validated stage-status transition (throws InvalidStageTransitionError otherwise)
 * and returns the updated workflow. Requires a current workflow to exist for the calling
 * session.
 */
export function updateStage(
  stageId: WorkflowStageId,
  status: StageStatus,
  options: UpdateStageOptions = {},
): TestGenerationWorkflow {
  const state = getState();
  if (!state.currentWorkflow) {
    throw new Error("No workflow is currently in progress.");
  }
  const current = state.currentWorkflow.stages[stageId];
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
    aiErrorCategory:
      status === "skipped" || status === "partial" ? options.aiErrorCategory : undefined,
    aiErrorMessage:
      status === "skipped" || status === "partial" ? options.aiErrorMessage : undefined,
    failureExplanation:
      status === "skipped" || status === "partial" ? options.failureExplanation : undefined,
    cancelled: status === "skipped" || status === "partial" ? options.cancelled : undefined,
  };
  // updateStage is the sole validated per-stage status transition, so it is the one place that
  // can log every "advance" and every "marked stale/complete" event without duplicating callers.
  logger.info("stage_transition", {
    workflowId: state.currentWorkflow.id,
    stageId,
    fromStatus: current.status,
    toStatus: status,
  });
  state.currentWorkflow = {
    ...state.currentWorkflow,
    updatedAt: now,
    activeStageId: options.activeStageId ?? state.currentWorkflow.activeStageId,
    stages: { ...state.currentWorkflow.stages, [stageId]: nextState },
  };
  return state.currentWorkflow;
}

/**
 * Patches `stages.aiEnhancement.progress` directly, without going through `updateStage()`'s
 * transition validation — setting or clearing progress never changes `status` itself
 * (specs/012-ai-enhancement-progress data-model.md "State transitions"). Pass `undefined` to
 * clear it (done once the stage reaches a terminal status).
 */
export function setAiEnhancementProgress(
  progress: AiEnhancementProgress | undefined,
): TestGenerationWorkflow {
  const state = getState();
  if (!state.currentWorkflow) {
    throw new Error("No workflow is currently in progress.");
  }
  const current = state.currentWorkflow.stages.aiEnhancement;
  state.currentWorkflow = {
    ...state.currentWorkflow,
    updatedAt: new Date().toISOString(),
    stages: {
      ...state.currentWorkflow.stages,
      aiEnhancement: { ...current, progress },
    },
  };
  return state.currentWorkflow;
}

/**
 * Upserts one `BatchOutcomeRecord` into `stages.aiEnhancement.batchOutcomes` by `index`,
 * creating the array on first use (specs/015-ai-batch-retry FR-001). Unlike `progress`, this is
 * never cleared when the stage settles — it is what a later single-batch retry reads and
 * updates. A retry of the same batch overwrites its record in place (`/speckit-clarify`
 * 2026-09-08: latest attempt only, no per-attempt history).
 */
export function setAiEnhancementBatchOutcome(record: BatchOutcomeRecord): TestGenerationWorkflow {
  const state = getState();
  if (!state.currentWorkflow) {
    throw new Error("No workflow is currently in progress.");
  }
  const current = state.currentWorkflow.stages.aiEnhancement;
  const existing = current.batchOutcomes ?? [];
  const next = existing.some((o) => o.index === record.index)
    ? existing.map((o) => (o.index === record.index ? record : o))
    : [...existing, record];
  state.currentWorkflow = {
    ...state.currentWorkflow,
    updatedAt: new Date().toISOString(),
    stages: {
      ...state.currentWorkflow.stages,
      aiEnhancement: { ...current, batchOutcomes: next },
    },
  };
  return state.currentWorkflow;
}

/**
 * Moves the in-flight run from the `preparing` phase to `generating`, stamping `generatingSince`
 * (specs/013-ai-enhancement-viability FR-018).
 *
 * The transition is one-way and idempotent: once generating, further calls are ignored rather
 * than re-stamping the timestamp, since clients derive displayed elapsed time from it and a
 * moving origin would make the timer jump backwards.
 */
export function markAiEnhancementGenerating(): TestGenerationWorkflow {
  const state = getState();
  if (!state.currentWorkflow) {
    throw new Error("No workflow is currently in progress.");
  }
  const current = state.currentWorkflow.stages.aiEnhancement;
  if (!current.progress || current.progress.phase === "generating") {
    return state.currentWorkflow;
  }
  return setAiEnhancementProgress({
    ...current.progress,
    phase: "generating",
    generatingSince: new Date().toISOString(),
  });
}

/**
 * Records that cancellation has been requested for the in-flight run
 * (specs/013-ai-enhancement-viability FR-020). Transitions false -> true only; a cancellation
 * cannot be withdrawn, so a repeat request is idempotent.
 */
export function requestAiEnhancementCancel(): TestGenerationWorkflow {
  const state = getState();
  if (!state.currentWorkflow) {
    throw new Error("No workflow is currently in progress.");
  }
  const current = state.currentWorkflow.stages.aiEnhancement;
  if (!current.progress || current.progress.cancelRequested) {
    return state.currentWorkflow;
  }
  return setAiEnhancementProgress({ ...current.progress, cancelRequested: true });
}

/** Whether cancellation has been requested for the calling session's run currently in flight. */
export function isAiEnhancementCancelRequested(): boolean {
  return getState().currentWorkflow?.stages.aiEnhancement.progress?.cancelRequested === true;
}

/**
 * Moves `activeStageId` to `stageId`, activating it first (not-yet-reached -> active) if it has
 * not already been entered. Used by every forward stage transition in US1.
 */
export function advanceActiveStage(stageId: WorkflowStageId): TestGenerationWorkflow {
  const state = getState();
  if (!state.currentWorkflow) {
    throw new Error("No workflow is currently in progress.");
  }
  const status = state.currentWorkflow.stages[stageId].status;
  if (status === "not-yet-reached" || status === "stale") {
    updateStage(stageId, "active");
  }
  return patchWorkflow({ activeStageId: stageId });
}

/** Merges arbitrary top-level fields (produced artifacts, activeStageId) onto the calling session's current workflow. */
export function patchWorkflow(
  patch: Partial<TestGenerationWorkflow>,
): TestGenerationWorkflow {
  const state = getState();
  if (!state.currentWorkflow) {
    throw new Error("No workflow is currently in progress.");
  }
  state.currentWorkflow = { ...state.currentWorkflow, ...patch, updatedAt: new Date().toISOString() };
  return state.currentWorkflow;
}
