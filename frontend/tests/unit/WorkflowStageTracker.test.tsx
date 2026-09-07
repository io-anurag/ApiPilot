import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  WORKFLOW_STAGE_ORDER,
  type StageStatus,
  type TestGenerationWorkflow,
} from "@apipilot/shared-domain";
import { WorkflowStageTracker } from "../../src/components/WorkflowStageTracker";

function workflowWithStatuses(
  statuses: Partial<Record<string, StageStatus>>,
): TestGenerationWorkflow {
  const stages = Object.fromEntries(
    WORKFLOW_STAGE_ORDER.map((stageId) => [
      stageId,
      { stageId, status: statuses[stageId] ?? "not-yet-reached" },
    ]),
  ) as TestGenerationWorkflow["stages"];
  return {
    id: "wf-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    activeStageId: "apiReview",
    stages,
    specificationFilename: "valid.yaml",
  };
}

describe("WorkflowStageTracker", () => {
  it("renders every stage's status with a distinguishable, non-color-only label (FR-004)", () => {
    render(
      <WorkflowStageTracker
        workflow={workflowWithStatuses({
          upload: "complete",
          apiReview: "active",
          scenarioReview: "stale",
          aiEnhancement: "skipped",
        })}
      />,
    );
    expect(screen.getByTestId("stage-status-upload")).toHaveTextContent("Complete");
    expect(screen.getByTestId("stage-status-apiReview")).toHaveTextContent("Active");
    expect(screen.getByTestId("stage-status-scenarioReview")).toHaveTextContent(
      "Needs to be redone",
    );
    expect(screen.getByTestId("stage-status-aiEnhancement")).toHaveTextContent("Skipped");
    expect(screen.getByTestId("stage-status-postmanGeneration")).toHaveTextContent(
      "Not yet reached",
    );
  });

  it("renders a 'partial' AI enhancement status distinctly from 'skipped' (FR-011)", () => {
    render(
      <WorkflowStageTracker
        workflow={workflowWithStatuses({ aiEnhancement: "partial" })}
      />,
    );
    expect(screen.getByTestId("stage-status-aiEnhancement")).toHaveTextContent(
      "Partially completed",
    );
  });

  it("does not render its own AI-unavailable notice — AiEnhancementStage's skip banner is the sole surface for it (FR-013, research.md D6)", () => {
    const workflow = workflowWithStatuses({ aiEnhancement: "skipped" });
    workflow.stages.aiEnhancement.aiErrorCategory = "PROVIDER_UNAVAILABLE";
    workflow.stages.aiEnhancement.aiErrorMessage = "local model not ready";
    render(<WorkflowStageTracker workflow={workflow} />);
    expect(screen.queryByTestId("workflow-ai-unavailable")).not.toBeInTheDocument();
  });

  it("surfaces specification analysis issues at the tracker level", () => {
    const workflow = workflowWithStatuses({});
    workflow.apiModel = {
      operations: [],
      securitySchemes: {},
      summary: {
        operationCount: 0,
        schemaCount: 0,
        securitySchemeCount: 0,
        issues: [
          {
            kind: "unresolved-ref",
            location: "#/paths/~1pets",
            message: "cannot resolve",
          },
        ],
      },
    };
    render(<WorkflowStageTracker workflow={workflow} />);
    expect(screen.getByTestId("workflow-analysis-issues")).toHaveTextContent(
      "1 specification analysis issue",
    );
  });

  it("lets a completed scenarioReview be revisited, and a completed apiReview be viewed read-only (research.md D3 addendum)", () => {
    const onViewStage = vi.fn();
    const workflow = workflowWithStatuses({
      apiReview: "complete",
      scenarioReview: "complete",
    });
    workflow.activeStageId = "workflowReview";
    render(
      <WorkflowStageTracker
        workflow={workflow}
        onViewStage={onViewStage}
        viewedStageId="upload"
      />,
    );

    fireEvent.click(screen.getByTestId("stage-status-scenarioReview"));
    expect(onViewStage).toHaveBeenCalledWith("scenarioReview");
    expect(screen.getByTestId("stage-status-scenarioReview")).toHaveTextContent(
      "revisit",
    );

    expect(screen.getByTestId("stage-status-apiReview").tagName).toBe("BUTTON");
    fireEvent.click(screen.getByTestId("stage-status-apiReview"));
    expect(onViewStage).toHaveBeenCalledWith("apiReview");
    expect(screen.getByTestId("stage-status-apiReview")).toHaveTextContent("view");
    expect(screen.getByTestId("stage-status-apiReview")).not.toHaveTextContent("revisit");
  });

  it("offers a read-only view of completed deterministicGeneration, aiEnhancement, and dependencyAnalysis stages", () => {
    const onViewStage = vi.fn();
    const workflow = workflowWithStatuses({
      apiReview: "complete",
      deterministicGeneration: "complete",
      aiEnhancement: "partial",
      dependencyAnalysis: "stale",
    });
    render(<WorkflowStageTracker workflow={workflow} onViewStage={onViewStage} />);

    for (const stageId of [
      "deterministicGeneration",
      "aiEnhancement",
      "dependencyAnalysis",
    ]) {
      const badge = screen.getByTestId(`stage-status-${stageId}`);
      expect(badge.tagName).toBe("BUTTON");
      fireEvent.click(badge);
      expect(onViewStage).toHaveBeenCalledWith(stageId);
      expect(badge).toHaveTextContent("view");
    }
  });

  it("offers every completed stage as read-only and returns from it to the active stage", () => {
    const onViewStage = vi.fn();
    const workflow = workflowWithStatuses({
      upload: "complete",
      analysis: "complete",
      apiReview: "active",
      postmanGeneration: "complete",
    });
    render(<WorkflowStageTracker workflow={workflow} onViewStage={onViewStage} />);

    for (const stageId of ["upload", "analysis", "postmanGeneration"]) {
      const badge = screen.getByTestId(`stage-status-${stageId}`);
      expect(badge.tagName).toBe("BUTTON");
      fireEvent.click(badge);
      expect(onViewStage).toHaveBeenCalledWith(stageId);
      expect(badge).toHaveTextContent("view");
    }

    const activeBadge = screen.getByTestId("stage-status-apiReview");
    expect(activeBadge.tagName).toBe("BUTTON");
    fireEvent.click(activeBadge);
    expect(onViewStage).toHaveBeenCalledWith("apiReview");
    expect(activeBadge).toHaveTextContent("return");
  });

  it("surfaces a dependency-analysis AI issue at the tracker level", () => {
    const workflow = workflowWithStatuses({});
    workflow.dependencyAnalysis = {
      requestId: "req-1",
      graph: { relationships: [] },
      workflows: [],
      manualConfirmationCandidates: [],
      cycles: [],
      aiOutcome: "unavailable",
      aiErrorCategory: "PROVIDER_UNAVAILABLE",
      aiErrorMessage: "not ready",
    };
    render(<WorkflowStageTracker workflow={workflow} />);
    expect(screen.getByTestId("workflow-dependency-ai-issue")).toHaveTextContent(
      "PROVIDER_UNAVAILABLE",
    );
  });
});
