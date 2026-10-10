import type { CoverageFilter, CoverageSnapshot, ExecutionRun, TestGenerationWorkflow, UploadedCollectionExecutionRun } from "@apipilot/shared-domain";
import { calculateCoverage, type CoverageInput, type CoverageScenario } from "./calculateCoverage";
import { NoActiveWorkflowError, RunNotFoundError } from "./errors";
import { filterSnapshot } from "./filterSnapshot";

/** The data a coverage calculation reads. Injected so tests never touch session state or the clock. */
export interface CoverageSources {
  getWorkflow: () => TestGenerationWorkflow | undefined;
  listUploadedRuns: () => UploadedCollectionExecutionRun[];
  listGuidedRuns: () => ExecutionRun[];
  now: () => Date;
}

/**
 * The scenarios of the current specification with their review state. Without a review
 * workspace nothing has been reviewed yet, so every generated scenario is pending.
 */
export function scenariosFromWorkflow(workflow: TestGenerationWorkflow): CoverageScenario[] {
  if (workflow.reviewWorkspace) {
    return workflow.reviewWorkspace.scenarios.map((review) => ({
      scenario: review.scenario,
      reviewState: review.state,
      editedAt: review.history.filter((h) => h.type === "edit").map((h) => h.recordedAt),
    }));
  }
  const model = workflow.aiEnhancement?.enhancedTestModel ?? workflow.deterministicTestModel;
  return (model?.scenarios ?? []).map((scenario) => ({ scenario, reviewState: "pending" as const }));
}

export function buildCoverageInput(
  workflow: TestGenerationWorkflow,
  uploadedRuns: UploadedCollectionExecutionRun[],
  guidedRuns: ExecutionRun[],
  runId: string | undefined,
  now: Date,
): CoverageInput {
  if (!workflow.apiModel) throw new NoActiveWorkflowError();
  if (runId !== undefined && ![...uploadedRuns, ...guidedRuns].some((run) => run.id === runId)) {
    throw new RunNotFoundError(runId);
  }
  return {
    apiModel: workflow.apiModel,
    workflowId: workflow.id,
    specificationFilename: workflow.specificationFilename,
    ...(workflow.selectedOperationKeys !== undefined ? { selectedOperationKeys: workflow.selectedOperationKeys } : {}),
    scenarios: scenariosFromWorkflow(workflow),
    uploadedRuns,
    guidedRuns,
    ...(runId !== undefined ? { runId } : {}),
    now,
  };
}

/** The unfiltered snapshot for the calling session's current workflow. */
export function getCoverageSnapshot(sources: CoverageSources, runId?: string): CoverageSnapshot {
  const workflow = sources.getWorkflow();
  if (!workflow) throw new NoActiveWorkflowError();
  return calculateCoverage(
    buildCoverageInput(workflow, sources.listUploadedRuns(), sources.listGuidedRuns(), runId, sources.now()),
  );
}

/** The snapshot with a view filter and sort applied; shared by the screen route and the exports. */
export function getFilteredCoverage(sources: CoverageSources, filter: CoverageFilter, runId?: string): CoverageSnapshot {
  return filterSnapshot(getCoverageSnapshot(sources, runId), filter);
}
