import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { analyzeChainPlan, type ChainRun, type ChainRunSummary, type Environment, type ScriptStatus } from "@apipilot/shared-domain";
import { ChainRunPanel } from "../../src/components/requestChain/ChainRunPanel";
import type { PerformanceRuns } from "../../src/components/performance/usePerformanceRuns";
import { chainRunsClient } from "../../src/services/requestChainClient";
import { lifecyclePlan, PLAN_ID } from "./requestChainFixtures";

/** AP-037 (specs/037-request-chain-performance tasks T031; FR-031, FR-035, Clarification 2026-10-03). */

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
      {...props}
    />,
  );
  return onRestore;
}

describe("ChainRunPanel", () => {
  it("names the environment and lists the chains, write steps and hosts at the trigger", () => {
    renderPanel();
    expect(screen.getByText("Local stub", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Tier: local")).toBeInTheDocument();
    expect(screen.getByTestId("trigger-chains")).toHaveTextContent("Customer lifecycle · 3 steps");
    expect(screen.getByTestId("trigger-hosts")).toHaveTextContent("http://127.0.0.1:4600");
    expect(screen.getByText(/Load is generated from the machine running the ApiPilot backend/)).toBeInTheDocument();
    expect(screen.getAllByText(/Creates/).length).toBeGreaterThan(0);
  });

  it("starts a run on the named environment only on the engineer's click", () => {
    const start = vi.fn(async () => true);
    renderPanel({ runs: runs({ start }) });
    fireEvent.click(screen.getByRole("button", { name: "Start run on Local stub" }));
    expect(start).toHaveBeenCalledWith("e1");
  });

  it.each([
    [{ script: null }, "Generate the script first."],
    [{ script: { ...SCRIPT, outOfDate: true } }, "The plan changed after the script was generated. Regenerate it first."],
    [{ environment: null }, "Choose the target environment."],
    [{ dirty: true }, "Saving your latest change…"],
  ])("says why a run cannot start (%j)", (props, reason) => {
    renderPanel(props);
    expect(screen.getByTestId("run-blocked")).toHaveTextContent(reason);
    expect(screen.getByRole("button", { name: /Start run/ })).toBeDisabled();
  });

  it("offers Run again only while the script is unchanged, and says why otherwise", () => {
    const start = vi.fn(async () => true);
    renderPanel({ runs: runs({ latestFinished: finishedRun(), start }) });
    fireEvent.click(screen.getByRole("button", { name: "Run again on Local stub" }));
    expect(start).toHaveBeenCalledWith("e1");
  });

  it("refuses Run again after the script changed, and restores without starting a run", () => {
    const start = vi.fn(async () => true);
    const onRestore = renderPanel({ runs: runs({ latestFinished: finishedRun({ scriptSha256: "b".repeat(64) }), start }) });
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
    expect(screen.getByTestId("trigger-data-sets")).toHaveTextContent("customers · 50 rows");
  });
});
