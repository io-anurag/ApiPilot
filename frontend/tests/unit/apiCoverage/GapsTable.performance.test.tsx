import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GapsTable } from "../../../src/components/apiCoverage/GapsTable";
import { operation } from "./coverageFixtures";

/** SC-006, frontend half: a 500-operation table is usable at once and re-sorting is immediate. */
describe("GapsTable at 500 operations", () => {
  const operations = Array.from({ length: 500 }, (_, i) => operation({ operationKey: `GET /resource-${i}` }));

  it("renders the first page and responds to a sort or page change well inside one second", () => {
    const onSort = vi.fn();
    const started = performance.now();
    render(
      <GapsTable operations={operations} totalOperations={500} sort="priority" order="asc" onSort={onSort} onReset={vi.fn()} filtered={false} onOpenWorkflow={vi.fn()} />,
    );
    expect(screen.getAllByTestId("gap-row")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: /Endpoint/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(onSort).toHaveBeenCalledWith("path");
    expect(screen.getByText(/Showing 11–20 of 500 operations/)).toBeInTheDocument();
  });
});
