import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReviewScenarioWire } from "../../src/services/reviewsClient";
import { TestScenarioReviewRefinement } from "../../src/components/TestScenarioReviewRefinement";

const aiItem: ReviewScenarioWire = {
  scenarioId: "s2",
  revision: 0,
  state: "pending",
  isUserModified: false,
  history: [],
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
    assertions: [{ type: "status-code", expectedStatusCode: "400" }],
    provenance: {
      source: "AI",
      description: "d",
      duplicateOfRules: [],
      duplicateOfAICandidates: [],
      aiModel: "m",
      aiProvider: "mock",
      aiRationale: "r",
      aiConfidence: 0.5,
      aiAssumptions: [],
    },
  },
};

const ruleItem: ReviewScenarioWire = {
  ...aiItem,
  scenarioId: "s1",
  scenario: {
    ...aiItem.scenario,
    id: "s1",
    provenance: {
      source: "RULE",
      rule: "positive-request",
      description: "d",
      duplicateOfRules: [],
    },
  },
};

describe("TestScenarioReviewRefinement", () => {
  it("submits a valid edit with parsed JSON body", () => {
    const onEdit = vi.fn();
    render(
      <TestScenarioReviewRefinement
        item={aiItem}
        submitting={false}
        onEdit={onEdit}
        onRegenerate={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Request body"), {
      target: { value: '{"quantity": 500}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));

    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ body: { quantity: 500 } }),
      }),
    );
  });

  it("shows a validation error for malformed JSON instead of submitting", () => {
    const onEdit = vi.fn();
    render(
      <TestScenarioReviewRefinement
        item={aiItem}
        submitting={false}
        onEdit={onEdit}
        onRegenerate={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Request body"), {
      target: { value: "{not json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));

    expect(screen.getByTestId("review-edit-body-error")).toBeInTheDocument();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("allows regeneration only for AI-derived scenarios", () => {
    const onRegenerate = vi.fn();
    render(
      <TestScenarioReviewRefinement
        item={aiItem}
        submitting={false}
        onEdit={vi.fn()}
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Regenerate with AI" }));
    expect(onRegenerate).toHaveBeenCalled();
  });

  it("disables regeneration for rule-derived scenarios with an explanatory message", () => {
    render(
      <TestScenarioReviewRefinement
        item={ruleItem}
        submitting={false}
        onEdit={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Regenerate with AI" })).toBeDisabled();
    expect(screen.getByTestId("review-regenerate-unavailable")).toBeInTheDocument();
  });

  it("shows a recovery message when the last refinement action failed", () => {
    render(
      <TestScenarioReviewRefinement
        item={aiItem}
        submitting={false}
        error="AI provider is unavailable. Try again later."
        onEdit={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );

    expect(screen.getByTestId("review-refinement-error")).toHaveTextContent(
      "unavailable",
    );
  });
});
