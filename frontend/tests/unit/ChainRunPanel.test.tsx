import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { analyzeChainPlan, type ChainRun, type ChainRunSummary, type Environment, type ScriptStatus } from "@apipilot/shared-domain";
import { ChainRunPanel } from "../../src/components/requestChain/ChainRunPanel";
import type { PerformanceRuns } from "../../src/components/performance/usePerformanceRuns";
import { chainRunsClient } from "../../src/services/requestChainClient";
import { lifecyclePlan, PLAN_ID } from "./requestChainFixtures";

/** AP-037 (FR-031, FR-035, Clarification 2026-10-03); AP-040 (the Runs & reports tab: runs, report, last run, restore). */

const ENVIRONMENT: Environment = { id: "e1", name: "Local stub", tier: "local", baseUrl: "http://127.0.0.1:4600", variableValues: { client_id: "x" }, requestDelayMs: 0 };
const SCRIPT: ScriptStatus = { planFingerprint: "fp-chain-1", scriptSha256: "a".repeat(64), stepCount: 3, outOfDate: false };

function runs(overrides: Partial<PerformanceRuns<ChainRun, ChainRunSummary, string>> = {}): PerformanceRuns<ChainRun, ChainRunSummary, string> {
  return {
    readiness: { state: "ready", version: "1.2.0", checkedAt: "t" },
    checking: false,
    checkReadiness: async () => undefined,
    run: null,
    latestFinished: null,
    inProgress: false,
    runs: [],
    reportRunId: null,
    showReport: () => undefined,
    starting: false,
    cancelling: false,
    error: null,
    start: vi.fn(async () => true),
    cancel: async () => undefined,
    ...overrides,
  };
}

function finishedRun(overrides: Partial<ChainRun> = {}): ChainRun {
  const plan = lifecyclePlan();
  return {
    id: "r1",
    planSource: "chain",
    planId: PLAN_ID,
    status: "completed",
    environment: { id: "e1", name: "Local stub", tier: "local", baseUrl: "http://127.0.0.1:4600" },
    snapshot: {
      planId: PLAN_ID,
      planName: plan.name,
      fingerprint: "fp-chain-1",
      chains: [],
      loadProfile: plan.loadProfile,
      thinkTimeMs: 1000,
      thresholds: [],
      hosts: ["{{baseUrl}}"],
      dataSets: [],
      writeSummary: { total: 0, byMethod: [], operations: [] },
      seedSource: null,
      contentNotice: "user-authored-unverified",
    },
    scriptSha256: SCRIPT.scriptSha256,
    k6Version: "1.2.0",
    plannedDurationMs: 60_000,
    startedAt: "2026-10-03T10:00:00.000Z",
    cancelRequested: false,
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof ChainRunPanel>[0]> = {}) {
  const plan = props.plan ?? lifecyclePlan();
  const onRestore = vi.fn();
  const onGoToSetup = vi.fn();
  render(
    <ChainRunPanel
      plan={plan}
      analysis={analyzeChainPlan(plan, { environmentValueNames: ["baseUrl", "client_id"] })}
      script={SCRIPT}
      environment={ENVIRONMENT}
      environments={[ENVIRONMENT]}
      runs={runs()}
      runsClient={chainRunsClient(PLAN_ID)}
      dirty={false}
      onRestore={onRestore}
      onGoToSetup={onGoToSetup}
      {...props}
    />,
  );
  return { onRestore, onGoToSetup };
}

describe("ChainRunPanel", () => {
  it("does not start anything: starting a run is on Run setup, and the last run's card links there", () => {
    const { onGoToSetup } = renderPanel({ runs: runs({ latestFinished: finishedRun() }) });
    expect(screen.queryByRole("button", { name: /Start run/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start debug run/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to Run setup" }));
    expect(onGoToSetup).toHaveBeenCalledTimes(1);
  });

  it("says there are no runs yet, and links to Run setup", () => {
    renderPanel();
    expect(screen.getByText(/No runs yet/)).toBeInTheDocument();
    expect(screen.getByText("No finished run yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to Run setup" })).toBeInTheDocument();
  });

  it("lists the runs and opens a report", () => {
    const summary = { id: "r1", status: "completed", startedAt: "2026-10-03T10:00:00.000Z", environment: { id: "e1", name: "Local stub", tier: "local", baseUrl: "http://127.0.0.1:4600" } } as unknown as ChainRunSummary;
    const showReport = vi.fn();
    renderPanel({ runs: runs({ runs: [summary], showReport }) });
    fireEvent.click(screen.getByRole("button", { name: "View report" }));
    expect(showReport).toHaveBeenCalledWith("r1");
  });

  it("shows the run in progress with its figures and Cancel", () => {
    const cancel = vi.fn(async () => undefined);
    const run = { ...finishedRun(), status: "in-progress" as const, progress: { elapsedMs: 12_000, requestsSoFar: 40, failuresSoFar: 1 } } as unknown as ChainRun;
    renderPanel({ runs: runs({ run, inProgress: true, cancel }) });
    expect(screen.getByRole("status")).toHaveTextContent("Running · 12 s · 40 requests · 1 failures");
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("offers Run again only while the script is unchanged", () => {
    const start = vi.fn(async () => true);
    renderPanel({ runs: runs({ latestFinished: finishedRun(), start }) });
    fireEvent.click(screen.getByRole("button", { name: "Run again on Local stub" }));
    expect(start).toHaveBeenCalledWith("e1");
  });

  it("refuses Run again once an edit marks the script out of date, though its SHA-256 still matches", () => {
    renderPanel({ script: { ...SCRIPT, outOfDate: true }, runs: runs({ latestFinished: finishedRun() }) });
    expect(screen.getByRole("button", { name: /Run again/ })).toBeDisabled();
    expect(screen.getByTestId("run-again-blocked")).toHaveTextContent("The script changed since this run.");
  });

  it("refuses Run again after the script changed, and restores without starting a run", () => {
    const start = vi.fn(async () => true);
    const { onRestore } = renderPanel({ runs: runs({ latestFinished: finishedRun({ scriptSha256: "b".repeat(64) }), start }) });
    expect(screen.getByRole("button", { name: /Run again/ })).toBeDisabled();
    expect(screen.getByTestId("run-again-blocked")).toHaveTextContent("The script changed since this run.");
    fireEvent.click(screen.getByRole("button", { name: "Into this plan" }));
    fireEvent.click(screen.getByRole("button", { name: "As a new plan" }));
    expect(onRestore.mock.calls).toEqual([
      ["r1", "plan"],
      ["r1", "new-plan"],
    ]);
    expect(start).not.toHaveBeenCalled();
  });

  it("refuses Run again when a data set changed since the run (FR-035)", () => {
    const dataSet = { id: "d1", name: "customers", mode: "row-per-iteration" as const, columns: [], rowCount: 50, sizeBytes: 1, sha256: "new" };
    const run = finishedRun();
    run.snapshot.dataSets = [{ ...dataSet, sha256: "old" }];
    renderPanel({ plan: lifecyclePlan({ dataSets: [dataSet] }), runs: runs({ latestFinished: run }) });
    expect(screen.getByTestId("run-again-blocked")).toHaveTextContent("The data set customers changed since this run.");
  });
});
