import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { OverviewArea } from "../../../src/components/securityLab/OverviewArea";
import { SecurityLabPage } from "../../../src/pages/SecurityLabPage";
import type { SecurityArea } from "../../../src/navigation/routes";
import * as client from "../../../src/services/securityLabClient";
import { analysisReply, categoriesReply, finding, findingList, observation, overview, scenarioItem, scenarioList } from "./securityFixtures";

vi.mock("../../../src/services/aiStatusClient", () => ({ fetchAiStatus: vi.fn().mockResolvedValue({ ok: true, status: { state: "ready", provider: "mock", reason: null } }) }));
vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  fetchAnalysis: vi.fn(),
  fetchCategories: vi.fn(),
  fetchOverview: vi.fn(),
  fetchScope: vi.fn(),
  listScenarios: vi.fn(),
  listScenarioIds: vi.fn(),
  fetchScenario: vi.fn(),
  listFindings: vi.fn(),
  fetchFinding: vi.fn(),
  listProfiles: vi.fn(),
  listEnvironments: vi.fn(),
  listRuns: vi.fn(),
  listAllScenarios: vi.fn(),
}));

const m = {
  fetchAnalysis: vi.mocked(client.fetchAnalysis),
  fetchCategories: vi.mocked(client.fetchCategories),
  fetchOverview: vi.mocked(client.fetchOverview),
  fetchScope: vi.mocked(client.fetchScope),
  listScenarios: vi.mocked(client.listScenarios),
  listScenarioIds: vi.mocked(client.listScenarioIds),
  fetchScenario: vi.mocked(client.fetchScenario),
  listFindings: vi.mocked(client.listFindings),
  fetchFinding: vi.mocked(client.fetchFinding),
  listProfiles: vi.mocked(client.listProfiles),
  listEnvironments: vi.mocked(client.listEnvironments),
  listRuns: vi.mocked(client.listRuns),
  listAllScenarios: vi.mocked(client.listAllScenarios),
};

function renderActive(ui: ReactElement) {
  return render(<ActiveViewContext.Provider value="security">{ui}</ActiveViewContext.Provider>);
}

function serve(over = overview()) {
  m.fetchAnalysis.mockResolvedValue({ ok: true, data: analysisReply([observation({ classification: "potential-risk" }), observation({ id: "i2" })]) });
  m.fetchCategories.mockResolvedValue({ ok: true, data: categoriesReply });
  m.fetchOverview.mockResolvedValue({ ok: true, data: over });
  m.fetchScope.mockResolvedValue({ ok: true, data: { mode: "all", selectedCount: 9, totalCount: 9 } });
  m.listScenarios.mockImplementation(async (filters) => {
    const total = filters.flag === "stale" ? 2 : filters.reviewState === "approved" ? 3 : filters.category === "authentication" ? 8 : 12;
    return { ok: true, data: scenarioList(Array.from({ length: Math.min(total, 25) }, (_, i) => scenarioItem({ id: `ss-${i}`, title: `Scenario ${i}` })), { total }) };
  });
  m.listScenarioIds.mockResolvedValue({ ok: true, data: { items: [], total: 0, capped: false } });
  m.fetchScenario.mockResolvedValue({ ok: true, data: { scenario: scenarioItem(), content: {} as never, versions: [] } });
  m.listFindings.mockImplementation(async (filters) => {
    const items = filters.unreviewed ? [finding({ id: "sf-u", unreviewedOccurrence: true, status: "accepted-risk" })] : [finding({ id: "sf-1" }), finding({ id: "sf-2" }), finding({ id: "sf-3" })];
    return { ok: true, data: findingList(items) };
  });
  m.fetchFinding.mockResolvedValue({ ok: true, data: finding() });
  m.listProfiles.mockResolvedValue({ ok: true, data: { profiles: [] } });
  m.listEnvironments.mockResolvedValue({ ok: true, data: { environments: [] } });
  m.listRuns.mockResolvedValue({ ok: true, data: { runs: [] } });
  m.listAllScenarios.mockResolvedValue({ ok: true, data: [] });
}

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
  serve();
});

describe("Overview counts (T128, T133, FR-060, SC-012)", () => {
  it("shows every count of scenarios and findings under labelled groups", async () => {
    renderActive(<OverviewArea onOpen={vi.fn()} />);
    await screen.findByTestId("overview-summary");
    const scenarios = screen.getByRole("list", { name: "Scenarios by review state" });
    expect(within(scenarios).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Draft 7", "In review 2", "Approved 3", "Rejected 0"]);
    expect(within(screen.getByRole("list", { name: "Scenarios by category" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Authentication 8", "Input validation 4"]);
    expect(within(screen.getByRole("list", { name: "Scenarios needing attention" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Stale 2",
      "Orphaned 0",
      "Blocked 5",
      "Specification not loaded 0",
    ]);
    expect(within(screen.getByRole("list", { name: "Findings by severity" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Critical 0", "High 2", "Medium 1", "Low 0", "Info 0"]);
    expect(within(screen.getByRole("list", { name: "Findings by status" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Open 2", "Accepted risk 1", "False positive 0", "Resolved 0"]);
    expect(screen.getByRole("button", { name: "All scenarios 12" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All findings 3" })).toBeInTheDocument();
  });

  it("labels each group with the evidence it rests on, and keeps occurrences apart from findings", async () => {
    renderActive(<OverviewArea onOpen={vi.fn()} />);
    await screen.findByTestId("overview-summary");
    expect(screen.getByText(/Evidence basis: generated from the specification\. Nothing here has been sent to any target\./)).toBeInTheDocument();
    expect(screen.getByText(/Evidence basis: responses to requests a run actually sent\. Occurrences are counted beside findings, never added to them\./)).toBeInTheDocument();
    expect(screen.getByText(/Evidence basis: requests actually sent to a target\./)).toBeInTheDocument();
    expect(screen.getByTestId("overview-occurrences")).toHaveTextContent("Occurrences, counted separately: 7.");
    // The specification analysis is its own group, labelled as not proof.
    expect(await screen.findByRole("heading", { name: "Potential risks (specification analysis)" })).toBeInTheDocument();
    expect(screen.getByTestId("security-reading-note")).toHaveTextContent("A potential risk is a question for you to answer, not a vulnerability");
    expect(screen.getByRole("heading", { name: "Findings (from requests sent)" })).toBeInTheDocument();
  });

  it.each([
    ["All scenarios 12", { kind: "scenarios", filters: {} }],
    ["Authentication 8", { kind: "scenarios", filters: { category: "authentication" } }],
    ["Input validation 4", { kind: "scenarios", filters: { category: "input-validation" } }],
    ["Draft 7", { kind: "scenarios", filters: { reviewState: "draft" } }],
    ["In review 2", { kind: "scenarios", filters: { reviewState: "in_review" } }],
    ["Approved 3", { kind: "scenarios", filters: { reviewState: "approved" } }],
    ["Stale 2", { kind: "scenarios", filters: { flag: "stale" } }],
    ["Blocked 5", { kind: "scenarios", filters: { flag: "blocked" } }],
    ["All findings 3", { kind: "findings", filters: {} }],
    ["With an unreviewed occurrence 1", { kind: "findings", filters: { unreviewed: true } }],
    ["High 2", { kind: "findings", filters: { severity: "high" } }],
    ["Medium 1", { kind: "findings", filters: { severity: "medium" } }],
    ["Open 2", { kind: "findings", filters: { status: "open" } }],
    ["Accepted risk 1", { kind: "findings", filters: { status: "accepted-risk" } }],
  ])("opens the matching filtered list from the count %s", async (name, intent) => {
    const onOpen = vi.fn();
    renderActive(<OverviewArea onOpen={onOpen} />);
    await screen.findByTestId("overview-summary");
    fireEvent.click(screen.getByRole("button", { name }));
    expect(onOpen).toHaveBeenCalledWith(intent);
  });

  it("does not make a zero a link, because there is nothing to open", async () => {
    renderActive(<OverviewArea onOpen={vi.fn()} />);
    await screen.findByTestId("overview-summary");
    for (const name of ["Rejected 0", "Orphaned 0", "Critical 0", "Resolved 0"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.getByText("Orphaned", { selector: "span" })).toBeInTheDocument();
  });

  it("maps the specification-not-loaded count to its own flag filter", async () => {
    serve(overview({ scenarioCounts: { ...overview().scenarioCounts, specificationNotLoaded: 12, stale: 0, blocked: 0 } }));
    const onOpen = vi.fn();
    renderActive(<OverviewArea onOpen={onOpen} />);
    await screen.findByTestId("overview-summary");
    fireEvent.click(screen.getByRole("button", { name: "Specification not loaded 12" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "scenarios", filters: { flag: "specification_not_loaded" } });
  });

  it("shows the latest run's outcomes as text, with blocked, errored and not run said not to be passes", async () => {
    renderActive(<OverviewArea onOpen={vi.fn()} />);
    const run = await screen.findByTestId("overview-latest-run");
    expect(run).toHaveTextContent("Started 2026-10-18 10:00 UTC");
    expect(run).toHaveTextContent("Completed");
    expect(within(run).getByLabelText("Outcomes of the latest run")).toHaveTextContent("Passed: 2");
    expect(within(run).getByLabelText("Outcomes of the latest run")).toHaveTextContent("Blocked: 1");
    expect(run).toHaveTextContent("Blocked, errored and not run are not passes.");
  });

  it("says no run has been made yet, as an empty state", async () => {
    serve(overview({ latestRun: undefined }));
    renderActive(<OverviewArea onOpen={vi.fn()} />);
    expect(await screen.findByTestId("overview-no-run")).toHaveTextContent("No run has been made yet.");
  });

  it("lists the high-priority operations nothing has tested, each with its basis", async () => {
    renderActive(<OverviewArea onOpen={vi.fn()} />);
    const list = await screen.findByTestId("overview-untested");
    expect(list).toHaveTextContent("DELETE /orders/{id}");
    expect(list).toHaveTextContent("Why: effective-security-public: The operation is public by declaration.");
  });

  it("says plainly when there is no untested high-priority operation", async () => {
    serve(overview({ untestedHighPriority: [] }));
    renderActive(<OverviewArea onOpen={vi.fn()} />);
    expect(await screen.findByTestId("overview-untested-empty")).toBeInTheDocument();
  });

  it("states the scope and the specification revision", async () => {
    renderActive(<OverviewArea onOpen={vi.fn()} />);
    expect(await screen.findByTestId("overview-spec-status")).toHaveTextContent("A specification is loaded (revision aaaaaaaaaaaa). Generation scope: your Guided Workflow selection, 3 included and 6 left out.");
  });

  describe("states", () => {
    it("shows a loading state for the counts, not zeros", async () => {
      let resolve!: (value: Awaited<ReturnType<typeof client.fetchOverview>>) => void;
      m.fetchOverview.mockReturnValue(new Promise((r) => (resolve = r)));
      renderActive(<OverviewArea onOpen={vi.fn()} />);
      expect(screen.getByRole("status", { name: "Reading the overview" })).toBeInTheDocument();
      expect(screen.queryByTestId("overview-summary")).not.toBeInTheDocument();
      resolve({ ok: true, data: overview() });
      expect(await screen.findByTestId("overview-summary")).toBeInTheDocument();
    });

    it("shows an unavailable overview as an error with a retry, never as zero counts, and leaves the analysis alone", async () => {
      m.fetchOverview.mockResolvedValueOnce({ ok: false, error: "network_error", message: "The Security Lab service is unreachable.", status: 0, details: {} });
      renderActive(<OverviewArea onOpen={vi.fn()} />);
      const error = await screen.findByTestId("overview-summary-error");
      expect(error).toHaveTextContent("The scenario and finding counts are unavailable");
      expect(error).toHaveTextContent("This is not an empty result.");
      expect(screen.queryByTestId("overview-summary")).not.toBeInTheDocument();
      // The analysis reads independently, so it is still shown.
      expect(await screen.findByRole("heading", { name: "Potential risks (specification analysis)" })).toBeInTheDocument();
      m.fetchOverview.mockResolvedValueOnce({ ok: true, data: overview() });
      fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
      expect(await screen.findByTestId("overview-summary")).toBeInTheDocument();
    });

    it("keeps the last counts and says they are out of date when a refresh on returning to the page fails", async () => {
      const view = renderActive(<OverviewArea onOpen={vi.fn()} />);
      await screen.findByTestId("overview-summary");
      const wrap = (value: "home" | "security") => (
        <ActiveViewContext.Provider value={value}>
          <OverviewArea onOpen={vi.fn()} />
        </ActiveViewContext.Provider>
      );
      view.rerender(wrap("home"));
      m.fetchOverview.mockResolvedValueOnce({ ok: false, error: "network_error", message: "gone", status: 0, details: {} });
      view.rerender(wrap("security"));
      const stale = await screen.findByTestId("overview-summary-stale");
      expect(stale).toHaveTextContent("Out-of-date counts: the latest refresh failed");
      expect(screen.getByRole("button", { name: "All scenarios 12" })).toBeInTheDocument();
    });
  });

  describe("with no specification loaded", () => {
    const noSpec = () =>
      overview({
        specificationLoaded: false,
        specificationRevision: undefined,
        scope: undefined,
        observationCounts: { informational: 0, "potential-risk": 0, "requires-context": 0, "not-measurable": 0 },
        scenarioCounts: { ...overview().scenarioCounts, specificationNotLoaded: 12, stale: 0, blocked: 0 },
        untestedHighPriority: [],
      });

    it("still shows the retained counts and says where they come from", async () => {
      serve(noSpec());
      m.fetchAnalysis.mockResolvedValue({ ok: false, error: "no_specification", message: "No specification is loaded.", status: 409, details: {} });
      renderActive(<OverviewArea onOpen={vi.fn()} />);
      expect(await screen.findByTestId("overview-spec-status")).toHaveTextContent("No specification is loaded. The figures below come from work retained earlier");
      expect(screen.getByRole("button", { name: "All scenarios 12" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "All findings 3" })).toBeInTheDocument();
      expect(await screen.findByTestId("security-analysis-empty")).toHaveTextContent("There is no analysis to show yet.");
    });

    it("says the untested list needs a specification instead of showing an empty list", async () => {
      serve(noSpec());
      renderActive(<OverviewArea onOpen={vi.fn()} />);
      expect(await screen.findByTestId("overview-untested-unavailable")).toHaveTextContent("not available while no specification is loaded");
      expect(screen.queryByTestId("overview-untested-empty")).not.toBeInTheDocument();
    });
  });
});

describe("opening the list behind a count (SC-012)", () => {
  function Harness({ initial = "overview" as SecurityArea }) {
    const [area, setArea] = useState<SecurityArea>(initial);
    return <SecurityLabPage specificationLoaded area={area} onAreaChange={setArea} />;
  }

  it("opens the scenarios filtered by the count's filter, with the same total", async () => {
    renderActive(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Stale 2" }));
    expect(await screen.findByTestId("security-scenarios")).toBeInTheDocument();
    await waitFor(() => expect(m.listScenarios).toHaveBeenCalledWith({ flag: "stale" }, { page: 1, pageSize: 25 }, expect.anything()));
    expect(await screen.findByText("Showing 1–2 of 2 scenarios")).toBeInTheDocument();
    expect(screen.getByLabelText("Flag")).toHaveValue("stale");
  });

  it("opens the scenarios of a category with the category's total", async () => {
    renderActive(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Authentication 8" }));
    await waitFor(() => expect(m.listScenarios).toHaveBeenCalledWith({ category: "authentication" }, { page: 1, pageSize: 25 }, expect.anything()));
    expect(await screen.findByText("Showing 1–8 of 8 scenarios")).toBeInTheDocument();
  });

  it("opens the findings with an unreviewed occurrence with the same total, and puts focus there", async () => {
    renderActive(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "With an unreviewed occurrence 1" }));
    expect(await screen.findByTestId("security-execution")).toBeInTheDocument();
    await waitFor(() => expect(m.listFindings).toHaveBeenCalledWith({ unreviewed: true }, { page: 1, pageSize: 25 }, expect.anything()));
    expect(await screen.findByTestId("finding-counts")).toHaveTextContent("1 finding match.");
    await waitFor(() => expect(screen.getByTestId("findings-section")).toHaveFocus());
  });

  it("opens the findings of a severity", async () => {
    renderActive(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "High 2" }));
    await waitFor(() => expect(m.listFindings).toHaveBeenCalledWith({ severity: "high" }, { page: 1, pageSize: 25 }, expect.anything()));
  });

  it("starts the next visit by the tabs unfiltered", async () => {
    renderActive(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Stale 2" }));
    await screen.findByTestId("security-scenarios");
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    await screen.findByTestId("overview-summary");
    m.listScenarios.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Scenarios" }));
    await waitFor(() => expect(m.listScenarios).toHaveBeenCalledWith({}, { page: 1, pageSize: 25 }, expect.anything()));
    expect(screen.getByLabelText("Flag")).toHaveValue("");
  });
});
