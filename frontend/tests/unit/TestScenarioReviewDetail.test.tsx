import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReviewScenarioWire } from "../../src/services/reviewsClient";
import { TestScenarioReviewDetail } from "../../src/components/TestScenarioReviewDetail";

const ruleItem: ReviewScenarioWire = {
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
    request: {
      pathParameters: {},
      queryParameters: {},
      headers: { Authorization: "Bearer secret" },
      body: { name: "Widget" },
    },
    displayRequest: {
      pathParameters: {},
      queryParameters: {},
      headers: { Authorization: "[redacted]" },
      body: { name: "Widget" },
    },
    assertions: [{ type: "status-code", expectedStatusCode: "201" }],
    provenance: {
      source: "RULE",
      rule: "positive-request",
      description: "Fully conformant request",
      duplicateOfRules: [],
    },
  },
};

const aiItem: ReviewScenarioWire = {
  scenarioId: "s2",
  revision: 1,
  state: "accepted",
  isUserModified: false,
  decision: { state: "accepted", recordedAt: "2026-01-01T00:00:00.000Z", revision: 1 },
  history: [
    {
      type: "decision",
      decision: {
        state: "accepted",
        recordedAt: "2026-01-01T00:00:00.000Z",
        revision: 1,
      },
    },
  ],
  scenario: {
    id: "s2",
    operationPath: "/widgets",
    operationMethod: "POST",
    category: "numeric-boundary",
    targetLocation: "body",
    targetField: "quantity",
    request: {
      pathParameters: {},
      queryParameters: {},
      headers: {},
      body: { quantity: 0 },
    },
    displayRequest: {
      pathParameters: {},
      queryParameters: {},
      headers: {},
      body: { quantity: 0 },
    },
    assertions: [],
    provenance: {
      source: "AI",
      description: "Quantity below the documented minimum",
      duplicateOfRules: [],
      duplicateOfAICandidates: [],
      aiModel: "mock-model",
      aiProvider: "mock",
      aiRationale: "quantity minimum is 1",
      aiConfidence: 0.75,
      aiAssumptions: ["assumes integer quantity"],
    },
  },
};

describe("TestScenarioReviewDetail", () => {
  it("shows the redacted display request rather than the raw request", () => {
    render(<TestScenarioReviewDetail item={ruleItem} />);

    expect(screen.getByTestId("review-scenario-request")).toHaveTextContent("[redacted]");
    expect(screen.queryByText(/Bearer secret/)).not.toBeInTheDocument();
  });

  it("shows the pending state and rule origin as accessible text", () => {
    render(<TestScenarioReviewDetail item={ruleItem} />);

    expect(screen.getByTestId("review-scenario-state")).toHaveTextContent(
      "Pending review",
    );
    expect(screen.getByTestId("review-scenario-origin")).toHaveTextContent(
      "Deterministic rule",
    );
  });

  it("shows AI rationale, confidence, assumptions, and decision history", () => {
    render(<TestScenarioReviewDetail item={aiItem} />);

    expect(screen.getByTestId("review-scenario-rationale")).toHaveTextContent(
      "quantity minimum is 1",
    );
    expect(screen.getByTestId("review-scenario-confidence")).toHaveTextContent("0.75");
    expect(screen.getByText("assumes integer quantity")).toBeInTheDocument();
    expect(screen.getByTestId("review-scenario-state")).toHaveTextContent("Accepted");
    expect(screen.getByTestId("review-scenario-history")).toHaveTextContent(
      "accepted at revision 1",
    );
  });

  it("shows a gap message when no assertions are documented", () => {
    render(<TestScenarioReviewDetail item={aiItem} />);

    expect(screen.getByText(/No documented response was available/)).toBeInTheDocument();
  });
});
