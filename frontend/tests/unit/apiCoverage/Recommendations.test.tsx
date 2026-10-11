import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { CoverageRecommendation } from "@apipilot/shared-domain";
import { Recommendations } from "../../../src/components/apiCoverage/Recommendations";

function recommendation(rank: number): CoverageRecommendation {
  return {
    rank,
    gapId: `gap-${rank}`,
    operationKey: `GET /resource-${rank}`,
    requirement: `requirement ${rank}`,
    why: "why",
    evidence: [],
    priority: "medium",
    rationale: "rationale",
    action: { type: "review-scenario", scenarioIds: [] },
  };
}

describe("Recommendations", () => {
  const all = Array.from({ length: 12 }, (_, i) => recommendation(i + 1));

  it("shows the top five and keeps the rest behind a toggle", () => {
    render(<Recommendations recommendations={all} onOpenWorkflow={vi.fn()} />);
    expect(screen.getAllByTestId("recommendation")).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "Show all 12 recommendations" }));
    expect(screen.getAllByTestId("recommendation")).toHaveLength(12);

    fireEvent.click(screen.getByRole("button", { name: "Show top 5 only" }));
    expect(screen.getAllByTestId("recommendation")).toHaveLength(5);
  });

  it("offers no toggle when everything already fits", () => {
    render(<Recommendations recommendations={all.slice(0, 5)} onOpenWorkflow={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Show/ })).not.toBeInTheDocument();
  });
});
