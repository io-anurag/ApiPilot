import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { ExecutionArea } from "../../../src/components/securityLab/ExecutionArea";
import type { SecurityLabIntent } from "../../../src/components/securityLab/navigationIntent";
import * as client from "../../../src/services/securityLabClient";
import { categoriesReply, finding, findingList, findingOccurrence, profileView, runDetail, runView, scenarioResult, targetEnvironment } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  listProfiles: vi.fn(),
  listEnvironments: vi.fn(),
  fetchCategories: vi.fn(),
  listRuns: vi.fn(),
  listAllScenarios: vi.fn(),
  listFindings: vi.fn(),
  fetchFinding: vi.fn(),
  patchFinding: vi.fn(),
  fetchRun: vi.fn(),
}));

const m = {
  listProfiles: vi.mocked(client.listProfiles),
  listEnvironments: vi.mocked(client.listEnvironments),
  fetchCategories: vi.mocked(client.fetchCategories),
  listRuns: vi.mocked(client.listRuns),
  listAllScenarios: vi.mocked(client.listAllScenarios),
  listFindings: vi.mocked(client.listFindings),
  fetchFinding: vi.mocked(client.fetchFinding),
  patchFinding: vi.mocked(client.patchFinding),
  fetchRun: vi.mocked(client.fetchRun),
};

const OPEN = finding({ id: "sf-1", scenarioId: "ss-1", scenarioVersion: 1, occurrences: [findingOccurrence({ runId: "run-1" }), findingOccurrence({ resultId: "r2", runId: "run-1" })] });
const OTHER = finding({ id: "sf-2", scenarioId: "ss-2", operationKey: "POST /orders", status: "accepted-risk", unreviewedOccurrence: true });

function serve() {
  m.listProfiles.mockResolvedValue({ ok: true, data: { profiles: [profileView()] } });
  m.listEnvironments.mockResolvedValue({ ok: true, data: { environments: [targetEnvironment()] } });
  m.fetchCategories.mockResolvedValue({ ok: true, data: categoriesReply });
  m.listRuns.mockResolvedValue({ ok: true, data: { runs: [runView({ id: "run-1", status: "completed" })] } });
  m.listAllScenarios.mockResolvedValue({ ok: true, data: [] });
  m.listFindings.mockImplementation(async (filters) => {
    if (filters.scenario === "ss-1") return { ok: true, data: findingList([OPEN]) };
    if (filters.scenario === "ss-3") return { ok: true, data: findingList([]) };
    return { ok: true, data: findingList([OPEN, OTHER]) };
  });
  m.fetchFinding.mockImplementation(async (id) => ({ ok: true, data: id === "sf-2" ? OTHER : OPEN }));
  m.fetchRun.mockResolvedValue({
    ok: true,
    data: runDetail({
      run: { id: "run-1", status: "completed", plan: [{ scenarioId: "ss-1", version: 1, plannedRequests: 1 }, { scenarioId: "ss-2", version: 1, plannedRequests: 1 }, { scenarioId: "ss-3", version: 1, plannedRequests: 1 }] },
      results: [
        scenarioResult({ id: "res-1", scenarioId: "ss-1", outcome: "failed" }),
        scenarioResult({ id: "res-2", scenarioId: "ss-2", outcome: "passed" }),
        scenarioResult({ id: "res-3", scenarioId: "ss-3", outcome: "failed" }),
      ],
    }),
  });
}

function renderArea(props: { intent?: SecurityLabIntent | null; onNavigate?: (intent: SecurityLabIntent) => void } = {}) {
  return render(
    <ActiveViewContext.Provider value="security">
      <ExecutionArea {...props} />
    </ActiveViewContext.Provider>,
  );
}

async function openRun() {
  const history = await screen.findByTestId("run-history-row");
  fireEvent.click(within(history).getByRole("button", { name: /Open the run started/ }));
  await screen.findByTestId("run-progress");
}

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
  serve();
});

describe("ExecutionArea findings (T124, FR-054 to FR-059)", () => {
  it("lists the findings after the run section, with occurrences beside them", async () => {
    renderArea();
    const rows = await screen.findAllByTestId("finding-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("2 occurrences")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Unreviewed occurrence")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Findings" })).toBeInTheDocument();
    expect(screen.getByText(/no finding is not proof of safety/)).toBeInTheDocument();
  });

  it("opens a finding and shows its detail", async () => {
    renderArea();
    fireEvent.click(await screen.findByRole("button", { name: "GET /orders: Authentication" }));
    expect(await screen.findByRole("heading", { level: 3, name: "GET /orders: Authentication" })).toBeInTheDocument();
    expect(m.fetchFinding).toHaveBeenCalledWith("sf-1", expect.anything());
    await waitFor(() => expect(screen.getByTestId("finding-detail-panel")).toHaveFocus());
  });

  it("shows unreadable findings as an error with a retry, not as none", async () => {
    m.listFindings.mockResolvedValueOnce({ ok: false, error: "network_error", message: "The Security Lab service is unreachable.", status: 0, details: {} });
    renderArea();
    const error = await screen.findByTestId("finding-list-error");
    expect(error).toHaveTextContent("This is not an empty list.");
    expect(screen.queryByTestId("finding-list-empty")).not.toBeInTheDocument();
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    expect(await screen.findAllByTestId("finding-row")).toHaveLength(2);
  });

  it("starts from a filter handed over by the Overview, and puts focus on the findings", async () => {
    renderArea({ intent: { kind: "findings", filters: { severity: "high", unreviewed: true } } });
    await screen.findAllByTestId("finding-row");
    expect(m.listFindings).toHaveBeenCalledWith({ severity: "high", unreviewed: true }, { page: 1, pageSize: 25 }, expect.anything());
    expect(screen.getByLabelText("Severity", { selector: "select" })).toHaveValue("high");
    expect(screen.getByLabelText("Only findings with an unreviewed occurrence")).toBeChecked();
    await waitFor(() => expect(screen.getByTestId("findings-section")).toHaveFocus());
  });

  it("filters the list from the filter controls and starts again from page one", async () => {
    renderArea();
    await screen.findAllByTestId("finding-row");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "open" } });
    await waitFor(() => expect(m.listFindings).toHaveBeenLastCalledWith({ status: "open" }, { page: 1, pageSize: 25 }, expect.anything()));
  });

  it("saves a change to the open finding and reads the list and the finding again", async () => {
    m.patchFinding.mockResolvedValue({ ok: true, data: { ...OPEN, status: "resolved" } });
    renderArea();
    fireEvent.click(await screen.findByRole("button", { name: "GET /orders: Authentication" }));
    await screen.findByRole("heading", { level: 3, name: "GET /orders: Authentication" });
    const listCalls = m.listFindings.mock.calls.length;
    const detailCalls = m.fetchFinding.mock.calls.length;
    fireEvent.change(screen.getByLabelText(/New status/), { target: { value: "resolved" } });
    fireEvent.change(screen.getByLabelText(/^Note: why/), { target: { value: "Fixed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save change" }));
    await waitFor(() => expect(m.patchFinding).toHaveBeenCalledWith("sf-1", { status: "resolved", note: "Fixed" }));
    await waitFor(() => expect(m.listFindings.mock.calls.length).toBeGreaterThan(listCalls));
    await waitFor(() => expect(m.fetchFinding.mock.calls.length).toBeGreaterThan(detailCalls));
  });

  describe("run results", () => {
    it("links each result to its scenario, and a failed result to its finding", async () => {
      renderArea();
      await openRun();
      const rows = screen.getAllByTestId("run-result-row");
      expect(rows).toHaveLength(3);
      for (const row of rows) expect(within(row).getByRole("button", { name: "Open the scenario for this result (version 1)" })).toBeInTheDocument();
      expect(await within(rows[0]).findByRole("button", { name: "Open the finding for this result (2 occurrences)" })).toBeInTheDocument();
    });

    it("does not offer a finding for a result that did not fail", async () => {
      renderArea();
      await openRun();
      const passed = screen.getAllByTestId("run-result-row")[1];
      expect(passed).toHaveAttribute("data-outcome", "passed");
      expect(within(passed).queryByRole("button", { name: /Open the finding/ })).not.toBeInTheDocument();
      expect(passed).not.toHaveTextContent("No finding is recorded");
    });

    it("says no finding is recorded for a failed result that has none", async () => {
      renderArea();
      await openRun();
      const failedWithout = screen.getAllByTestId("run-result-row")[2];
      expect(await within(failedWithout).findByText("No finding is recorded for this result.")).toBeInTheDocument();
    });

    it("opens the finding behind a failed result", async () => {
      renderArea();
      await openRun();
      fireEvent.click(await within(screen.getAllByTestId("run-result-row")[0]).findByRole("button", { name: /Open the finding for this result/ }));
      expect(await screen.findByRole("heading", { level: 3, name: "GET /orders: Authentication" })).toBeInTheDocument();
      expect(m.fetchFinding).toHaveBeenCalledWith("sf-1", expect.anything());
    });

    it("asks the page to open the scenario of a result, selected and filtered to it", async () => {
      const onNavigate = vi.fn();
      renderArea({ onNavigate });
      await openRun();
      fireEvent.click(within(screen.getAllByTestId("run-result-row")[1]).getByRole("button", { name: /Open the scenario for this result/ }));
      expect(onNavigate).toHaveBeenCalledWith({ kind: "scenarios", filters: { q: "ss-2" }, selectScenarioId: "ss-2" });
    });

    it("shows a failed lookup of the finding as text, not as none", async () => {
      m.listFindings.mockImplementation(async (filters) =>
        filters.scenario === "ss-1" ? { ok: false, error: "network_error", message: "gone", status: 0, details: {} } : { ok: true, data: findingList([OPEN, OTHER]) },
      );
      renderArea();
      await openRun();
      expect(await within(screen.getAllByTestId("run-result-row")[0]).findByText("The finding could not be looked up: gone")).toBeInTheDocument();
    });
  });

  describe("from a finding", () => {
    it("opens the run of an occurrence, and moves focus to it", async () => {
      renderArea();
      fireEvent.click(await screen.findByRole("button", { name: "GET /orders: Authentication" }));
      await screen.findByRole("heading", { level: 3, name: "GET /orders: Authentication" });
      expect(screen.queryByTestId("run-progress")).not.toBeInTheDocument();
      fireEvent.click(screen.getAllByRole("button", { name: /Open the run of the occurrence/ })[0]);
      expect(await screen.findByTestId("run-progress")).toBeInTheDocument();
      expect(m.fetchRun).toHaveBeenCalledWith("run-1", expect.anything());
      await waitFor(() => expect(screen.getByTestId("run-panel")).toHaveFocus());
    });

    it("asks the page to open the scenario of the finding", async () => {
      const onNavigate = vi.fn();
      renderArea({ onNavigate });
      fireEvent.click(await screen.findByRole("button", { name: "GET /orders: Authentication" }));
      fireEvent.click(await screen.findByRole("button", { name: "Open the scenario" }));
      expect(onNavigate).toHaveBeenCalledWith({ kind: "scenarios", filters: { q: "ss-1" }, selectScenarioId: "ss-1" });
    });
  });
});
