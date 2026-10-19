import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { ScenarioFilters } from "../../../src/components/securityLab/ScenarioFilters";
import { ScenarioList } from "../../../src/components/securityLab/ScenarioList";
import { ScopeBanner } from "../../../src/components/securityLab/ScopeBanner";
import * as client from "../../../src/services/securityLabClient";
import { CATEGORIES, NO_FLAGS, scenarioItem, scenarioList } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  fetchScope: vi.fn(),
  generateScenarios: vi.fn(),
}));

const fetchScope = vi.mocked(client.fetchScope);
const generateScenarios = vi.mocked(client.generateScenarios);

function renderActive(ui: ReactElement) {
  return render(<ActiveViewContext.Provider value="security">{ui}</ActiveViewContext.Provider>);
}

beforeEach(() => {
  fetchScope.mockReset();
  generateScenarios.mockReset();
});

describe("ScenarioFilters (T075, FR-032)", () => {
  const counts = scenarioList([scenarioItem({ id: "a" }), scenarioItem({ id: "b", reviewState: "approved", severity: "low" })]).counts;

  function renderFilters(value: client.ScenarioFilterQuery = {}) {
    const onChange = vi.fn();
    const view = render(<ScenarioFilters value={value} onChange={onChange} categories={CATEGORIES} counts={counts} />);
    return { onChange, ...view };
  }

  it("offers every filter as a labelled control", () => {
    renderFilters();
    for (const label of ["Search title, operation or id", "Operation (exact, such as GET /orders)", "Category", "Severity", "Review state", "Execution status", "Flag"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("search", { name: "Search scenarios" })).toBeInTheDocument();
  });

  it("offers only categories scenarios can be generated for", () => {
    renderFilters();
    const options = within(screen.getByLabelText("Category")).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Any", "Authentication", "Input validation"]);
  });

  it("applies a select at once and removes the filter when set back to Any", () => {
    const { onChange, rerender } = renderFilters({ severity: "high", q: "orders" });
    fireEvent.change(screen.getByLabelText("Review state"), { target: { value: "approved" } });
    expect(onChange).toHaveBeenLastCalledWith({ severity: "high", q: "orders", reviewState: "approved" });
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ q: "orders" });
    fireEvent.change(screen.getByLabelText("Flag"), { target: { value: "specification_not_loaded" } });
    expect(onChange).toHaveBeenLastCalledWith({ severity: "high", q: "orders", flag: "specification_not_loaded" });
    rerender(<ScenarioFilters value={{ severity: "high" }} onChange={onChange} categories={CATEGORIES} counts={counts} />);
    expect(screen.getByLabelText("Severity")).toHaveValue("high");
  });

  it("applies the search and the operation only when submitted, trimmed, and not on each keystroke", () => {
    const { onChange } = renderFilters();
    fireEvent.change(screen.getByLabelText("Search title, operation or id"), { target: { value: "  orders  " } });
    fireEvent.change(screen.getByLabelText("Operation (exact, such as GET /orders)"), { target: { value: "GET /orders" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onChange).toHaveBeenCalledWith({ q: "orders", operation: "GET /orders" });
  });

  it("shows the counts for the matching scenarios as text", () => {
    renderFilters();
    expect(screen.getByText(/Draft 1, Approved 1/)).toBeInTheDocument();
    expect(screen.getByText(/Not run 2/)).toBeInTheDocument();
    expect(screen.getByText(/Low 1, High 1/)).toBeInTheDocument();
  });

  it("disables Clear filters when none is applied, and clears every filter otherwise", () => {
    const first = renderFilters();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeDisabled();
    first.unmount();
    const { onChange } = renderFilters({ severity: "high", q: "x" });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters (2)" }));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("shows a filter that was cleared elsewhere as empty in the text fields", () => {
    const { rerender, onChange } = renderFilters({ q: "orders", operation: "GET /orders" });
    expect(screen.getByLabelText("Search title, operation or id")).toHaveValue("orders");
    rerender(<ScenarioFilters value={{}} onChange={onChange} categories={CATEGORIES} counts={counts} />);
    expect(screen.getByLabelText("Search title, operation or id")).toHaveValue("");
    expect(screen.getByLabelText("Operation (exact, such as GET /orders)")).toHaveValue("");
  });
});

describe("ScenarioList (T075, FR-004, FR-032)", () => {
  const names = { authentication: "Authentication", "input-validation": "Input validation" };

  function renderList(items = [scenarioItem()], overrides: Partial<React.ComponentProps<typeof ScenarioList>> = {}) {
    const onSelect = vi.fn();
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    render(
      <ScenarioList
        items={items}
        total={items.length}
        page={1}
        pageSize={25}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        selectedId={null}
        onSelect={onSelect}
        categoryNames={names}
        filtered={false}
        onClearFilters={vi.fn()}
        {...overrides}
      />,
    );
    return { onSelect, onPageChange, onPageSizeChange };
  }

  it("renders a semantic table whose rows state severity, review state and execution status as text", () => {
    renderList([scenarioItem({ severity: "critical", reviewState: "in_review", executionStatus: "evaluated" })]);
    const table = screen.getByRole("table", { name: /Security scenarios/ });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Scenario",
      "Operation",
      "Category",
      "Severity",
      "Review state",
      "Execution",
      "Flags",
    ]);
    const row = screen.getByTestId("scenario-row");
    for (const text of ["Critical", "In review", "Evaluated", "Authentication", "/orders"]) expect(within(row).getByText(text)).toBeInTheDocument();
    expect(within(row).getByLabelText("HTTP method GET")).toBeInTheDocument();
  });

  it("opens a scenario from its title with a button, reachable and operable by keyboard", () => {
    const { onSelect } = renderList([scenarioItem({ id: "a", title: "First" }), scenarioItem({ id: "b", title: "Second" })], { selectedId: "b" });
    const first = screen.getByRole("button", { name: "First" });
    first.focus();
    expect(first).toHaveFocus();
    fireEvent.click(first);
    expect(onSelect).toHaveBeenCalledWith("a");
    expect(screen.getByRole("button", { name: "Second" })).toHaveAttribute("aria-current", "true");
    expect(first).not.toHaveAttribute("aria-current");
  });

  it("marks a destructive scenario and each flag with text, never colour alone", () => {
    renderList([
      scenarioItem({ id: "d", title: "Delete orders", destructive: true, flags: { ...NO_FLAGS, stale: true, blocked: true } }),
      scenarioItem({ id: "o", title: "Orphan", flags: { ...NO_FLAGS, orphaned: true } }),
    ]);
    const destructive = screen.getByText("Delete orders").closest("tr") as HTMLElement;
    expect(within(destructive).getByText("Destructive")).toBeInTheDocument();
    expect(within(destructive).getByText("Stale")).toBeInTheDocument();
    expect(within(destructive).getByText("Blocked")).toBeInTheDocument();
    const orphan = screen.getByText("Orphan").closest("tr") as HTMLElement;
    expect(within(orphan).getByText("Orphaned")).toBeInTheDocument();
    expect(within(orphan).queryByText("Destructive")).not.toBeInTheDocument();
  });

  it("explains every flag in words in a legend", () => {
    renderList();
    const legend = screen.getByTestId("flag-legend");
    expect(legend).toHaveTextContent("Stale: The operation changed since this scenario was generated.");
    expect(legend).toHaveTextContent("Orphaned: The operation this scenario tests is no longer in the loaded specification.");
    expect(legend).toHaveTextContent("Specification not loaded: No specification is loaded");
    expect(legend).toHaveTextContent("Blocked: At least one prerequisite is not met.");
  });

  it("lists retained scenarios flagged specification not loaded when no specification is loaded", () => {
    renderList([scenarioItem({ flags: { ...NO_FLAGS, specificationNotLoaded: true } })]);
    expect(within(screen.getByTestId("scenario-row")).getByText("Specification not loaded")).toBeInTheDocument();
    expect(within(screen.getByTestId("scenario-row")).queryByText("Stale")).not.toBeInTheDocument();
  });

  it("says no scenario exists yet, distinct from no match for the filters", () => {
    renderList([], { total: 0 });
    expect(screen.getByTestId("scenario-list-empty")).toHaveTextContent("There are no scenarios yet.");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("says nothing matches the filters, that nothing is lost, and offers to clear them", () => {
    const onClearFilters = vi.fn();
    renderList([], { total: 0, filtered: true, onClearFilters });
    expect(screen.getByTestId("scenario-list-empty")).toHaveTextContent("No scenarios match these filters.");
    expect(screen.getByTestId("scenario-list-empty")).toHaveTextContent("Nothing is hidden or lost");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it("pages with the shared pagination and reports the total", () => {
    const { onPageChange, onPageSizeChange } = renderList([scenarioItem({ id: "a" }), scenarioItem({ id: "b", title: "Second" })], { total: 60, pageSize: 25 });
    expect(screen.getByText("Showing 1–25 of 60 scenarios")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
    fireEvent.change(screen.getByLabelText("Per page"), { target: { value: "50" } });
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });
});

describe("ScopeBanner (T075, FR-004, FR-018)", () => {
  const reply = { scope: { mode: "selection" as const, included: 1, excluded: 8 }, created: 4, kept: 2, newVersions: 1, rejected: [], omittedByCap: [], notes: [] };

  it("states the guided selection as the scope", async () => {
    fetchScope.mockResolvedValue({ ok: true, data: { mode: "selection", selectedCount: 1, totalCount: 9 } });
    renderActive(<ScopeBanner categories={CATEGORIES} onGenerated={vi.fn()} />);
    expect(await screen.findByTestId("scope-text")).toHaveTextContent("Generation covers your Guided Workflow selection: 1 of 9 operations.");
  });

  it("states that every operation is covered when no selection was made", async () => {
    fetchScope.mockResolvedValue({ ok: true, data: { mode: "all", selectedCount: 9, totalCount: 9 } });
    renderActive(<ScopeBanner categories={CATEGORIES} onGenerated={vi.fn()} />);
    expect(await screen.findByTestId("scope-text")).toHaveTextContent("Generation covers all 9 operations: no selection was made in the Guided Workflow.");
  });

  it("generates for the scope shown, reports what happened as text and asks for the list to be read again", async () => {
    fetchScope.mockResolvedValue({ ok: true, data: { mode: "selection", selectedCount: 1, totalCount: 9 } });
    generateScenarios.mockResolvedValue({ ok: true, data: reply });
    const onGenerated = vi.fn();
    renderActive(<ScopeBanner categories={CATEGORIES} onGenerated={onGenerated} />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate scenarios" }));
    const summary = await screen.findByRole("status");
    expect(summary).toHaveTextContent("Generated for 1 operation (8 left out): 4 created, 2 kept unchanged, 1 new version.");
    expect(generateScenarios).toHaveBeenCalledWith({ scope: { mode: "selection" } });
    expect(onGenerated).toHaveBeenCalledTimes(1);
  });

  it("offers to widen a narrower selection to every operation, and generates for all of them (FR-018)", async () => {
    fetchScope.mockResolvedValue({ ok: true, data: { mode: "selection", selectedCount: 1, totalCount: 9 } });
    generateScenarios.mockResolvedValue({ ok: true, data: { ...reply, scope: { mode: "all", included: 9, excluded: 0 } } });
    const onGenerated = vi.fn();
    renderActive(<ScopeBanner categories={CATEGORIES} onGenerated={onGenerated} />);
    fireEvent.click(await screen.findByRole("button", { name: "Widen to all 9 operations and generate" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Generated for 9 operations (0 left out)");
    expect(generateScenarios).toHaveBeenCalledWith({ scope: { mode: "all" } });
    expect(onGenerated).toHaveBeenCalledTimes(1);
  });

  it("offers no widening when the scope already covers every operation, or the selection is all of them", async () => {
    fetchScope.mockResolvedValue({ ok: true, data: { mode: "all", selectedCount: 9, totalCount: 9 } });
    const { unmount } = renderActive(<ScopeBanner categories={CATEGORIES} onGenerated={vi.fn()} />);
    await screen.findByTestId("scope-text");
    expect(screen.queryByRole("button", { name: /Widen to all/ })).not.toBeInTheDocument();
    unmount();

    fetchScope.mockResolvedValue({ ok: true, data: { mode: "selection", selectedCount: 9, totalCount: 9 } });
    renderActive(<ScopeBanner categories={CATEGORIES} onGenerated={vi.fn()} />);
    await screen.findByTestId("scope-text");
    expect(screen.queryByRole("button", { name: /Widen to all/ })).not.toBeInTheDocument();
  });

  it("limits generation to the ticked categories, and to all when none is ticked", async () => {
    fetchScope.mockResolvedValue({ ok: true, data: { mode: "all", selectedCount: 9, totalCount: 9 } });
    generateScenarios.mockResolvedValue({ ok: true, data: reply });
    renderActive(<ScopeBanner categories={CATEGORIES} onGenerated={vi.fn()} />);
    const group = await screen.findByRole("group", { name: /Limit to categories/ });
    // Categories that cannot generate scenarios are not offered.
    expect(within(group).getAllByRole("checkbox").map((box) => (box as HTMLInputElement).labels?.[0]?.textContent)).toEqual(["Authentication", "Input validation"]);
    fireEvent.click(within(group).getByLabelText("Input validation"));
    fireEvent.click(screen.getByRole("button", { name: "Generate scenarios" }));
    await waitFor(() => expect(generateScenarios).toHaveBeenCalledWith({ scope: { mode: "all" }, categories: ["input-validation"] }));
  });

  it("lists what was rejected, left out for the limit and noted", async () => {
    fetchScope.mockResolvedValue({ ok: true, data: { mode: "all", selectedCount: 9, totalCount: 9 } });
    generateScenarios.mockResolvedValue({
      ok: true,
      data: {
        ...reply,
        rejected: [{ operationKey: "POST /orders", categoryId: "input-validation", violations: [{ pointer: "/x", code: "c", message: "The request count is unbounded." }] }],
        omittedByCap: [{ operationKey: "GET /orders", categoryId: "input-validation", omitted: 3 }],
        notes: [{ categoryId: "authentication", operationKey: "GET /public", reason: "The operation is public by declaration." }],
      },
    });
    renderActive(<ScopeBanner categories={CATEGORIES} onGenerated={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate scenarios" }));
    const summary = await screen.findByTestId("generation-summary");
    expect(summary).toHaveTextContent("Not stored because they were invalid (1)");
    expect(summary).toHaveTextContent("The request count is unbounded.");
    expect(summary).toHaveTextContent("3 for GET /orders, input-validation");
    expect(summary).toHaveTextContent("The operation is public by declaration.");
  });

  it("shows a refused generation as an error, not as a result, and does not refresh the list", async () => {
    fetchScope.mockResolvedValue({ ok: true, data: { mode: "all", selectedCount: 9, totalCount: 9 } });
    generateScenarios.mockResolvedValue({ ok: false, error: "retention_limit_reached", message: "Generating would exceed the limit of 5 retained scenarios.", status: 409, details: {} });
    const onGenerated = vi.fn();
    renderActive(<ScopeBanner categories={CATEGORIES} onGenerated={onGenerated} />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate scenarios" }));
    expect(await screen.findByTestId("generation-error")).toHaveTextContent("Generating would exceed the limit of 5 retained scenarios.");
    expect(screen.queryByTestId("generation-summary")).not.toBeInTheDocument();
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it("with no specification loaded, disables generation with the reason and the way to proceed instead of failing", async () => {
    fetchScope.mockResolvedValue({ ok: false, error: "no_specification", message: "No specification is loaded.", status: 409, details: {} });
    renderActive(<ScopeBanner categories={CATEGORIES} onGenerated={vi.fn()} />);
    const banner = await screen.findByTestId("scope-no-specification");
    expect(banner).toHaveTextContent("Generation is unavailable: no specification is loaded");
    expect(banner).toHaveTextContent("Upload one in the Guided Workflow");
    expect(banner).toHaveTextContent("stay readable");
    const button = screen.getByRole("button", { name: "Generate scenarios" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/Upload one in the Guided Workflow/);
    fireEvent.click(button);
    expect(generateScenarios).not.toHaveBeenCalled();
  });

  it("distinguishes loading from an unreadable scope, and offers a retry for the latter", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof client.fetchScope>>) => void;
    fetchScope.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderActive(<ScopeBanner categories={CATEGORIES} onGenerated={vi.fn()} />);
    expect(screen.getByRole("status", { name: "Reading the generation scope" })).toBeInTheDocument();
    resolve({ ok: false, error: "network_error", message: "The Security Lab service is unreachable.", status: 0, details: {} });
    expect(await screen.findByTestId("scope-error")).toHaveTextContent("The Security Lab service is unreachable.");
    fetchScope.mockResolvedValueOnce({ ok: true, data: { mode: "all", selectedCount: 3, totalCount: 3 } });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("scope-text")).toHaveTextContent("all 3 operations");
  });
});
