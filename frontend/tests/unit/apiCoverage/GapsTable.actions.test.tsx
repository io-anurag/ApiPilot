import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { GapsTable } from "../../../src/components/apiCoverage/GapsTable";
import { operation, scenario } from "./coverageFixtures";

function renderTable(operations: ReturnType<typeof operation>[], scenarios: ReturnType<typeof scenario>[]) {
  const onOpenWorkflow = vi.fn();
  render(
    <GapsTable
      operations={operations}
      requirements={[]}
      scenarios={scenarios}
      gaps={[]}
      availableRuns={[{ id: "run-2" }, { id: "run-1" }]}
      showVerified={false}
      totalOperations={operations.length}
      sort={undefined}
      order="asc"
      onSort={vi.fn()}
      onReset={vi.fn()}
      filtered={false}
      onOpenWorkflow={onOpenWorkflow}
    />,
  );
  return onOpenWorkflow;
}

const rowFor = (key: string): HTMLElement =>
  screen.getAllByTestId("gap-row").find((r) => r.dataset.operation === key) as HTMLElement;

describe("GapsTable result link", () => {
  it("is offered when a run produced only inconclusive results, and opens that run", () => {
    // Nothing verified and nothing failed: the request was edited before the run.
    const onOpenWorkflow = renderTable(
      [operation({ operationKey: "PATCH /orders/{id}", failedCount: 0, runtime: { verified: 0, total: 5 } })],
      [scenario({ scenarioId: "s1", operationKey: "PATCH /orders/{id}", verdict: "inconclusive", cause: "request-edited", runId: "run-1" })],
    );
    fireEvent.click(within(rowFor("PATCH /orders/{id}")).getByRole("button", { name: "Open results" }));
    expect(onOpenWorkflow).toHaveBeenCalledWith("import-collection", { runId: "run-1" });
  });

  it("is not offered when no run produced a result for the operation", () => {
    renderTable(
      [operation({ operationKey: "GET /orders" })],
      [scenario({ scenarioId: "s2", operationKey: "GET /orders", verdict: "not-executed" })],
    );
    expect(within(rowFor("GET /orders")).queryByRole("button", { name: /Open (failing )?results?/ })).not.toBeInTheDocument();
  });
});
