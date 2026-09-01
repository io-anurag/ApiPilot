import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReviewScenarioWire } from "../../src/services/reviewsClient";
import { TestScenarioReviewList } from "../../src/components/TestScenarioReviewList";
import { TestScenarioReviewDecision } from "../../src/components/TestScenarioReviewDecision";
import { TestScenarioReviewDetail } from "../../src/components/TestScenarioReviewDetail";

const pendingItem: ReviewScenarioWire = {
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
};

const acceptedItem: ReviewScenarioWire = {
  ...pendingItem,
  scenarioId: "s2",
  state: "accepted",
};

describe("Test scenario review accessibility", () => {
  it("uses native, keyboard-focusable buttons for scenario selection rather than clickable divs", () => {
    render(
      <TestScenarioReviewList
        scenarios={[pendingItem]}
        selectedScenarioId={null}
        onSelect={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: /POST \/widgets/ });
    expect(button.tagName).toBe("BUTTON");
    expect(button).not.toHaveAttribute("tabindex", "-1");
  });

  it("associates filter selects with visible, accessible labels", () => {
    render(
      <TestScenarioReviewList
        scenarios={[pendingItem]}
        selectedScenarioId={null}
        onSelect={() => {}}
      />,
    );

    expect(screen.getByLabelText("Operation")).toBeInTheDocument();
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
  });

  it("communicates review state through visible text rather than color alone", () => {
    render(<TestScenarioReviewDetail item={acceptedItem} />);

    expect(screen.getByTestId("review-scenario-state")).toHaveTextContent("Accepted");
  });

  it("associates the rejection reason input with a visible, accessible label", () => {
    render(
      <TestScenarioReviewDecision
        item={pendingItem}
        submitting={false}
        onAccept={() => {}}
        onReject={() => {}}
      />,
    );

    expect(screen.getByLabelText("Rejection reason")).toBeInTheDocument();
  });

  it("surfaces action failures through role=alert for assistive technology", () => {
    render(
      <TestScenarioReviewDecision
        item={pendingItem}
        submitting={false}
        error="Could not apply the decision."
        onAccept={() => {}}
        onReject={() => {}}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Could not apply the decision.");
  });

  it("keeps JSON request payloads in a scrollable, non-truncating block", () => {
    render(<TestScenarioReviewDetail item={pendingItem} />);

    const requestBlock = screen.getByTestId("review-scenario-request");
    expect(requestBlock.tagName).toBe("PRE");
  });
});
