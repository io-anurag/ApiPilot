import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReviewScenarioWire } from "../../src/services/reviewsClient";
import { TestScenarioReviewList } from "../../src/components/TestScenarioReviewList";

function makeItem(overrides: Partial<ReviewScenarioWire> = {}): ReviewScenarioWire {
  const base: ReviewScenarioWire = {
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
  return { ...base, ...overrides, scenario: { ...base.scenario, ...overrides.scenario } };
}

function makeScenarios(): ReviewScenarioWire[] {
  return [
    makeItem({
      scenarioId: "s1",
      scenario: {
        operationPath: "/widgets",
        operationMethod: "POST",
        category: "positive",
      } as never,
    }),
    makeItem({
      scenarioId: "s2",
      scenario: {
        operationPath: "/widgets",
        operationMethod: "POST",
        category: "missing-required-field",
      } as never,
    }),
    makeItem({
      scenarioId: "s3",
      scenario: {
        operationPath: "/widgets/{id}",
        operationMethod: "GET",
        category: "positive",
      } as never,
    }),
  ];
}

describe("TestScenarioReviewList bulk actions", () => {
  it("renders one distinguishable selection checkbox per scenario row", () => {
    render(
      <TestScenarioReviewList
        scenarios={makeScenarios()}
        selectedScenarioId={null}
        onSelect={vi.fn()}
        onBulkDecision={vi.fn()}
      />,
    );

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(4);
    expect(checkboxes[0]).toHaveAccessibleName(/POST \/widgets — positive/);
    expect(checkboxes[1]).toHaveAccessibleName(/POST \/widgets — missing-required-field/);
    expect(checkboxes[3]).toHaveAccessibleName("Select all filtered scenarios");
  });

  it("shows an all-filtered bulk action whose count matches the current filter", () => {
    render(
      <TestScenarioReviewList
        scenarios={makeScenarios()}
        selectedScenarioId={null}
        onSelect={vi.fn()}
        onBulkDecision={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Operation"), {
      target: { value: "POST /widgets" },
    });

    expect(
      screen.getByRole("button", { name: "Accept all filtered (2)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reject all filtered (2)" }),
    ).toBeInTheDocument();
  });

  it("confirms a filtered bulk accept and reports the exact filtered set", () => {
    const onBulkDecision = vi.fn();
    render(
      <TestScenarioReviewList
        scenarios={makeScenarios()}
        selectedScenarioId={null}
        onSelect={vi.fn()}
        onBulkDecision={onBulkDecision}
      />,
    );

    fireEvent.change(screen.getByLabelText("Operation"), {
      target: { value: "POST /widgets" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Accept all filtered (2)" }));

    expect(screen.getByTestId("confirm-dialog-count")).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: /^Accept \(2\)/ }));

    expect(onBulkDecision).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ scenarioId: "s1" }),
        expect.objectContaining({ scenarioId: "s2" }),
      ]),
      "accept",
      undefined,
    );
  });

  it("requires a reason before confirming a bulk reject", () => {
    const onBulkDecision = vi.fn();
    render(
      <TestScenarioReviewList
        scenarios={makeScenarios()}
        selectedScenarioId={null}
        onSelect={vi.fn()}
        onBulkDecision={onBulkDecision}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reject all filtered (3)" }));
    const confirmButton = screen.getByRole("button", { name: "Reject (3)" });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Duplicates" },
    });
    fireEvent.click(confirmButton);

    expect(onBulkDecision).toHaveBeenCalledWith(
      expect.any(Array),
      "reject",
      "Duplicates",
    );
  });

  it("bulk-decides only on the manually selected scenarios", () => {
    const onBulkDecision = vi.fn();
    render(
      <TestScenarioReviewList
        scenarios={makeScenarios()}
        selectedScenarioId={null}
        onSelect={vi.fn()}
        onBulkDecision={onBulkDecision}
      />,
    );

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[2]);

    fireEvent.click(screen.getByRole("button", { name: "Accept selected (2)" }));
    fireEvent.click(screen.getByRole("button", { name: /^Accept \(2\)/ }));

    const [items] = onBulkDecision.mock.calls[0];
    expect(items.map((i: ReviewScenarioWire) => i.scenarioId).sort()).toEqual([
      "s1",
      "s3",
    ]);
  });

  it("clears the manual selection when the active filter changes (FR-019)", () => {
    render(
      <TestScenarioReviewList
        scenarios={makeScenarios()}
        selectedScenarioId={null}
        onSelect={vi.fn()}
        onBulkDecision={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(
      screen.getByRole("button", { name: "Accept selected (1)" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "positive" },
    });

    expect(
      screen.queryByRole("button", { name: /Accept selected/ }),
    ).not.toBeInTheDocument();
  });

  it("tints an accepted/rejected row differently from a pending one, distinguishable beyond the status badge alone", () => {
    render(
      <TestScenarioReviewList
        scenarios={[
          makeItem({ scenarioId: "s1", state: "pending" }),
          makeItem({ scenarioId: "s2", state: "accepted" }),
          makeItem({ scenarioId: "s3", state: "rejected" }),
        ]}
        selectedScenarioId={null}
        onSelect={vi.fn()}
        onBulkDecision={vi.fn()}
      />,
    );

    expect(screen.getByTestId("review-scenario-row-s1").className).not.toMatch(
      /bg-(success|danger)-50/,
    );
    expect(screen.getByTestId("review-scenario-row-s2").className).toContain("bg-success-50");
    expect(screen.getByTestId("review-scenario-row-s3").className).toContain("bg-danger-50");
  });

  it("describes pagination progress in the load-more action", () => {
    const scenarios = Array.from({ length: 51 }, (_, index) =>
      makeItem({
        scenarioId: `s${index + 1}`,
        scenario: { id: `s${index + 1}` } as never,
      }),
    );

    render(
      <TestScenarioReviewList
        scenarios={scenarios}
        selectedScenarioId={null}
        onSelect={vi.fn()}
        onBulkDecision={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Load more scenarios; showing 50 of 51" }),
    ).toBeInTheDocument();
  });
});
