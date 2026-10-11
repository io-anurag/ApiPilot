import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CoverageSnapshot } from "@apipilot/shared-domain";
import { CoveragePage } from "../../../src/pages/CoveragePage";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { fetchCoverage, type CoverageResult } from "../../../src/services/coverageClient";
import { metric, snapshot } from "./coverageFixtures";

vi.mock("../../../src/services/coverageClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/coverageClient")>()),
  fetchCoverage: vi.fn(),
}));

const fetchMock = vi.mocked(fetchCoverage);
const ok = (data: CoverageSnapshot = snapshot()): CoverageResult => ({ ok: true, snapshot: data });
const lastQuery = () => fetchMock.mock.calls.at(-1)?.[0] ?? {};

function renderPage(onOpenWorkflow = vi.fn(), active = "coverage") {
  return {
    onOpenWorkflow,
    ...render(
      <ActiveViewContext.Provider value={active}>
        <CoveragePage onOpenWorkflow={onOpenWorkflow} />
      </ActiveViewContext.Provider>,
    ),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CoveragePage: states", () => {
  it("shows a status and skeletons while the first calculation is loading", () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByRole("status", { name: "Calculating coverage" })).toBeInTheDocument();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "API Test Coverage" })).toBeInTheDocument();
  });

  it("does not load while the view is hidden, and loads when it becomes active", async () => {
    fetchMock.mockResolvedValue(ok());
    const { rerender, onOpenWorkflow } = renderPage(vi.fn(), "guided-workflow");
    expect(fetchMock).not.toHaveBeenCalled();
    rerender(
      <ActiveViewContext.Provider value="coverage">
        <CoveragePage onOpenWorkflow={onOpenWorkflow} />
      </ActiveViewContext.Provider>,
    );
    await screen.findByTestId("spec-metrics");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("explains a missing specification with a recovery action, not as zero coverage", async () => {
    fetchMock.mockResolvedValue({ ok: false, error: "no_active_workflow", message: "There is no active specification." });
    const { onOpenWorkflow } = renderPage();
    expect(await screen.findByTestId("coverage-no-workflow")).toHaveTextContent("No active specification");
    expect(screen.queryByTestId("spec-metrics")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to the specification step" }));
    expect(onOpenWorkflow).toHaveBeenCalledWith("guided-workflow");
  });

  it("shows a failure as an error with a retry, never as empty coverage", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, error: "network_error", message: "The coverage service is unreachable." });
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Coverage is unavailable");
    expect(alert).toHaveTextContent("This is not an empty result.");
    expect(screen.queryByTestId("spec-metrics")).not.toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(ok());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("spec-metrics")).toBeInTheDocument();
  });

  it("keeps the previous figures and reports a failed recalculation", async () => {
    fetchMock.mockResolvedValueOnce(ok());
    renderPage();
    await screen.findByTestId("spec-metrics");
    fetchMock.mockResolvedValueOnce({ ok: false, error: "network_error", message: "Offline." });
    fireEvent.click(screen.getByRole("button", { name: "Recalculate" }));
    expect(await screen.findByText(/Out-of-date snapshot: the latest recalculation failed/)).toBeInTheDocument();
    expect(screen.getByTestId("coverage-error")).toHaveTextContent("snapshot calculated at 2026-10-10 12:00 UTC");
    expect(screen.getByTestId("spec-metrics")).toBeInTheDocument();
  });
});

describe("CoveragePage: content", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(ok());
  });

  it("shows the specification, revision, run context and last qualifying execution", async () => {
    renderPage();
    const context = await screen.findByTestId("coverage-context");
    expect(context).toHaveTextContent("Orders API v1.0.0");
    expect(context).toHaveTextContent("9f3a1c0123");
    expect(context).toHaveTextContent("Orders collection (local)");
    expect(context).toHaveTextContent("2026-10-10 11:00 UTC");
    expect(context).toHaveTextContent("26 accepted, 3 pending");
    expect(context).toHaveTextContent("1 rejected, not counted");
  });

  it("shows the evidence notice and the specific explanation notices", async () => {
    renderPage();
    const notices = await screen.findByTestId("coverage-notices");
    expect(notices).toHaveTextContent(
      "Generated scenarios contribute to specification coverage. Runtime-verified coverage requires qualifying execution evidence.",
    );
    expect(notices).toHaveTextContent("Attention: 2 results came from requests edited before the run");
  });

  it("keeps specification and runtime coverage in separate groups with numerator, denominator and percentage", async () => {
    renderPage();
    const spec = await screen.findByTestId("spec-metrics");
    const runtime = screen.getByTestId("runtime-metrics");
    const ops = within(spec).getByText("Operations").closest("[data-testid='metric-tile']") as HTMLElement;
    expect(ops).toHaveTextContent("4 / 4");
    expect(within(ops).getByTestId("metric-percentage")).toHaveTextContent("100%");
    const verified = within(runtime).getByText("Operations with passing verification").closest("[data-testid='metric-tile']") as HTMLElement;
    expect(verified).toHaveTextContent("3 / 4");
    expect(within(verified).getByTestId("metric-percentage")).toHaveTextContent("75%");
    expect(within(runtime).queryByText("Request schemas")).not.toBeInTheDocument();
    expect(within(runtime).getByText("Last qualifying execution")).toBeInTheDocument();
    expect(within(spec).queryByText("Operations with passing verification")).not.toBeInTheDocument();
  });

  it("offers no overall coverage score", async () => {
    renderPage();
    await screen.findByTestId("spec-metrics");
    expect(screen.queryByText(/overall/i)).not.toBeInTheDocument();
  });

  it("renders an unavailable percentage as text, never NaN", async () => {
    fetchMock.mockResolvedValue(
      ok(snapshot({ metrics: [metric("spec-operations", "specification", "Operations", 0, 0), metric("runtime-operations", "runtime", "Operations with passing verification", 0, 0)] })),
    );
    renderPage();
    const tile = (await screen.findByText("Operations", { selector: "dt" })).closest("[data-testid='metric-tile']") as HTMLElement;
    expect(within(tile).getByTestId("metric-percentage")).toHaveTextContent("not available");
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("draws a breakdown per requirement kind with exact counts and an accessible label", async () => {
    renderPage();
    const params = (await screen.findAllByTestId("breakdown")).find((el) => el.dataset.breakdown === "Parameters") as HTMLElement;
    expect(within(params).getByRole("img")).toHaveAccessibleName(
      "Parameters: 1 verified, 0 executed, failed, 0 inconclusive, 0 stale: re-run required, 0 generated, not executed, 0 not covered, of 1",
    );
    expect(params).toHaveTextContent("Verified1");
  });

  it("lists operations out of scope and what cannot be measured, with reasons", async () => {
    renderPage();
    expect(await screen.findByTestId("out-of-scope")).toHaveTextContent("GET /health");
    expect(screen.getByTestId("not-measurable")).toHaveTextContent("cookie parameter");
    expect(screen.getByText(/Security and authorization:/)).toBeInTheDocument();
  });

  it("shows ranked recommendations with requirement, why, evidence, rationale and an action", async () => {
    renderPage();
    const items = await screen.findAllByTestId("recommendation");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Requirement: DELETE /orders/{id} (+3 more)");
    expect(items[0]).toHaveTextContent("Evidence: No execution evidence for this gap yet.");
    expect(items[0]).toHaveTextContent("Priority rationale: state +3, kind +2, method +3 = 8 (heuristic)");
    expect(within(items[0]).getByRole("button", { name: "Go to scenario generation" })).toBeInTheDocument();
    expect(items[1]).toHaveTextContent("failed in run run-2");
    expect(within(items[1]).getByRole("button", { name: "Open failing result" })).toBeInTheDocument();
  });
});

describe("CoveragePage: table, filters and sorting", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(ok());
  });

  it("lists each operation with its fractions, state texts, missing items and priority", async () => {
    renderPage();
    const rows = await screen.findAllByTestId("gap-row");
    expect(rows).toHaveLength(4);
    const post = rows.find((r) => r.dataset.operation === "POST /orders") as HTMLElement;
    expect(post).toHaveTextContent("3 / 4");
    expect(post).toHaveTextContent("Executed, failed");
    expect(post).toHaveTextContent("1 of 3 documented responses have no generated scenario.");
    expect(within(post).getByText("High")).toBeInTheDocument();
    expect(within(post).getByTestId("http-method-badge")).toHaveTextContent("POST");
  });

  it("requests a filtered view from the server and shows how many operations are in view", async () => {
    renderPage();
    await screen.findByTestId("gaps-table");
    fetchMock.mockResolvedValue(ok(snapshot({ operations: snapshot().operations.slice(0, 1) })));
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "POST" } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ methods: ["POST"] }));
    expect(await screen.findByText(/Showing 1 of 4 operations/)).toBeInTheDocument();
  });

  it("sends each filter to the server", async () => {
    renderPage();
    await screen.findByTestId("gaps-table");
    fireEvent.change(screen.getByLabelText("Requirement state"), { target: { value: "executed-failed" } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ states: ["executed-failed"] }));
    fireEvent.change(screen.getByLabelText("Scenario category"), { target: { value: "boundary" } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ category: "boundary" }));
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "high" } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ priorities: ["high"] }));
    fireEvent.change(screen.getByLabelText("Gap type"), { target: { value: "failed" } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ gapKind: "failed" }));
  });

  it("debounces the endpoint text filter", async () => {
    renderPage();
    await screen.findByTestId("gaps-table");
    const before = fetchMock.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Endpoint"), { target: { value: "ord" } });
    fireEvent.change(screen.getByLabelText("Endpoint"), { target: { value: "orders" } });
    expect(fetchMock.mock.calls.length).toBe(before);
    await waitFor(() => expect(lastQuery()).toMatchObject({ q: "orders" }));
    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });

  it("disables the security category because it is unavailable", async () => {
    renderPage();
    await screen.findByTestId("gaps-table");
    expect(screen.getByRole("option", { name: "Security (unavailable)" })).toBeDisabled();
  });

  it("sorts by a column, toggling direction, and exposes the order to assistive technology", async () => {
    renderPage();
    await screen.findByTestId("gaps-table");
    const method = screen.getByRole("columnheader", { name: /Method/ });
    expect(method).toHaveAttribute("aria-sort", "none");
    fireEvent.click(screen.getByRole("button", { name: /Method/ }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ sort: "method", order: "asc" }));
    expect(screen.getByRole("columnheader", { name: /Method/ })).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(screen.getByRole("button", { name: /Method/ }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ sort: "method", order: "desc" }));
    expect(screen.getByRole("columnheader", { name: /Method/ })).toHaveAttribute("aria-sort", "descending");
  });

  it("shows an empty-filter state with a reset that restores the unfiltered request", async () => {
    renderPage();
    await screen.findByTestId("gaps-table");
    fetchMock.mockResolvedValue(ok(snapshot({ operations: [], gaps: [], recommendations: [] })));
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "PATCH" } });
    expect(await screen.findByTestId("gaps-empty")).toHaveTextContent("No operations match these filters.");
    fetchMock.mockResolvedValue(ok());
    fireEvent.click(screen.getAllByRole("button", { name: "Reset filters" })[0]);
    await waitFor(() => expect(lastQuery().methods).toBeUndefined());
    expect(await screen.findByTestId("gaps-table")).toBeInTheDocument();
  });

  it("says so when the specification has no eligible operations", async () => {
    fetchMock.mockResolvedValue(ok(snapshot({ operations: [], gaps: [], recommendations: [], totals: { operations: 0, gaps: 0 } })));
    renderPage();
    expect(await screen.findByTestId("gaps-empty")).toHaveTextContent("This specification has no eligible operations.");
  });

  it("paginates a long operation list", async () => {
    const many = Array.from({ length: 12 }, (_, i) => snapshot().operations[1] && { ...snapshot().operations[1], operationKey: `GET /r${i}`, path: `/r${i}` });
    fetchMock.mockResolvedValue(ok(snapshot({ operations: many, totals: { operations: 12, gaps: 3 } })));
    renderPage();
    expect(await screen.findAllByTestId("gap-row")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getAllByTestId("gap-row")).toHaveLength(2);
  });
});

describe("CoveragePage: runs, export and navigation", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(ok());
  });

  it("evaluates a selected run and returns to the latest qualifying result", async () => {
    renderPage();
    const select = await screen.findByLabelText("Evaluate run");
    expect(within(select).getAllByRole("option")).toHaveLength(3);
    fireEvent.change(select, { target: { value: "run-1" } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ runId: "run-1" }));
    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => expect(lastQuery().runId).toBeUndefined());
  });

  it("links exports to the current view and to the whole specification", async () => {
    renderPage();
    await screen.findByTestId("gaps-table");
    fetchMock.mockResolvedValue(ok());
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "GET" } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ methods: ["GET"] }));
    const view = screen.getByRole("link", { name: "Export this view (HTML)" });
    expect(view.getAttribute("href")).toContain("/api/coverage/export?");
    expect(view.getAttribute("href")).toContain("method=GET");
    expect(view.getAttribute("href")).toContain("format=html");
    expect(view.getAttribute("href")).toContain("scope=filtered");
    const all = screen.getByRole("link", { name: "Export all (JSON)" });
    expect(all.getAttribute("href")).toContain("format=json");
    expect(all.getAttribute("href")).toContain("scope=all");
  });

  it("recalculates on request", async () => {
    renderPage();
    await screen.findByTestId("gaps-table");
    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Recalculate" }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(before + 1));
  });

  it("navigates to the execution workflow and from rows to scenarios and results", async () => {
    const { onOpenWorkflow } = renderPage();
    await screen.findByTestId("gaps-table");
    fireEvent.click(screen.getByRole("button", { name: "Go to Import & Run" }));
    expect(onOpenWorkflow).toHaveBeenLastCalledWith("import-collection");
    const post = screen.getAllByTestId("gap-row").find((r) => r.dataset.operation === "POST /orders") as HTMLElement;
    fireEvent.click(within(post).getByRole("button", { name: "Open scenarios" }));
    expect(onOpenWorkflow).toHaveBeenLastCalledWith("guided-workflow");
    fireEvent.click(within(post).getByRole("button", { name: "Open failing result" }));
    expect(onOpenWorkflow).toHaveBeenLastCalledWith("import-collection");
  });
});
