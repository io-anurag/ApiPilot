import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PerformanceRunSummary } from "@apipilot/shared-domain";
import { LEGACY_RUNS_NOTE, LegacyRunsView } from "../../src/components/requestChain/LegacyRunsView";
import { stubFetch } from "./performanceFixtures";

/** AP-037 phase two (specs/037-request-chain-performance tasks T095; FR-037). */

afterEach(() => vi.unstubAllGlobals());

function summary(id: string, startedAt: string, planSource: PerformanceRunSummary["planSource"]): PerformanceRunSummary {
  return {
    id,
    status: "completed",
    environment: { id: "e1", name: "Staging", tier: "staging", baseUrl: "https://staging.example.test" },
    planSource,
    scriptSha256: "a".repeat(64),
    k6Version: "1.2.0",
    plannedDurationMs: 60_000,
    startedAt,
    endedAt: startedAt,
    cancelRequested: false,
  } as PerformanceRunSummary;
}

const GUIDED = "/api/test-generation-workflow/performance";
const QUICK = "/api/quick-performance";
const COLLECTION = "/api/collection-performance";

function stubRuns(runs: { guided?: PerformanceRunSummary[]; quick?: PerformanceRunSummary[]; collection?: PerformanceRunSummary[] }) {
  return stubFetch({
    [`GET ${GUIDED}/runs`]: () => [200, { runs: runs.guided ?? [] }],
    [`GET ${QUICK}/runs`]: () => [200, { runs: runs.quick ?? [] }],
    [`GET ${COLLECTION}/runs`]: () => [200, { runs: runs.collection ?? [] }],
    [`GET ${QUICK}/runs/q1/report`]: () => [200, "<!doctype html><p>Quick report</p>"],
  });
}

describe("LegacyRunsView", () => {
  it("lists runs from the retired plans, newest first, with the note and no Run again or restore", async () => {
    stubRuns({
      guided: [summary("g1", "2026-09-28T10:00:00.000Z", "guided")],
      quick: [summary("q1", "2026-10-01T10:00:00.000Z", "quick")],
      collection: [summary("c1", "2026-09-30T10:00:00.000Z", "collection")],
    });
    render(<LegacyRunsView />);
    const section = await screen.findByTestId("legacy-runs");
    expect(within(section).getByText(LEGACY_RUNS_NOTE)).toBeInTheDocument();
    expect(LEGACY_RUNS_NOTE).toBe("Recorded before request-chain plans: you can open the report, but it cannot be run again or restored.");
    const rows = within(section).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[1].textContent)).toEqual(["Quick performance test", "Collection performance test", "Guided workflow"]);
    expect(within(section).queryByRole("button", { name: /Run again|Restore|Into this plan|As a new plan/ })).not.toBeInTheDocument();
  });

  it("opens a run's report from its own base", async () => {
    const calls = stubRuns({ quick: [summary("q1", "2026-10-01T10:00:00.000Z", "quick")] });
    render(<LegacyRunsView />);
    // WCAG 2.5.3: the accessible name starts with the visible label, so "View report" reaches it.
    fireEvent.click(await screen.findByRole("button", { name: /^View report of the run started / }));
    await waitFor(() => expect(calls.some((call) => call.url === `${QUICK}/runs/q1/report`)).toBe(true));
  });

  it("shows nothing when the session has no earlier runs", async () => {
    const calls = stubRuns({});
    const { container } = render(<LegacyRunsView />);
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(container).toBeEmptyDOMElement();
  });
});
