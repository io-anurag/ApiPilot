import { describe, expect, it } from "vitest";
import {
  WORKFLOW_STAGE_ORDER,
  type StageStatus,
  type TestGenerationWorkflow,
  type WorkflowReviewDecision,
  type WorkflowStageId,
  type WorkflowStageState,
} from "../../src/testGenerationWorkflow";

describe("test generation workflow contracts", () => {
  it("WORKFLOW_STAGE_ORDER has exactly the nine stage ids spec.md FR-001 names, in order", () => {
    expect(WORKFLOW_STAGE_ORDER).toEqual([
      "upload",
      "analysis",
      "apiReview",
      "deterministicGeneration",
      "aiEnhancement",
      "scenarioReview",
      "dependencyAnalysis",
      "workflowReview",
      "postmanGeneration",
    ] satisfies WorkflowStageId[]);
  });

  it("types a WorkflowStageState for every StageStatus value", () => {
    const statuses: StageStatus[] = ["not-yet-reached", "active", "complete", "stale", "skipped"];
    const states: WorkflowStageState[] = statuses.map((status) => ({
      stageId: "aiEnhancement",
      status,
    }));
    expect(states).toHaveLength(5);
  });

  it("types a WorkflowReviewDecision", () => {
    const decision: WorkflowReviewDecision = {
      workflowId: "wf-1",
      state: "approved",
      recordedAt: new Date(0).toISOString(),
    };
    expect(decision.state).toBe("approved");
  });

  it("types a minimal freshly-started TestGenerationWorkflow", () => {
    const stages = Object.fromEntries(
      WORKFLOW_STAGE_ORDER.map((stageId) => [
        stageId,
        { stageId, status: stageId === "apiReview" ? "active" : "not-yet-reached" } as const,
      ]),
    ) as Record<WorkflowStageId, WorkflowStageState>;
    stages.upload.status = "complete";
    stages.analysis.status = "complete";

    const workflow: TestGenerationWorkflow = {
      id: "wf-1",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      activeStageId: "apiReview",
      stages,
      specificationFilename: "valid.yaml",
    };

    expect(workflow.activeStageId).toBe("apiReview");
    expect(workflow.stages.apiReview.status).toBe("active");
  });
});
