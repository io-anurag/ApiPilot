import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { CoverageSnapshot } from "@apipilot/shared-domain";
import { CoveragePage } from "../../../src/pages/CoveragePage";
import { CategoryCoverage } from "../../../src/components/apiCoverage/CategoryCoverage";
import { OperationCounts } from "../../../src/components/apiCoverage/OperationCounts";
import { StateBadge } from "../../../src/components/apiCoverage/CoverageBadges";
import { breakdownFromCounts, scopeLabel } from "../../../src/components/apiCoverage/coverageViewModel";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { fetchCoverage, type CoverageResult } from "../../../src/services/coverageClient";
import { requirement, scenario, snapshot, stateCounts } from "./coverageFixtures";

vi.mock("../../../src/services/coverageClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/coverageClient")>()),
  fetchCoverage: vi.fn(),
}));

const fetchMock = vi.mocked(fetchCoverage);
const ok = (data: CoverageSnapshot = snapshot()): CoverageResult => ({ ok: true, snapshot: data });

function renderPage() {
  return render(
    <ActiveViewContext.Provider value="coverage">
      <CoveragePage onOpenWorkflow={vi.fn()} />
    </ActiveViewContext.Provider>,
  );
}

beforeEach(() => fetchMock.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("OperationCounts", () => {
  it("shows the five operation-level counts with numerator, denominator and percentage", () => {
    render(<OperationCounts counts={{ eligible: 8, withScenarios: 7, withPassingVerification: 6, withFailures: 2, withNoScenarios: 1 }} />);
    const section = screen.getByTestId("operation-counts");
    expect(within(section).getByText("Eligible operations")).toBeInTheDocument();
    expect(section).toHaveTextContent("With generated scenarios7 / 887.5%");
    expect(section).toHaveTextContent("With passing verification6 / 875%");
    expect(section).toHaveTextContent("With execution failures2 / 825%");
    expect(section).toHaveTextContent("With no generated scenarios1 / 812.5%");
    expect(section).toHaveTextContent("can have both passing verification and failures");
  });

  it("reads not available, never NaN, when there are no eligible operations", () => {
    render(<OperationCounts counts={{ eligible: 0, withScenarios: 0, withPassingVerification: 0, withFailures: 0, withNoScenarios: 0 }} />);
    expect(screen.getByTestId("operation-counts")).toHaveTextContent("not available (0 eligible)");
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });
});

describe("CategoryCoverage", () => {
  it("shows specification and runtime figures per available category, counted in requirements", () => {
    render(<CategoryCoverage snapshot={snapshot()} selected={undefined} />);
    const positive = screen.getAllByTestId("category-card").find((c) => c.dataset.category === "positive") as HTMLElement;
    expect(positive).toHaveTextContent("Specification coverage4 / 4100%");
    expect(positive).toHaveTextContent("Runtime-verified2 / 450%");
    expect(positive.querySelector("[role='img']")).toHaveAccessibleName(/2 verified, 0 executed, failed, 0 inconclusive, 0 stale: re-run required, 2 generated, not executed, 0 not covered, of 4/);
  });

  it("shows security as unavailable with its reason, never as a percentage", () => {
    render(<CategoryCoverage snapshot={snapshot()} selected={undefined} />);
    const security = screen.getAllByTestId("category-card").find((c) => c.dataset.category === "security") as HTMLElement;
    expect(security).toHaveTextContent("Unavailable");
    expect(security).toHaveTextContent("No scenario category identifies authorization intent");
    expect(security).not.toHaveTextContent("%");
    expect(screen.getByTestId("category-coverage")).toHaveTextContent("operations declare a security requirement (declared in the specification, not tested)");
  });

  it("reads a category with no eligible requirements as not available, and lists unclassified requirements", () => {
    const base = snapshot();
    const empty = snapshot({
      categoryCoverage: base.categoryCoverage.map((c) =>
        c.group === "boundary" ? { ...c, available: false, eligible: 0, specCovered: 0, verified: 0, counts: stateCounts(), reason: "No eligible requirements of this category in the current scope." } : c,
      ),
    });
    render(<CategoryCoverage snapshot={empty} selected="boundary" />);
    const boundary = screen.getAllByTestId("category-card").find((c) => c.dataset.category === "boundary") as HTMLElement;
    expect(boundary).toHaveTextContent("Not available (0 eligible)");
    expect(screen.getByTestId("unclassified")).toHaveTextContent("GET /orders/{id} documented response default");
    expect(screen.getByTestId("unclassified")).toHaveTextContent("Unclassified scenarios: 0");
  });
});

describe("state vocabulary", () => {
  it("labels Stale distinctly from Generated, not executed, with its own segment", () => {
    render(<StateBadge state="stale" />);
    expect(screen.getByText("Stale: re-run required")).toBeInTheDocument();
    const bar = breakdownFromCounts("x", stateCounts({ stale: 2, "generated-not-executed": 1 }));
    expect(bar.segments.find((s) => s.key === "stale")?.count).toBe(2);
    expect(bar.segments.find((s) => s.key === "generated")?.count).toBe(1);
    expect(bar.total).toBe(3);
  });

  it("describes the filter scope in words", () => {
    const s = snapshot();
    expect(scopeLabel(s, {}, false)).toBe("All 4 eligible operations");
    expect(scopeLabel({ ...s, operations: s.operations.slice(0, 2) }, { methods: ["POST"], gapKind: "stale" }, true)).toBe(
      "Filtered: 2 of 4 operations (method POST; gap type needs re-execution (stale))",
    );
  });
});

describe("CoveragePage: refined view", () => {
  beforeEach(() => fetchMock.mockResolvedValue(ok()));

  it("shows operation counts, categories, the evidence mode and a scope label", async () => {
    renderPage();
    expect(await screen.findByTestId("operation-counts")).toBeInTheDocument();
    expect(screen.getByTestId("category-coverage")).toBeInTheDocument();
    expect(screen.getByTestId("coverage-scope")).toHaveTextContent("Scope: All 4 eligible operations");
    expect(screen.getByTestId("coverage-evidence")).toHaveTextContent("Latest qualifying result per scenario from run-2 (9)");
  });

  it("names excluded runs and their reason in the header", async () => {
    const base = snapshot();
    fetchMock.mockResolvedValue(
      ok({ ...base, execution: { ...base.execution, excludedRuns: [{ runId: "run-9", environment: { name: "Elsewhere", tier: "production" }, reason: "different environment" }] } }),
    );
    renderPage();
    expect(await screen.findByTestId("coverage-excluded-runs")).toHaveTextContent("run-9 (different environment: Elsewhere, production)");
  });

  it("shows the assertion outcomes with failed and not-evaluated counts outside the denominator", async () => {
    renderPage();
    const runtime = await screen.findByTestId("runtime-metrics");
    expect(runtime).toHaveTextContent("2 failed · 1 not evaluated (outside the denominator)");
  });

  it("expands an operation to its scenarios and non-verified requirements, with no single status", async () => {
    const base = snapshot();
    fetchMock.mockResolvedValue(
      ok({
        ...base,
        requirements: [
          { ...requirement("op:POST /orders", "operation", "verified"), label: "Happy path" },
          { ...requirement("resp:POST /orders:400", "response-code", "executed-failed"), label: "400 Bad Request", cause: "assertion-failed", tally: { passed: 0, failed: 1, inconclusive: 0, notExecuted: 0 } },
          { ...requirement("reqprop:POST /orders:qty#boundary", "request-schema", "generated-not-executed"), label: "qty maximum", cause: "never-run", tally: { passed: 0, failed: 0, inconclusive: 0, notExecuted: 1 } },
        ],
        scenarios: [
          scenario({ scenarioId: "s1", operationKey: "POST /orders", verdict: "passed", cause: undefined, runId: "run-2" }),
          scenario({ scenarioId: "s2", operationKey: "POST /orders", verdict: "failed", cause: "assertion-failed", runId: "run-2" }),
          scenario({ scenarioId: "s3", operationKey: "POST /orders", group: "boundary" }),
        ],
      }),
    );
    renderPage();
    const row = (await screen.findAllByTestId("gap-row")).find((r) => r.dataset.operation === "POST /orders") as HTMLElement;
    const toggle = within(row).getByRole("button", { name: "Details" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(within(row).getByRole("button", { name: "Hide details" })).toHaveAttribute("aria-expanded", "true");
    const detail = screen.getByTestId("operation-detail");
    expect(within(detail).getAllByTestId("scenario-row")).toHaveLength(3);
    expect(detail).toHaveTextContent("Passed");
    expect(detail).toHaveTextContent("Failed");
    expect(detail).toHaveTextContent("Not executed");
    const requirementRows = within(detail).getAllByTestId("requirement-row");
    expect(requirementRows.map((r) => r.dataset.state)).toEqual(["executed-failed", "generated-not-executed"]);
    expect(detail).toHaveTextContent("assertion failed");
    expect(detail).toHaveTextContent("never run");
    fireEvent.click(screen.getByLabelText("Show verified requirements in operation details"));
    expect(within(screen.getByTestId("operation-detail")).getAllByTestId("requirement-row")).toHaveLength(3);
    expect(within(row).getByTestId("scenario-verdicts")).toHaveTextContent("2 passed, 1 failed, 0 inconclusive, 1 not executed");
  });

  it("shows the matching requirement count when a state filter is active", async () => {
    const base = snapshot();
    fetchMock.mockResolvedValue(
      ok({ ...base, operations: base.operations.map((o, i) => (i === 0 ? { ...o, matchingRequirements: 2 } : o)) }),
    );
    renderPage();
    const row = (await screen.findAllByTestId("gap-row"))[0];
    expect(row).toHaveTextContent("2 matching requirements");
  });

  it("offers the new gap types and keeps security disabled", async () => {
    renderPage();
    await screen.findByTestId("gaps-table");
    const gapType = screen.getByLabelText("Gap type") as HTMLSelectElement;
    expect([...gapType.options].map((o) => o.textContent)).toEqual([
      "All",
      "Missing coverage",
      "Failed verification",
      "Insufficient evidence",
      "Needs re-execution (stale)",
    ]);
    const security = [...(screen.getByLabelText("Scenario category") as HTMLSelectElement).options].find((o) => o.value === "security");
    expect(security).toBeDisabled();
  });

  it("keeps a first-load failure as an error, not as empty coverage", async () => {
    fetchMock.mockResolvedValue({ ok: false, error: "network_error", message: "unreachable" });
    renderPage();
    expect(await screen.findByTestId("coverage-error")).toHaveTextContent("This is not an empty result");
    expect(screen.queryByTestId("operation-counts")).not.toBeInTheDocument();
  });
});
