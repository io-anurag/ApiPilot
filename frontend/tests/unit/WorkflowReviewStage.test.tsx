import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { DependencyAnalysisResult } from "@apipilot/shared-domain";
import { WorkflowReviewStage } from "../../src/components/WorkflowReviewStage";
import * as client from "../../src/services/testGenerationWorkflowClient";

function makeDependencyAnalysis(workflowIds: string[]): DependencyAnalysisResult {
  return {
    graph: { relationships: [] },
    workflows: workflowIds.map((id, index) => ({
      id,
      steps: [{ position: index, operationMethod: "GET", operationPath: `/things/${id}` }],
      relationshipIds: [],
    })),
    manualConfirmationCandidates: [],
  } as unknown as DependencyAnalysisResult;
}

describe("WorkflowReviewStage bulk actions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders one distinguishable selection checkbox per workflow row, plus a select-all checkbox", () => {
    render(
      <WorkflowReviewStage
        dependencyAnalysis={makeDependencyAnalysis(["w1", "w2"])}
        decisions={undefined}
        onAdvanced={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: "Select all workflows" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /w1/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /w2/ })).toBeInTheDocument();
  });

  it("selects and deselects every workflow via the select-all checkbox", () => {
    render(
      <WorkflowReviewStage
        dependencyAnalysis={makeDependencyAnalysis(["w1", "w2", "w3"])}
        decisions={undefined}
        onAdvanced={vi.fn()}
      />,
    );

    const selectAll = screen.getByRole("checkbox", { name: "Select all workflows" });
    fireEvent.click(selectAll);

    expect(selectAll).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /w1/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /w2/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /w3/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Approve selected (3)" })).toBeInTheDocument();

    fireEvent.click(selectAll);

    expect(selectAll).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /w1/ })).not.toBeChecked();
    expect(screen.queryByTestId("workflow-review-bulk-actions")).not.toBeInTheDocument();
  });

  it("reflects a partial selection as unchecked on the select-all checkbox", () => {
    render(
      <WorkflowReviewStage
        dependencyAnalysis={makeDependencyAnalysis(["w1", "w2"])}
        decisions={undefined}
        onAdvanced={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /w1/ }));

    const selectAll = screen.getByRole("checkbox", { name: "Select all workflows" }) as HTMLInputElement;
    expect(selectAll.checked).toBe(false);
    expect(selectAll.indeterminate).toBe(true);
  });

  it("is keyboard-reachable and each bulk button has a distinguishing accessible name (FR-014, FR-015)", () => {
    render(
      <WorkflowReviewStage
        dependencyAnalysis={makeDependencyAnalysis(["w1", "w2"])}
        decisions={undefined}
        onAdvanced={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /w1/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /w2/ }));

    const approveSelected = screen.getByRole("button", { name: "Approve selected (2)" });
    const rejectSelected = screen.getByRole("button", { name: "Reject selected (2)" });
    expect(approveSelected).toBeInTheDocument();
    expect(rejectSelected).toBeInTheDocument();
    approveSelected.focus();
    expect(document.activeElement).toBe(approveSelected);
  });

  it("existing single-workflow Approve/Reject controls remain present and functional (FR-009)", async () => {
    const spy = vi.spyOn(client, "recordWorkflowDecisions").mockResolvedValue({
      ok: true,
      workflow: {} as never,
    });
    render(
      <WorkflowReviewStage
        dependencyAnalysis={makeDependencyAnalysis(["w1"])}
        decisions={undefined}
        onAdvanced={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(spy).toHaveBeenCalledWith([{ workflowId: "w1", state: "approved" }]);
  });

  it("reports the updated workflow via onAdvanced after a single-workflow decision succeeds", async () => {
    const updatedWorkflow = { activeStageId: "workflowReview" } as never;
    vi.spyOn(client, "recordWorkflowDecisions").mockResolvedValue({
      ok: true,
      workflow: updatedWorkflow,
    });
    const onAdvanced = vi.fn();
    render(
      <WorkflowReviewStage
        dependencyAnalysis={makeDependencyAnalysis(["w1"])}
        decisions={undefined}
        onAdvanced={onAdvanced}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await vi.waitFor(() =>
      expect(onAdvanced).toHaveBeenCalledWith({ ok: true, workflow: updatedWorkflow }),
    );
  });

  it("tints an approved/rejected workflow card differently from a pending one, distinguishable beyond the status badge alone", () => {
    render(
      <WorkflowReviewStage
        dependencyAnalysis={makeDependencyAnalysis(["w1", "w2", "w3"])}
        decisions={{
          w2: { workflowId: "w2", state: "approved", recordedAt: "2026-01-01T00:00:00.000Z" },
          w3: { workflowId: "w3", state: "rejected", recordedAt: "2026-01-01T00:00:00.000Z" },
        }}
        onAdvanced={vi.fn()}
      />,
    );

    expect(screen.getByTestId("workflow-review-item-w1").className).not.toMatch(
      /bg-(success|danger)-50/,
    );
    expect(screen.getByTestId("workflow-review-item-w2").className).toContain("bg-success-50");
    expect(screen.getByTestId("workflow-review-item-w3").className).toContain("bg-danger-50");
  });

  it("hides the Continue action while merely revisiting an already-completed stage, so it can't be clicked before a decision reopens it", () => {
    render(
      <WorkflowReviewStage
        dependencyAnalysis={makeDependencyAnalysis(["w1"])}
        decisions={undefined}
        onAdvanced={vi.fn()}
        isActiveStage={false}
      />,
    );

    expect(screen.queryByRole("button", { name: /^Continue/ })).not.toBeInTheDocument();
    // Approve/Reject remain live — changing a decision legitimately reopens the stage server-side.
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("hides Continue when revisiting an empty (no discovered workflows) workflowReview too", () => {
    render(
      <WorkflowReviewStage
        dependencyAnalysis={makeDependencyAnalysis([])}
        decisions={undefined}
        onAdvanced={vi.fn()}
        isActiveStage={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  });

  it("bulk-approves only the selected workflows after confirmation", async () => {
    const spy = vi.spyOn(client, "recordWorkflowDecisions").mockResolvedValue({
      ok: true,
      workflow: {} as never,
    });
    render(
      <WorkflowReviewStage
        dependencyAnalysis={makeDependencyAnalysis(["w1", "w2", "w3"])}
        decisions={undefined}
        onAdvanced={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /w1/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /w2/ }));

    fireEvent.click(screen.getByRole("button", { name: "Approve selected (2)" }));
    fireEvent.click(screen.getByRole("button", { name: /^Approve \(2\)/ }));

    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    const decisions = spy.mock.calls[0][0];
    expect(decisions.map((d) => d.workflowId).sort()).toEqual(["w1", "w2"]);
    expect(decisions.every((d) => d.state === "approved")).toBe(true);
  });
});
