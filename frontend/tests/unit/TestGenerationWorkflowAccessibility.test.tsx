import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WORKFLOW_STAGE_ORDER, type StageStatus, type TestGenerationWorkflow } from "@apipilot/shared-domain";
import { WorkflowStageTracker } from "../../src/components/WorkflowStageTracker";
import { ApiReviewStage } from "../../src/components/ApiReviewStage";
import { AiEnhancementStage } from "../../src/components/AiEnhancementStage";
import { WorkflowReviewStage } from "../../src/components/WorkflowReviewStage";
import { PostmanGenerationStage } from "../../src/components/PostmanGenerationStage";

function workflowWithStatuses(statuses: Partial<Record<string, StageStatus>>): TestGenerationWorkflow {
  const stages = Object.fromEntries(
    WORKFLOW_STAGE_ORDER.map((stageId) => [stageId, { stageId, status: statuses[stageId] ?? "not-yet-reached" }]),
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

describe("Test generation workflow accessibility", () => {
  it("communicates every stage's status through visible text, not color alone (FR-004)", () => {
    render(
      <WorkflowStageTracker
        workflow={workflowWithStatuses({ upload: "complete", apiReview: "active", scenarioReview: "stale" })}
      />,
    );
    expect(screen.getByTestId("stage-status-upload")).toHaveTextContent("Complete");
    expect(screen.getByTestId("stage-status-scenarioReview")).toHaveTextContent("Needs to be redone");
  });

  it("uses a native, keyboard-focusable button to revisit a completed stage", () => {
    render(
      <WorkflowStageTracker
        workflow={workflowWithStatuses({ scenarioReview: "complete" })}
        onViewStage={() => {}}
      />,
    );
    const button = screen.getByTestId("stage-status-scenarioReview");
    expect(button.tagName).toBe("BUTTON");
  });

  it("gives the apiReview continue action an accessible name", () => {
    render(
      <ApiReviewStage
        apiModel={{
          operations: [],
          securitySchemes: {},
          summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] },
        }}
        onAdvanced={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("surfaces the AI-enhancement skip condition through role=status, not color alone", () => {
    render(
      <AiEnhancementStage skipped aiErrorCategory="PROVIDER_UNAVAILABLE" aiErrorMessage="not ready" onAdvanced={() => {}} />,
    );
    expect(screen.getByTestId("ai-enhancement-skip-banner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry AI enhancement" })).toBeInTheDocument();
  });

  it("gives every workflow-review approve/reject control an accessible name", () => {
    render(
      <WorkflowReviewStage
        dependencyAnalysis={{
          requestId: "req-1",
          graph: { relationships: [] },
          workflows: [{ id: "wf-1", steps: [], variables: [], relationshipIds: [] }],
          manualConfirmationCandidates: [],
          cycles: [],
          aiOutcome: "skipped",
        }}
        decisions={undefined}
        onAdvanced={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("associates the Postman generation base-URL input with a visible, accessible label", () => {
    render(<PostmanGenerationStage onGenerated={() => {}} />);
    expect(screen.getByLabelText("Base address (optional)")).toBeInTheDocument();
  });

  it("gives Workflow Review's bulk-selection checkboxes and bulk buttons distinguishing accessible names and keyboard focus, mirroring Scenario Review (FR-014, FR-015, `/speckit-analyze` finding C1)", () => {
    render(
      <WorkflowReviewStage
        dependencyAnalysis={{
          requestId: "req-1",
          graph: { relationships: [] },
          workflows: [
            { id: "wf-1", steps: [], variables: [], relationshipIds: [] },
            { id: "wf-2", steps: [], variables: [], relationshipIds: [] },
          ],
          manualConfirmationCandidates: [],
          cycles: [],
          aiOutcome: "skipped",
        }}
        decisions={undefined}
        onAdvanced={() => {}}
      />,
    );

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toHaveAccessibleName(/wf-1/);
    expect(checkboxes[1]).toHaveAccessibleName(/wf-2/);
    checkboxes[0].focus();
    expect(document.activeElement).toBe(checkboxes[0]);

    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    const approveSelected = screen.getByRole("button", { name: "Approve selected (2)" });
    approveSelected.focus();
    expect(document.activeElement).toBe(approveSelected);
  });
});
