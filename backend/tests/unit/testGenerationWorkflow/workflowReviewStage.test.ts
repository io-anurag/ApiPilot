import { beforeEach, describe, expect, it } from "vitest";
import type { ApiModel, DependencyAnalysisResult, IntegrationWorkflow } from "@apipilot/shared-domain";
import {
  PendingWorkflowDecisionsError,
  StageNotActiveError,
  UnknownWorkflowIdError,
} from "../../../src/testGenerationWorkflow/errors";
import {
  continueWorkflowReview,
  maybeAutoCompleteWorkflowReview,
  recordWorkflowDecisions,
} from "../../../src/testGenerationWorkflow/workflowReviewStage";
import { patchWorkflow, resetStore, startWorkflow, updateStage } from "../../../src/testGenerationWorkflow/workflowStore";

const apiModel: ApiModel = {
  operations: [],
  securitySchemes: {},
  summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] },
};

const fakeWorkflow: IntegrationWorkflow = {
  id: "wf-1",
  steps: [],
  variables: [],
  relationshipIds: [],
};

function reachWorkflowReview(dependencyAnalysis: DependencyAnalysisResult) {
  startWorkflow({ specificationFilename: "valid.yaml", apiModel });
  updateStage("apiReview", "complete");
  updateStage("deterministicGeneration", "active");
  updateStage("deterministicGeneration", "complete");
  updateStage("aiEnhancement", "active");
  updateStage("aiEnhancement", "complete");
  updateStage("scenarioReview", "active");
  updateStage("scenarioReview", "complete");
  updateStage("dependencyAnalysis", "active");
  updateStage("dependencyAnalysis", "complete");
  patchWorkflow({ dependencyAnalysis, activeStageId: "workflowReview" });
  updateStage("workflowReview", "active");
}

describe("workflowReviewStage", () => {
  beforeEach(() => resetStore());

  it("refuses decisions/continue while not the active stage", () => {
    expect(() => recordWorkflowDecisions([])).toThrow(StageNotActiveError);
    expect(() => continueWorkflowReview()).toThrow(StageNotActiveError);
  });

  it("refuses an unknown workflow id", () => {
    reachWorkflowReview({
      requestId: "req-1",
      graph: { relationships: [] },
      workflows: [fakeWorkflow],
      manualConfirmationCandidates: [],
      cycles: [],
      aiOutcome: "skipped",
    });
    expect(() => recordWorkflowDecisions([{ workflowId: "unknown", state: "approved" }])).toThrow(
      UnknownWorkflowIdError,
    );
  });

  it("continue refuses with PendingWorkflowDecisionsError while a workflow is undecided", () => {
    reachWorkflowReview({
      requestId: "req-1",
      graph: { relationships: [] },
      workflows: [fakeWorkflow],
      manualConfirmationCandidates: [],
      cycles: [],
      aiOutcome: "skipped",
    });
    expect(() => continueWorkflowReview()).toThrow(PendingWorkflowDecisionsError);
  });

  it("records a decision and continue completes once every workflow is decided", () => {
    reachWorkflowReview({
      requestId: "req-1",
      graph: { relationships: [] },
      workflows: [fakeWorkflow],
      manualConfirmationCandidates: [],
      cycles: [],
      aiOutcome: "skipped",
    });
    recordWorkflowDecisions([{ workflowId: "wf-1", state: "approved" }]);
    const wf = continueWorkflowReview();
    expect(wf.stages.workflowReview.status).toBe("complete");
    expect(wf.approvedWorkflowIds).toEqual(["wf-1"]);
    expect(wf.activeStageId).toBe("postmanGeneration");
    expect(wf.stages.postmanGeneration.status).toBe("active");
  });

  it("a rejected workflow is excluded from approvedWorkflowIds", () => {
    reachWorkflowReview({
      requestId: "req-1",
      graph: { relationships: [] },
      workflows: [fakeWorkflow],
      manualConfirmationCandidates: [],
      cycles: [],
      aiOutcome: "skipped",
    });
    recordWorkflowDecisions([{ workflowId: "wf-1", state: "rejected", reason: "not needed" }]);
    const wf = continueWorkflowReview();
    expect(wf.approvedWorkflowIds).toEqual([]);
  });

  it("maybeAutoCompleteWorkflowReview completes immediately when nothing is discovered (D5)", () => {
    reachWorkflowReview({
      requestId: "req-1",
      graph: { relationships: [] },
      workflows: [],
      manualConfirmationCandidates: [],
      cycles: [],
      aiOutcome: "skipped",
    });
    const wf = maybeAutoCompleteWorkflowReview();
    expect(wf.stages.workflowReview.status).toBe("complete");
    expect(wf.activeStageId).toBe("postmanGeneration");
  });

  it("changing a decision after completion reopens workflowReview and marks postmanGeneration stale (FR-006)", () => {
    reachWorkflowReview({
      requestId: "req-1",
      graph: { relationships: [] },
      workflows: [fakeWorkflow],
      manualConfirmationCandidates: [],
      cycles: [],
      aiOutcome: "skipped",
    });
    recordWorkflowDecisions([{ workflowId: "wf-1", state: "approved" }]);
    continueWorkflowReview();
    updateStage("postmanGeneration", "complete");

    const reopened = recordWorkflowDecisions([{ workflowId: "wf-1", state: "rejected" }]);
    expect(reopened.stages.workflowReview.status).toBe("active");
    expect(reopened.stages.postmanGeneration.status).toBe("stale");
  });

  it("maybeAutoCompleteWorkflowReview is a no-op when there is something to review", () => {
    reachWorkflowReview({
      requestId: "req-1",
      graph: { relationships: [] },
      workflows: [fakeWorkflow],
      manualConfirmationCandidates: [],
      cycles: [],
      aiOutcome: "skipped",
    });
    const wf = maybeAutoCompleteWorkflowReview();
    expect(wf.stages.workflowReview.status).toBe("active");
  });
});
