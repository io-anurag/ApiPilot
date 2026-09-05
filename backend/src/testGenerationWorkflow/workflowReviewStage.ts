import type { TestGenerationWorkflow, WorkflowReviewDecision, WorkflowReviewState } from "@apipilot/shared-domain";
import { createLogger } from "../logger";
import { PendingWorkflowDecisionsError, StageNotActiveError, UnknownWorkflowIdError } from "./errors";
import { computeDownstreamStaleness } from "./staleness";
import { advanceActiveStage, getCurrentWorkflow, patchWorkflow, updateStage } from "./workflowStore";

const logger = createLogger("testGenerationWorkflow.workflowReviewStage");

function requireActive(): TestGenerationWorkflow {
  const workflow = getCurrentWorkflow();
  if (!workflow || workflow.stages.workflowReview.status !== "active") {
    throw new StageNotActiveError("workflowReview is not the active stage.");
  }
  return workflow;
}

/** Allows a revision (FR-006): a new decision may reopen an already-completed workflowReview. */
function requireReviewable(): TestGenerationWorkflow {
  const workflow = getCurrentWorkflow();
  const status = workflow?.stages.workflowReview.status;
  if (!workflow || (status !== "active" && status !== "complete")) {
    throw new StageNotActiveError("workflowReview is not the active stage.");
  }
  return workflow;
}

/**
 * If workflowReview was already `complete`, reopens it (`active`) and marks `postmanGeneration`
 * `stale` if it was `complete` (FR-006). A no-op while still `active`.
 */
function reopenIfComplete(): void {
  const workflow = getCurrentWorkflow()!;
  if (workflow.stages.workflowReview.status !== "complete") return;
  const stale = computeDownstreamStaleness(workflow, "workflowReview");
  updateStage("workflowReview", "active");
  for (const stageId of stale) updateStage(stageId, "stale");
  patchWorkflow({ activeStageId: "workflowReview" });
}

/** One caller-supplied approve/reject decision for a discovered IntegrationWorkflow, passed to `recordWorkflowDecisions`. */
export interface WorkflowDecisionInput {
  workflowId: string;
  state: Exclude<WorkflowReviewState, "pending">;
  reason?: string;
}

/** Records approve/reject decisions per `IntegrationWorkflow.id` (research.md D5). */
export function recordWorkflowDecisions(decisions: WorkflowDecisionInput[]): TestGenerationWorkflow {
  const workflow = requireReviewable();
  const knownIds = new Set(workflow.dependencyAnalysis!.workflows.map((w) => w.id));
  for (const decision of decisions) {
    if (!knownIds.has(decision.workflowId)) {
      throw new UnknownWorkflowIdError(decision.workflowId);
    }
  }
  reopenIfComplete();
  const now = new Date().toISOString();
  const merged: Record<string, WorkflowReviewDecision> = { ...workflow.workflowDecisions };
  for (const decision of decisions) {
    merged[decision.workflowId] = {
      workflowId: decision.workflowId,
      state: decision.state,
      reason: decision.reason,
      recordedAt: now,
    };
  }
  return patchWorkflow({ workflowDecisions: merged });
}

function completeWorkflowReview(): TestGenerationWorkflow {
  const workflow = getCurrentWorkflow()!;
  const approvedWorkflowIds = workflow.dependencyAnalysis!.workflows
    .filter((w) => workflow.workflowDecisions?.[w.id]?.state === "approved")
    .map((w) => w.id);
  patchWorkflow({ approvedWorkflowIds });
  updateStage("workflowReview", "complete");
  return advanceActiveStage("postmanGeneration");
}

/**
 * Completes `workflowReview` once every discovered `IntegrationWorkflow` has a decision.
 * Refuses with `PendingWorkflowDecisionsError` while any remain undecided.
 */
export function continueWorkflowReview(): TestGenerationWorkflow {
  const startedAt = Date.now();
  try {
    const workflow = requireActive();
    const pending = workflow.dependencyAnalysis!.workflows.filter(
      (w) => (workflow.workflowDecisions?.[w.id]?.state ?? "pending") === "pending",
    );
    if (pending.length > 0) {
      throw new PendingWorkflowDecisionsError(pending.length);
    }
    const result = completeWorkflowReview();
    logger.info("stage_complete", {
      stage: "workflowReview",
      workflowId: result.id,
      approvedWorkflowCount: result.approvedWorkflowIds?.length ?? 0,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logger.error("stage_error", {
      stage: "workflowReview",
      workflowId: getCurrentWorkflow()?.id,
      errorCategory: error instanceof Error ? error.name : "UNKNOWN",
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

/**
 * Auto-completes `workflowReview` on entry when there is nothing to review — no discovered
 * workflows and no manual-confirmation candidates (research.md D5). Called by
 * `dependencyAnalysisStage.ts` right after `workflowReview` becomes active; a no-op otherwise.
 */
export function maybeAutoCompleteWorkflowReview(): TestGenerationWorkflow {
  const workflow = getCurrentWorkflow()!;
  if (workflow.stages.workflowReview.status !== "active") return workflow;
  const nothingToReview =
    workflow.dependencyAnalysis!.workflows.length === 0 &&
    workflow.dependencyAnalysis!.manualConfirmationCandidates.length === 0;
  if (!nothingToReview) return workflow;
  return completeWorkflowReview();
}
