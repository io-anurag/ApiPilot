import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReviewScenarioWire } from "../../src/services/reviewsClient";
import { TestScenarioReviewDecision } from "../../src/components/TestScenarioReviewDecision";

function makeItem(overrides: Partial<ReviewScenarioWire> = {}): ReviewScenarioWire {
  return {
    scenarioId: "s1",
    revision: 0,
    state: "pending",
    isUserModified: false,
    history: [],
    scenario: {
      id: "s1",
      operationPath: "/widgets",
      operationMethod: "POST",
      category: "positive",
      request: { pathParameters: {}, queryParameters: {}, headers: {}, body: {} },
      displayRequest: { pathParameters: {}, queryParameters: {}, headers: {}, body: {} },
      assertions: [],
      provenance: {
        source: "RULE",
        rule: "positive-request",
        description: "d",
        duplicateOfRules: [],
      },
    },
    ...overrides,
  };
}

describe("TestScenarioReviewDecision", () => {
  it("accepts a pending scenario", async () => {
    const onAccept = vi.fn();
    render(
      <TestScenarioReviewDecision
        item={makeItem()}
        submitting={false}
        onAccept={onAccept}
        onReject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    expect(onAccept).toHaveBeenCalled();
  });

  it("requires a non-empty rejection reason before enabling reject", async () => {
    const onReject = vi.fn();
    render(
      <TestScenarioReviewDecision
        item={makeItem()}
        submitting={false}
        onAccept={vi.fn()}
        onReject={onReject}
      />,
    );

    const rejectButton = screen.getByRole("button", { name: "Reject" });
    expect(rejectButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Rejection reason"), {
      target: { value: "Not relevant" },
    });
    expect(rejectButton).toBeEnabled();

    fireEvent.click(rejectButton);
    expect(onReject).toHaveBeenCalledWith("Not relevant");
  });

  it("disables controls and shows the current state for a non-pending scenario", () => {
    render(
      <TestScenarioReviewDecision
        item={makeItem({ state: "accepted" })}
        submitting={false}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByTestId("review-decision-state")).toHaveTextContent(
      "already accepted",
    );
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
  });

  it("shows a recovery message when the last decision failed", () => {
    render(
      <TestScenarioReviewDecision
        item={makeItem()}
        submitting={false}
        error="Could not apply the decision. Try again."
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByTestId("review-decision-error")).toHaveTextContent("Try again");
  });
});
