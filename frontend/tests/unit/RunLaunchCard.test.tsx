import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { analyzeChainPlan, type ChainRun, type ChainRunSummary, type Environment, type ScriptStatus } from "@apipilot/shared-domain";
import { RunLaunchCard } from "../../src/components/requestChain/RunLaunchCard";
import type { PerformanceRuns } from "../../src/components/performance/usePerformanceRuns";
import { chainRunsClient } from "../../src/services/requestChainClient";
import { lifecyclePlan, PLAN_ID } from "./requestChainFixtures";

/** AP-040: the Run setup launch card: what a run sends, why it cannot start, the last-run line and its link to Runs & reports. AP-037 FR-031. */

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

function finishedRun(): ChainRun {
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
  };
}

function renderCard(runState: PerformanceRuns<ChainRun, ChainRunSummary, string>, props: Partial<Parameters<typeof RunLaunchCard>[0]> = {}) {
  const plan = props.plan ?? lifecyclePlan();
  const onViewRuns = vi.fn();
  render(
    <RunLaunchCard
      plan={plan}
      analysis={analyzeChainPlan(plan, { environmentValueNames: ["baseUrl", "client_id"] })}
      script={SCRIPT}
      environment={ENVIRONMENT}
      environments={[ENVIRONMENT]}
      runs={runState}
      runsClient={chainRunsClient(PLAN_ID)}
      dirty={false}
      onRestore={vi.fn()}
      onViewRuns={onViewRuns}
      {...props}
    />,
  );
  return onViewRuns;
}

describe("RunLaunchCard", () => {
  it("shows the last run in one line and links to Runs & reports, where Run again and restore live", () => {
    const onViewRuns = renderCard(runs({ latestFinished: finishedRun() }));
    const line = within(screen.getByTestId("run-launch-last-run"));
    expect(screen.getByTestId("run-launch-last-run")).toHaveTextContent("Completed");
    fireEvent.click(line.getByRole("button", { name: "View runs & reports" }));
    expect(onViewRuns).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Run again/ })).not.toBeInTheDocument();
  });

  it("says nothing about a last run when there is none", () => {
    renderCard(runs());
    expect(screen.queryByTestId("run-launch-last-run")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready to run on Local stub (local)" })).toBeInTheDocument();
  });

  it("names the environment and lists the chains, hosts and every write by its URL", () => {
    renderCard(runs());
    expect(screen.getByRole("heading", { name: "Ready to run on Local stub (local)" })).toBeInTheDocument();
    expect(screen.getByTestId("trigger-chains")).toHaveTextContent(/Customer lifecycle\s*3 steps/);
    expect(screen.getByTestId("trigger-hosts")).toHaveTextContent("http://127.0.0.1:4600");
    expect(screen.getByText(/Load is generated from the machine running the ApiPilot backend/)).toBeInTheDocument();
    const writes = screen.getByTestId("write-summary-trigger-list");
    expect(writes).toHaveTextContent("{{baseUrl}}/api/v1/customers");
    expect(writes).toHaveTextContent("Creates");
    // Each write is named by its URL, not by the step's internal id.
    expect(writes).not.toHaveTextContent(/\bs2\b/);
    expect(screen.getAllByTestId("write-summary-trigger")).toHaveLength(1);
  });

  it("says which chains the load run skips, because the Debug run runs every chain once", () => {
    const plan = lifecyclePlan();
    plan.chains = [...plan.chains, { ...plan.chains[0], id: "setup-only", name: "Setup only", steps: plan.chains[0].steps.map((step) => ({ ...step, id: `${step.id}-setup`, runs: "once-before-load" as const })) }];
    renderCard(runs(), { plan });
    expect(screen.getByTestId("trigger-chains")).toHaveTextContent("Setup only (once before load only; not in the load run)");
    expect(screen.getByTestId("trigger-chains")).not.toHaveTextContent("Customer lifecycle (");
  });

  it("lists the data sets the run reads", () => {
    const dataSet = { id: "d1", name: "customers", mode: "row-per-iteration" as const, columns: [], rowCount: 50, sizeBytes: 1, sha256: "a" };
    const plan = lifecyclePlan({ dataSets: [dataSet] });
    renderCard(runs(), { plan, analysis: analyzeChainPlan(plan, { environmentValueNames: ["baseUrl", "client_id"] }) });
    expect(screen.getByTestId("trigger-data-sets")).toHaveTextContent("customers · 50 rows");
  });

  it("starts a run on the named environment only on the engineer's click", () => {
    const state = runs();
    renderCard(state);
    expect(state.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start run on Local stub" }));
    expect(state.start).toHaveBeenCalledWith("e1");
  });

  it("opens Runs & reports once the run has started, and stays on Run setup when it did not", async () => {
    const started = renderCard(runs());
    fireEvent.click(screen.getByRole("button", { name: "Start run on Local stub" }));
    await waitFor(() => expect(started).toHaveBeenCalledTimes(1));
  });

  it("stays on Run setup when the run could not be started", async () => {
    const state = runs({ start: vi.fn(async () => false) });
    const onViewRuns = renderCard(state);
    fireEvent.click(screen.getByRole("button", { name: "Start run on Local stub" }));
    await waitFor(() => expect(state.start).toHaveBeenCalled());
    expect(onViewRuns).not.toHaveBeenCalled();
  });

  it.each([
    [{ script: null }, "Generate the script first."],
    [{ script: { ...SCRIPT, outOfDate: true } }, "The plan changed after the script was generated. Regenerate it first."],
    [{ environment: null }, "Choose the target environment."],
    [{ dirty: true }, "Saving your latest change…"],
  ])("says why a run cannot start (%j)", (props, reason) => {
    renderCard(runs(), props);
    expect(screen.getByTestId("run-blocked")).toHaveTextContent(reason);
    expect(screen.getByRole("button", { name: /Start run/ })).toBeDisabled();
  });
});
