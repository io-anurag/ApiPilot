import { describe, expect, it, vi } from "vitest";
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
  it("renders one distinguishable selection checkbox per workflow row", () => {
    render(
      <WorkflowReviewStage
        dependencyAnalysis={makeDependencyAnalysis(["w1", "w2"])}
        decisions={undefined}
        onAdvanced={vi.fn()}
      />,
    );

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toHaveAccessibleName(/w1/);
    expect(checkboxes[1]).toHaveAccessibleName(/w2/);
  });

  it("is keyboard-reachable and each bulk button has a distinguishing accessible name (FR-014, FR-015)", () => {
    render(
      <WorkflowReviewStage
        dependencyAnalysis={makeDependencyAnalysis(["w1", "w2"])}
        decisions={undefined}
        onAdvanced={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);

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

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    fireEvent.click(screen.getByRole("button", { name: "Approve selected (2)" }));
    fireEvent.click(screen.getByRole("button", { name: /^Approve \(2\)/ }));

    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    const decisions = spy.mock.calls[0][0];
    expect(decisions.map((d) => d.workflowId).sort()).toEqual(["w1", "w2"]);
    expect(decisions.every((d) => d.state === "approved")).toBe(true);
  });
});
