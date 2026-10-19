import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { FindingFilters, FindingsList } from "../../../src/components/securityLab/FindingsList";
import type { FindingFilterQuery } from "../../../src/services/securityLabClient";
import { CATEGORIES, finding, findingList, findingOccurrence } from "./securityFixtures";

const NAMES = { authentication: "Authentication", "input-validation": "Input validation" };

describe("FindingFilters (T122, FR-054, FR-058)", () => {
  const list = findingList([finding({ unreviewedOccurrence: true, status: "accepted-risk", occurrenceCount: 3 }), finding({ id: "sf-2", severity: { suggested: "low", current: "low" } })]);

  function renderFilters(value: FindingFilterQuery = {}) {
    const onChange = vi.fn();
    const view = render(<FindingFilters value={value} onChange={onChange} categories={CATEGORIES} counts={list.counts} total={list.total} />);
    return { onChange, ...view };
  }

  it("offers severity, status, category, operation and the unreviewed filter as labelled controls", () => {
    renderFilters();
    for (const label of ["Severity", "Status", "Category", "Operation (exact, such as GET /orders)", "Only findings with an unreviewed occurrence"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("applies selects at once and removes a filter set back to Any", () => {
    const { onChange } = renderFilters({ severity: "high" });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "open" } });
    expect(onChange).toHaveBeenLastCalledWith({ severity: "high", status: "open" });
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("filters to findings with an unreviewed occurrence, and back", () => {
    const { onChange, rerender } = renderFilters();
    fireEvent.click(screen.getByLabelText("Only findings with an unreviewed occurrence"));
    expect(onChange).toHaveBeenLastCalledWith({ unreviewed: true });
    rerender(<FindingFilters value={{ unreviewed: true }} onChange={onChange} categories={CATEGORIES} counts={list.counts} total={list.total} />);
    expect(screen.getByLabelText("Only findings with an unreviewed occurrence")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Only findings with an unreviewed occurrence"));
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("applies the operation when submitted, trimmed", () => {
    const { onChange } = renderFilters();
    fireEvent.change(screen.getByLabelText(/Operation/), { target: { value: " GET /orders " } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith({ operation: "GET /orders" });
  });

  it("counts findings and occurrences apart, so occurrences are never read as findings", () => {
    renderFilters();
    const counts = screen.getByTestId("finding-counts");
    expect(counts).toHaveTextContent("2 findings match.");
    expect(counts).toHaveTextContent("Occurrences are counted separately: 4 in all, and 1 finding has one not yet reviewed.");
  });

  it("clears every filter, and is disabled when none is applied", () => {
    const first = renderFilters();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeDisabled();
    first.unmount();
    const { onChange } = renderFilters({ severity: "high", unreviewed: true });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters (2)" }));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("resets the operation field when the filter is cleared elsewhere", () => {
    function Harness() {
      const [value, setValue] = useState<FindingFilterQuery>({ operation: "GET /orders" });
      return (
        <>
          <FindingFilters value={value} onChange={setValue} categories={CATEGORIES} counts={list.counts} total={list.total} />
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByLabelText(/Operation/)).toHaveValue("GET /orders");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters (1)" }));
    expect(screen.getByLabelText(/Operation/)).toHaveValue("");
  });
});

describe("FindingsList (T122, FR-054 to FR-058)", () => {
  function renderList(items = [finding()], overrides: Partial<React.ComponentProps<typeof FindingsList>> = {}) {
    const onSelect = vi.fn();
    const onPageChange = vi.fn();
    render(
      <FindingsList
        items={items}
        total={items.length}
        page={1}
        pageSize={25}
        onPageChange={onPageChange}
        onPageSizeChange={vi.fn()}
        selectedId={null}
        onSelect={onSelect}
        categoryNames={NAMES}
        filtered={false}
        onClearFilters={vi.fn()}
        {...overrides}
      />,
    );
    return { onSelect, onPageChange };
  }

  it("renders a semantic table with severity and status as text badges", () => {
    renderList([finding({ severity: { suggested: "high", current: "critical" }, status: "accepted-risk" })]);
    const table = screen.getByRole("table", { name: /Security findings/ });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Finding", "Severity", "Status", "Occurrences", "Scenario version"]);
    const row = screen.getByTestId("finding-row");
    expect(within(row).getByText("Critical")).toBeInTheDocument();
    expect(within(row).getByText("Accepted risk")).toBeInTheDocument();
    expect(within(row).getByText("Suggested high")).toBeInTheDocument();
    expect(within(row).getByText("Version 1")).toBeInTheDocument();
    expect(within(row).getByLabelText("HTTP method GET")).toBeInTheDocument();
  });

  it("shows the number of occurrences beside each finding, as text, and never adds them to the finding count", () => {
    renderList([finding({ id: "a", occurrences: [findingOccurrence(), findingOccurrence({ resultId: "r2" }), findingOccurrence({ resultId: "r3" })] }), finding({ id: "b" })]);
    const rows = screen.getAllByTestId("finding-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("3 occurrences")).toBeInTheDocument();
    expect(within(rows[1]).getByText("1 occurrence")).toBeInTheDocument();
    expect(screen.getByText("Showing 1–2 of 2 findings")).toBeInTheDocument();
  });

  it("marks a finding that has an unreviewed occurrence with text", () => {
    renderList([finding({ id: "a", unreviewedOccurrence: true }), finding({ id: "b" })]);
    const [flagged, plain] = screen.getAllByTestId("finding-row");
    expect(within(flagged).getByText("Unreviewed occurrence")).toBeInTheDocument();
    expect(within(plain).queryByText("Unreviewed occurrence")).not.toBeInTheDocument();
  });

  it("opens a finding from its name with a button that takes focus, and marks the open one", () => {
    const { onSelect } = renderList([finding({ id: "a" }), finding({ id: "b", operationKey: "POST /orders" })], { selectedId: "b" });
    const first = screen.getByRole("button", { name: "GET /orders: Authentication" });
    first.focus();
    expect(first).toHaveFocus();
    fireEvent.click(first);
    expect(onSelect).toHaveBeenCalledWith("a");
    expect(screen.getByRole("button", { name: "POST /orders: Authentication" })).toHaveAttribute("aria-current", "true");
  });

  it("says there are no findings, and that this is not proof of safety, as an empty state", () => {
    renderList([], { total: 0 });
    expect(screen.getByTestId("finding-list-empty")).toHaveTextContent("There are no findings.");
    expect(screen.getByTestId("finding-list-empty")).toHaveTextContent("No finding is not proof of safety.");
  });

  it("says nothing matches the filters, distinct from there being no findings, and offers to clear them", () => {
    const onClearFilters = vi.fn();
    renderList([], { total: 0, filtered: true, onClearFilters });
    expect(screen.getByTestId("finding-list-empty")).toHaveTextContent("No findings match these filters.");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it("pages with the shared pagination", () => {
    const { onPageChange } = renderList([finding()], { total: 60 });
    expect(screen.getByText("Showing 1–25 of 60 findings")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
