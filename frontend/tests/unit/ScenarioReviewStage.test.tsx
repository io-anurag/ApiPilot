import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { ScenarioReviewStage } from "../../src/components/ScenarioReviewStage";

function workflowAt(activeStageId: string): TestGenerationWorkflow {
  return {
    id: "wf-1",
    activeStageId,
    reviewWorkspace: {
      workspaceRevision: 0,
      scenarios: [],
      summary: { total: 0, pending: 0, accepted: 0, rejected: 0, requiresReview: 0 },
      policy: { originsRequiringReview: ["AI", "USER"] },
    },
  } as unknown as TestGenerationWorkflow;
}

describe("ScenarioReviewStage", () => {
  it("shows Finalize Review when scenarioReview is the active stage", () => {
    render(
      <ScenarioReviewStage workflow={workflowAt("scenarioReview")} onAdvanced={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Finalize Review" })).toBeInTheDocument();
  });

  it("hides Finalize Review while merely revisiting an already-completed scenarioReview, so it can't be clicked before a decision reopens it", () => {
    render(
      <ScenarioReviewStage workflow={workflowAt("workflowReview")} onAdvanced={vi.fn()} />,
    );

    expect(
      screen.queryByRole("button", { name: /^Finalize Review/ }),
    ).not.toBeInTheDocument();
  });
});
