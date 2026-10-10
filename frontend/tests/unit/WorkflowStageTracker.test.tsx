import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  WORKFLOW_STAGE_ORDER,
  type StageStatus,
  type TestGenerationWorkflow,
} from "@apipilot/shared-domain";
import { WorkflowStageTracker } from "../../src/components/WorkflowStageTracker";
import { WORKFLOW_PHASES, getPhaseOfStage } from "../../src/components/workflowStageViewModel";
import { openPhase } from "./workflowTrackerTestUtils";

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
  it("shows a semantic icon for every workflow sub-stage", () => {
    render(<WorkflowStageTracker workflow={workflowWithStatuses({})} />);

    for (const phase of WORKFLOW_PHASES) {
      openPhase(phase.id);
      for (const stageId of phase.stages) {
        expect(screen.getByTestId(`stage-icon-${stageId}`)).toHaveAttribute(
          "aria-hidden",
          "true",
        );
      }
    }
  });

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
    openPhase("design");
    expect(screen.getByTestId("stage-status-scenarioReview")).toHaveTextContent(
      "Needs to be redone",
    );
    expect(screen.getByTestId("stage-status-aiEnhancement")).toHaveTextContent("Skipped");
    openPhase("execute");
    expect(screen.getByTestId("stage-status-postmanGeneration")).toHaveTextContent(
      "Not yet reached",
    );
  });

  it("explains why a not-yet-reached stage is locked (spec 027 FR-004)", () => {
    render(
      <WorkflowStageTracker
        workflow={workflowWithStatuses({
          upload: "complete",
          analysis: "complete",
          apiReview: "active",
        })}
      />,
    );
    openPhase("design");
    expect(screen.getByTestId("stage-lock-reason-deterministicGeneration")).toHaveTextContent(
      "Complete API Review first",
    );
    // The lock reason is a tooltip alongside the status label, not a replacement for it.
    expect(screen.getByTestId("stage-status-deterministicGeneration")).toHaveTextContent(
      "Not yet reached",
    );
  });

  it("labels the 'execution' stage and renders its skipped status distinctly (specs/009 Clarifications 2026-09-20)", () => {
    render(
      <WorkflowStageTracker workflow={workflowWithStatuses({ execution: "skipped" })} />,
    );
    openPhase("execute");
    expect(screen.getByText("Execution")).toBeInTheDocument();
    expect(screen.getByTestId("stage-status-execution")).toHaveTextContent("Skipped");
  });

  it("renders a 'partial' AI enhancement status distinctly from 'skipped' (FR-011)", () => {
    render(
      <WorkflowStageTracker
        workflow={workflowWithStatuses({ aiEnhancement: "partial" })}
      />,
    );
    openPhase("design");
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

  function withOneAnalysisIssue(
    workflow: TestGenerationWorkflow,
  ): TestGenerationWorkflow {
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
    return workflow;
  }

  it("surfaces specification analysis issues at the tracker level on a stage that doesn't already show them itself", () => {
    const workflow = withOneAnalysisIssue(workflowWithStatuses({}));
    render(<WorkflowStageTracker workflow={workflow} viewedStageId="scenarioReview" />);
    expect(screen.getByTestId("workflow-analysis-issues")).toHaveTextContent(
      "1 specification analysis issue",
    );
  });

  it("does not duplicate the analysis-issues banner on upload/analysis/apiReview — AnalysisSummary already shows them there", () => {
    const workflow = withOneAnalysisIssue(workflowWithStatuses({}));
    for (const stageId of ["upload", "analysis", "apiReview"] as const) {
      const { unmount } = render(
        <WorkflowStageTracker workflow={workflow} viewedStageId={stageId} />,
      );
      expect(screen.queryByTestId("workflow-analysis-issues")).not.toBeInTheDocument();
      unmount();
    }
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

    openPhase("design");
    fireEvent.click(screen.getByTestId("stage-status-scenarioReview"));
    expect(onViewStage).toHaveBeenCalledWith("scenarioReview");
    expect(screen.getByTestId("stage-status-scenarioReview")).toHaveTextContent(
      "revisit",
    );

    openPhase("prepare");
    expect(screen.getByTestId("stage-status-apiReview").tagName).toBe("BUTTON");
    fireEvent.click(screen.getByTestId("stage-status-apiReview"));
    expect(onViewStage).toHaveBeenCalledWith("apiReview");
    expect(screen.getByTestId("stage-status-apiReview")).toHaveTextContent("view");
    expect(screen.getByTestId("stage-status-apiReview")).not.toHaveTextContent("revisit");
  });

  it("moves the highlighted/current stage to whichever stage is being viewed, not just the true active stage", () => {
    const workflow = workflowWithStatuses({
      apiReview: "complete",
      scenarioReview: "complete",
    });
    workflow.activeStageId = "workflowReview";

    const { rerender } = render(
      <WorkflowStageTracker
        workflow={workflow}
        onViewStage={() => {}}
        viewedStageId={workflow.activeStageId}
      />,
    );
    expect(
      screen.getByTestId("stage-status-workflowReview").closest("li"),
    ).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("phase-tile-organize")).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("phase-tile-prepare")).not.toHaveAttribute("aria-current");

    // Clicking "back" to view a completed stage (apiReview) must move the highlight there too —
    // it must not stay pinned to the true active stage (workflowReview) while its content is no
    // longer what's on screen.
    rerender(
      <WorkflowStageTracker
        workflow={workflow}
        onViewStage={() => {}}
        viewedStageId="apiReview"
      />,
    );
    expect(screen.getByTestId("stage-status-apiReview").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    // The tracker follows the stage on screen into its phase, so Organize's chips are unlisted.
    expect(screen.queryByTestId("stage-status-workflowReview")).not.toBeInTheDocument();
    expect(screen.getByTestId("phase-tile-prepare")).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("phase-tile-organize")).not.toHaveAttribute("aria-current");
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
    ] as const) {
      openPhase(getPhaseOfStage(stageId).id);
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

    for (const stageId of ["upload", "analysis", "postmanGeneration"] as const) {
      openPhase(getPhaseOfStage(stageId).id);
      const badge = screen.getByTestId(`stage-status-${stageId}`);
      expect(badge.tagName).toBe("BUTTON");
      fireEvent.click(badge);
      expect(onViewStage).toHaveBeenCalledWith(stageId);
      expect(badge).toHaveTextContent("view");
    }

    openPhase("prepare");
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

  it("does not surface the tracker-level 'did not complete' banner for a partially-successful AI pass", () => {
    const workflow = workflowWithStatuses({});
    workflow.dependencyAnalysis = {
      requestId: "req-1",
      graph: { relationships: [] },
      workflows: [],
      manualConfirmationCandidates: [],
      cycles: [],
      aiOutcome: "partial",
      aiErrorCategory: "INVALID_RESPONSE",
      aiErrorMessage: "AI provider returned invalid output for 1 of 33 batches",
    };
    render(<WorkflowStageTracker workflow={workflow} />);
    expect(screen.queryByTestId("workflow-dependency-ai-issue")).not.toBeInTheDocument();
  });

  it("lets the performance stage be opened once Postman Generation is complete, whatever Execution's state (AP-029 research D1)", () => {
    const onViewStage = vi.fn();
    const complete = Object.fromEntries(
      WORKFLOW_STAGE_ORDER.slice(
        0,
        WORKFLOW_STAGE_ORDER.indexOf("postmanGeneration") + 1,
      ).map((id) => [id, "complete" as StageStatus]),
    );
    render(
      <WorkflowStageTracker
        workflow={{
          ...workflowWithStatuses({ ...complete, execution: "active" }),
          activeStageId: "execution",
        }}
        onViewStage={onViewStage}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Not yet reached — open/ }));
    expect(onViewStage).toHaveBeenCalledWith("performanceTesting");
  });

  it("keeps the performance stage locked until Postman Generation is complete", () => {
    render(
      <WorkflowStageTracker
        workflow={workflowWithStatuses({ postmanGeneration: "active" })}
        onViewStage={vi.fn()}
      />,
    );
    openPhase("execute");
    expect(screen.getByTestId("stage-status-performanceTesting")).toHaveTextContent(
      "Not yet reached",
    );
    expect(screen.getByTestId("stage-lock-reason-performanceTesting")).toHaveTextContent(
      "Complete Postman Generation first",
    );
  });

  describe("phase grouping", () => {
    it("shows the position in the 11-step workflow and lists only the phase on screen", () => {
      render(
        <WorkflowStageTracker
          workflow={workflowWithStatuses({
            upload: "complete",
            analysis: "complete",
            apiReview: "active",
          })}
        />,
      );
      expect(screen.getByTestId("workflow-position")).toHaveTextContent(
        "Step 3 of 11 · Prepare › API Review",
      );
      expect(screen.getByTestId("phase-tile-prepare")).toHaveAttribute("aria-current", "step");
      expect(screen.getByTestId("phase-tile-prepare")).toHaveTextContent("2 of 3 done");
      expect(screen.getByTestId("phase-tile-design")).toHaveTextContent("Locked");
      expect(screen.getByTestId("stage-status-analysis")).toBeInTheDocument();
      expect(screen.queryByTestId("stage-status-aiEnhancement")).not.toBeInTheDocument();
    });

    it("collapses a finished phase to one Complete tile that can be opened to view its stages", () => {
      render(
        <WorkflowStageTracker
          workflow={{
            ...workflowWithStatuses({
              upload: "complete",
              analysis: "complete",
              apiReview: "complete",
              deterministicGeneration: "active",
            }),
            activeStageId: "deterministicGeneration",
          }}
          onViewStage={vi.fn()}
        />,
      );
      expect(screen.getByTestId("phase-tile-prepare")).toHaveTextContent("Complete");
      expect(screen.queryByTestId("stage-status-upload")).not.toBeInTheDocument();

      openPhase("prepare");
      expect(screen.getByTestId("stage-status-upload")).toHaveTextContent("Complete — view");
      // Opening another phase's tile does not move the highlight off the stage on screen.
      expect(screen.getByTestId("phase-tile-design")).toHaveAttribute("aria-current", "step");
    });

    it("lets the open phase be collapsed again, and follows the workflow when its phase changes", () => {
      const onViewStage = vi.fn();
      const design = workflowWithStatuses({
        apiReview: "complete",
        deterministicGeneration: "active",
      });
      design.activeStageId = "deterministicGeneration";
      const { rerender } = render(
        <WorkflowStageTracker workflow={design} onViewStage={onViewStage} />,
      );

      const designToggle = within(screen.getByTestId("phase-tile-design")).getByRole("button");
      fireEvent.click(designToggle);
      expect(designToggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByTestId("stage-status-deterministicGeneration")).not.toBeInTheDocument();

      openPhase("prepare");
      const organize = workflowWithStatuses({
        apiReview: "complete",
        deterministicGeneration: "complete",
        aiEnhancement: "complete",
        scenarioReview: "complete",
        dependencyAnalysis: "active",
      });
      organize.activeStageId = "dependencyAnalysis";
      rerender(<WorkflowStageTracker workflow={organize} onViewStage={onViewStage} />);
      expect(screen.getByTestId("stage-status-dependencyAnalysis")).toBeInTheDocument();
      expect(screen.queryByTestId("stage-status-upload")).not.toBeInTheDocument();
    });

    it("rolls a stale stage up as 'Needs to be redone' on its phase tile", () => {
      render(
        <WorkflowStageTracker
          workflow={workflowWithStatuses({ scenarioReview: "stale", apiReview: "complete" })}
        />,
      );
      expect(screen.getByTestId("phase-tile-design")).toHaveTextContent("Needs to be redone");
    });
  });
});
