import type {
  ExecutionRunStatus,
  PerformanceRunStatus,
  SeedSource,
  TestGenerationWorkflow,
  UploadedCollectionSet,
  WorkflowStageId,
} from "@apipilot/shared-domain";
import { createLogger } from "../logger";
import { runWithSession } from "../session/sessionContext";
import { getCurrentWorkflow, updateStage } from "./workflowStore";

/**
 * Completes the guided workflow's Execution and Performance Testing stages when a qualifying run
 * settles (specs/048-workflow-run-stage-status). The run modules each call one applier and stay
 * unaware of stage names. The rules are pure so they can be tested without a store; the appliers
 * read the session's current workflow, evaluate a rule, and apply it. Nothing from the run is
 * copied into the workflow (FR-015) — only the stage status and its own timestamps change.
 */

const logger = createLogger("testGenerationWorkflow.runCompletion");

/** FR-001, FR-009: only a completed run of this workflow's own upload moves an Active Execution stage. */
export function shouldCompleteExecution(
  workflow: TestGenerationWorkflow,
  upload: Pick<UploadedCollectionSet, "sourceWorkflowId">,
  runStatus: ExecutionRunStatus,
): boolean {
  if (runStatus !== "completed") return false;
  if (upload.sourceWorkflowId === undefined || upload.sourceWorkflowId !== workflow.id) return false;
  return workflow.stages.execution.status === "active";
}

/** Identity is by title (workflow seed) or file name (specification seed) — the seed holds nothing more precise (research D3). */
function seedMatchesWorkflow(workflow: TestGenerationWorkflow, seedSource: SeedSource | null): boolean {
  if (seedSource === null) return false;
  if (seedSource.kind === "workflow") {
    const title = workflow.apiModel?.info?.title;
    return title !== undefined && seedSource.specificationTitle === title;
  }
  if (seedSource.kind === "specification") return seedSource.filename === workflow.specificationFilename;
  return false;
}

/** FR-004 to FR-007: a run in any final state, seeded from this workflow's specification, once Postman Generation is complete. */
export function shouldCompletePerformance(
  workflow: TestGenerationWorkflow,
  runStatus: PerformanceRunStatus,
  seedSource: SeedSource | null,
): boolean {
  if (runStatus === "in-progress") return false;
  if (!seedMatchesWorkflow(workflow, seedSource)) return false;
  if (workflow.stages.postmanGeneration.status !== "complete") return false;
  return workflow.stages.performanceTesting.status !== "complete";
}

/**
 * Reads the workflow, evaluates the rule and applies it. A failure is logged with its category and
 * never rethrown: the run has already settled and must not fail, or change, because a stage could
 * not be updated (research D6).
 */
function applyIfDue(
  stageId: WorkflowStageId,
  runStatus: string,
  isDue: (workflow: TestGenerationWorkflow) => boolean,
): void {
  let workflowId: string | undefined;
  try {
    const workflow = getCurrentWorkflow();
    if (!workflow || !isDue(workflow)) return;
    workflowId = workflow.id;
    updateStage(stageId, "complete");
    logger.info("stage_complete", { stageId, workflowId, runStatus });
  } catch (error) {
    logger.error("stage_update_failed", {
      stageId,
      workflowId,
      errorCategory: error instanceof Error ? error.name : "UNKNOWN",
    });
  }
}

/** Call from the calling session's context (the Import & Run settle path already has one). */
export function completeExecutionForUpload(
  uploadSourceWorkflowId: string | undefined,
  runStatus: ExecutionRunStatus,
): void {
  applyIfDue("execution", runStatus, (workflow) =>
    shouldCompleteExecution(workflow, { sourceWorkflowId: uploadSourceWorkflowId }, runStatus),
  );
}

/** Wraps its own session context: a settling k6 run's callbacks are not guaranteed a request context. */
export function completePerformanceForRun(
  sessionId: string,
  runStatus: PerformanceRunStatus,
  seedSource: SeedSource | null,
): void {
  runWithSession(sessionId, () =>
    applyIfDue("performanceTesting", runStatus, (workflow) => shouldCompletePerformance(workflow, runStatus, seedSource)),
  );
}
