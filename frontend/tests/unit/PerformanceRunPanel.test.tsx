import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Environment, PerformancePlan, ScriptStatus } from "@apipilot/shared-domain";
import { PerformanceRunActivity, PerformanceRunTrigger } from "../../src/components/performance/PerformanceRunPanel";
import type { RestoreOutcome } from "../../src/components/performance/restoreFromRun";
import { RUN_POLL_INTERVAL_MS, usePerformanceRuns } from "../../src/components/performance/usePerformanceRuns";
import { guidedPerformanceClient } from "../../src/services/performanceTestingClient";
import { environment, readyPlan, runFixture, script, stubFetch } from "./performanceFixtures";

/** AP-029 US2 run trigger and activity, and US3 report frame (tasks T061, T075). */

/** The trigger and the activity sharing one run state, as the plan screen composes them. */
function PerformanceRunPanel({
  plan,
  script: status,
  environment: target,
  environments = target ? [target] : [],
  onRestore,
}: Readonly<{
  plan: PerformancePlan;
  script: ScriptStatus | null;
  environment: Environment | null;
  environments?: Environment[];
  onRestore?: (runId: string) => Promise<RestoreOutcome>;
}>) {
  const runs = usePerformanceRuns(guidedPerformanceClient);
  return (
    <>
      <PerformanceRunTrigger runs={runs} plan={plan} script={status} environment={target} />
      <PerformanceRunActivity runs={runs} client={guidedPerformanceClient} plan={plan} script={status} environments={environments} onRestore={onRestore} />
    </>
  );
}

/** A run as `GET /runs` lists it: a summary, without the plan snapshot. */
function listed(overrides: Parameters<typeof runFixture>[0] = {}) {
  return { ...runFixture({ status: "completed", ...overrides }), planSnapshot: undefined };
}

const BASE = "/api/test-generation-workflow/performance";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function routes(extra: Parameters<typeof stubFetch>[0] = {}) {
  return {
    [`GET ${BASE}/readiness`]: () => [200, { readiness: { state: "ready", version: "1.2.0", checkedAt: "x" } }] as [number, unknown],
    [`GET ${BASE}/runs`]: () => [200, { runs: [] }] as [number, unknown],
    ...extra,
  };
}

describe("PerformanceRunPanel", () => {
  it("disables the trigger with k6's reason while k6 is unavailable, and re-checks on request (FR-027, SC-012)", async () => {
    const calls = stubFetch(routes({ [`GET ${BASE}/readiness`]: () => [200, { readiness: { state: "unavailable", reason: "not-found", checkedAt: "x" } }] }));
    render(<PerformanceRunPanel plan={readyPlan()} script={script()} environment={environment()} />);
    expect(await screen.findByTestId("k6-readiness-error")).toHaveTextContent("k6 was not found.");
    expect(screen.getByText("The script can still be downloaded and run outside ApiPilot.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run on perf-local (local)" })).toBeDisabled();
    expect(screen.getByText("k6 is not available.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("readiness?recheck=true"))).toBe(true));
  });

  it("names the target and states where load comes from, with the stages exactly as entered (FR-019, FR-025, FR-028)", async () => {
    stubFetch(routes());
    const plan = { ...readyPlan(), loadProfile: { kind: "load" as const, stages: [{ durationMs: 90_000, targetVirtualUsers: 25_000 }], plannedDurationMs: 90_000 } };
    render(<PerformanceRunPanel plan={plan} script={script()} environment={environment({ name: "payments-prod", tier: "production", baseUrl: "https://pay.example.test" })} />);
    const target = await screen.findByRole("region", { name: "Run target" });
    expect(within(target).getByRole("button", { name: "Run on payments-prod (production)" })).toBeInTheDocument();
    expect(target).toHaveTextContent("Tier: production");
    expect(target).toHaveTextContent("https://pay.example.test");
    expect(target).toHaveTextContent("Load is generated from the machine running the ApiPilot backend.");
    expect(target).toHaveTextContent("90 s → 25000");
  });

  it("lists every write operation beside the trigger that names the target (AP-032 FR-011, SC-002)", async () => {
    stubFetch(routes());
    render(<PerformanceRunPanel plan={readyPlan()} script={script()} environment={environment()} />);
    const target = await screen.findByRole("region", { name: "Run target" });
    const writes = within(target).getByRole("region", { name: "Write operations this run sends" });
    expect(writes).toHaveTextContent("1 write operation will be sent");
    expect(writes).toHaveTextContent("/orders");
    expect(writes).toHaveTextContent("Creates");
    expect(writes.querySelector("details")).toBeNull();
  });

  it("disables the trigger for an out-of-date script, with the reason", async () => {
    stubFetch(routes());
    render(<PerformanceRunPanel plan={readyPlan()} script={script({ outOfDate: true })} environment={environment()} />);
    await screen.findByText("k6 ready");
    expect(screen.getByRole("button", { name: "Run on perf-local (local)" })).toBeDisabled();
    expect(screen.getByText("The plan changed after the script was generated. Regenerate it to run.")).toBeInTheDocument();
  });

  it("starts on the trigger, polls progress every 2 s with the per-step table, cancels, and presents the report when it ends (FR-030, FR-031, FR-035)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let phase: "running" | "cancelling" | "done" = "running";
    const progress = {
      elapsedMs: 12_000,
      currentVirtualUsers: 3,
      requestsSoFar: 42,
      failuresSoFar: 2,
      journeysCutShortSoFar: 1,
      tokenRefreshesSoFar: 0,
      steps: [
        { stepId: "s-create", requests: 20, failures: 2, notSent: { missingData: 0, dependencyNotAttempted: 0 } },
        { stepId: "s-warehouse", requests: 0, failures: 0, notSent: { missingData: 20, dependencyNotAttempted: 0 } },
      ],
    };
    const calls = stubFetch(
      routes({
        [`POST ${BASE}/runs`]: () => [200, { run: runFixture() }],
        [`GET ${BASE}/runs/run-12345678`]: () =>
          [200, { run: phase === "done" ? runFixture({ status: "cancelled", cancelReason: "user-requested", progress }) : runFixture({ progress, cancelRequested: phase === "cancelling" }) }],
        [`POST ${BASE}/runs/run-12345678/cancel`]: () => {
          phase = "cancelling";
          return [202, { run: runFixture({ progress, cancelRequested: true }) }];
        },
        [`GET ${BASE}/runs/run-12345678/report`]: () => [200, "<!doctype html><p>report</p>"],
      }),
    );
    try {
      render(<PerformanceRunPanel plan={readyPlan()} script={script()} environment={environment()} />);
      fireEvent.click(await screen.findByRole("button", { name: "Run on perf-local (local)" }));
      expect(await screen.findByRole("heading", { name: /Run run-1234/ })).toBeInTheDocument();
      expect(calls.find((call) => call.method === "POST" && call.url.endsWith("/runs"))?.body).toEqual({ environmentId: "env-1" });

      await act(async () => vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS + 50));
      expect(screen.getByText("Requests so far").nextSibling).toHaveTextContent("42");
      expect(screen.getByText("Journeys cut short").nextSibling).toHaveTextContent("1");
      const table = screen.getByRole("table", { name: "Progress by step" });
      expect(within(table).getByText("/warehouses/{warehouseId}").closest("tr")).toHaveTextContent("Missing data × 20");
      expect(screen.getByRole("region", { name: "Run target" })).toHaveTextContent("perf-local");

      fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
      expect(await screen.findByRole("button", { name: "Cancelling…" })).toBeDisabled();
      phase = "done";
      await act(async () => vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS + 50));
      const frame = await screen.findByTitle("Performance report for run run-1234");
      expect(frame.tagName).toBe("IFRAME");
      expect(frame.getAttribute("sandbox")).toBe("");
      expect(frame.getAttribute("srcdoc")).toContain("report");
      expect(screen.getByRole("link", { name: "Download report (HTML)" })).toHaveAttribute("href", `${BASE}/runs/run-12345678/report?download=true`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says another run is in progress when the slot is taken (FR-029)", async () => {
    stubFetch(routes({ [`POST ${BASE}/runs`]: () => [409, { error: "execution_in_progress", message: "busy", runId: "other" }] }));
    render(<PerformanceRunPanel plan={readyPlan()} script={script()} environment={environment()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Run on perf-local (local)" }));
    expect(await screen.findByTestId("performance-run-error")).toHaveTextContent("Another run is in progress in this session. Nothing was sent.");
  });

  it("lists past runs with status as text and opens a past report", async () => {
    stubFetch(
      routes({
        [`GET ${BASE}/runs`]: () => [200, { runs: [{ ...runFixture({ status: "cancelled", cancelReason: "backend-restart" }), planSnapshot: undefined }] }],
        [`GET ${BASE}/runs/run-12345678/report`]: () => [500, { error: "internal_server_error" }],
      }),
    );
    render(<PerformanceRunPanel plan={readyPlan()} script={script()} environment={environment()} />);
    expect(await screen.findByText("Cancelled · backend restart")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View report" }));
    expect(await screen.findByTestId("performance-report-error")).toHaveTextContent("The report could not be loaded.");
  });

  it("names the chosen environment, not an ended run's, once a run has ended (FR-025)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let done = false;
    stubFetch(
      routes({
        [`POST ${BASE}/runs`]: () => [200, { run: runFixture() }],
        [`GET ${BASE}/runs/run-12345678`]: () => [200, { run: runFixture(done ? { status: "completed" } : {}) }],
        [`GET ${BASE}/runs/run-12345678/report`]: () => [200, "<!doctype html><p>report</p>"],
      }),
    );
    try {
      const qa = environment({ id: "env-qa", name: "QA_Run", tier: "qa" });
      const { rerender } = render(<PerformanceRunPanel plan={readyPlan()} script={script()} environment={environment()} environments={[environment(), qa]} />);
      fireEvent.click(await screen.findByRole("button", { name: "Run on perf-local (local)" }));
      await screen.findByTestId("live-run-target");
      done = true;
      await act(async () => vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS + 50));
      await screen.findByTitle("Performance report for run run-1234");
      rerender(<PerformanceRunPanel plan={readyPlan()} script={script()} environment={qa} environments={[environment(), qa]} />);
      expect(screen.getByRole("button", { name: "Run on QA_Run (qa)" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Run on perf-local (local)" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  describe("runs the last run again on the user's trigger (FR-024, FR-025)", () => {
    const qaTarget = { id: "env-qa", name: "QA_Run", tier: "qa" as const, baseUrl: "https://qa.example.test" };
    const qa = environment(qaTarget);

    it("repeats the last run's environment, naming it, whichever environment Run setup has chosen", async () => {
      const calls = stubFetch(
        routes({
          [`GET ${BASE}/runs`]: () => [200, { runs: [listed({ id: "run-newest01", environment: qaTarget }), listed()] }],
          [`GET ${BASE}/runs/run-newest01`]: () => [200, { run: runFixture({ id: "run-newest01", status: "completed", environment: qaTarget }) }],
          [`POST ${BASE}/runs`]: () => [200, { run: runFixture({ id: "run-again001", environment: qaTarget }) }],
        }),
      );
      render(<PerformanceRunPanel plan={readyPlan()} script={script()} environment={environment()} environments={[environment(), qa]} />);
      const rerun = await screen.findByRole("region", { name: "Run again" });
      expect(rerun).toHaveTextContent("Repeats run run-newe");
      expect(rerun).toHaveTextContent("Tier: qa");
      expect(rerun).toHaveTextContent("https://qa.example.test");
      expect(within(rerun).getByRole("region", { name: "Write operations this run sends" })).toHaveTextContent("1 write operation will be sent");
      const button = within(rerun).getByRole("button", { name: "Run again on QA_Run (qa)" });
      await waitFor(() => expect(button).toBeEnabled());
      expect(calls.some((call) => call.method === "POST")).toBe(false);

      fireEvent.click(button);
      await waitFor(() => expect(calls.find((call) => call.method === "POST" && call.url.endsWith("/runs"))?.body).toEqual({ environmentId: "env-qa" }));
      expect(await screen.findByTestId("live-run-target")).toHaveTextContent("QA_Run");
      expect(screen.queryByRole("region", { name: "Run again" })).not.toBeInTheDocument();
    });

    it("is unavailable, with the reason, once the plan changed since that run", async () => {
      stubFetch(routes({ [`GET ${BASE}/runs`]: () => [200, { runs: [listed({ scriptSha256: "0000000011111111" })] }] }));
      render(<PerformanceRunPanel plan={readyPlan()} script={script()} environment={environment()} />);
      const rerun = await screen.findByRole("region", { name: "Run again" });
      expect(within(rerun).getByRole("button", { name: "Run again on perf-local (local)" })).toBeDisabled();
      expect(rerun).toHaveTextContent("The plan changed since run run-1234.");
    });

    it("offers to restore that run's settings once the plan changed, and shows what was restored (FR-024b)", async () => {
      stubFetch(routes({ [`GET ${BASE}/runs`]: () => [200, { runs: [listed()] }] }));
      const onRestore = vi.fn(async () => ({ ok: true, message: "Restored run run-1234's removed operations, order, load profile, think time, thresholds and expected statuses." }));
      render(<PerformanceRunPanel plan={readyPlan()} script={null} environment={environment()} onRestore={onRestore} />);
      const rerun = await screen.findByRole("region", { name: "Run again" });
      expect(rerun).toHaveTextContent("A backend restart, a new upload or a reset rebuilds the plan with its defaults.");
      fireEvent.click(within(rerun).getByRole("button", { name: "Restore run run-1234's settings" }));
      expect(onRestore).toHaveBeenCalledWith("run-12345678");
      expect(await within(rerun).findByTestId("rerun-restore-outcome")).toHaveTextContent("Restored run run-1234's removed operations");
    });

    it("does not offer a restore while the plan is the one that run used", async () => {
      stubFetch(routes({ [`GET ${BASE}/runs`]: () => [200, { runs: [listed()] }] }));
      render(<PerformanceRunPanel plan={readyPlan()} script={script()} environment={environment()} onRestore={vi.fn()} />);
      const rerun = await screen.findByRole("region", { name: "Run again" });
      expect(within(rerun).queryByRole("button", { name: /Restore run/ })).not.toBeInTheDocument();
    });

    it("says the plan changed, not only that a script is missing, once the plan was rebuilt since that run", async () => {
      stubFetch(routes({ [`GET ${BASE}/runs`]: () => [200, { runs: [listed()] }] }));
      render(<PerformanceRunPanel plan={readyPlan()} script={null} environment={environment()} />);
      const rerun = await screen.findByRole("region", { name: "Run again" });
      expect(within(rerun).getByRole("button", { name: "Run again on perf-local (local)" })).toBeDisabled();
      expect(rerun).toHaveTextContent("The plan changed since run run-1234.");
      expect(rerun).not.toHaveTextContent("Generate the script first.");
    });

    it("is unavailable, with the reason, when that run's environment no longer exists", async () => {
      stubFetch(routes({ [`GET ${BASE}/runs`]: () => [200, { runs: [listed({ environment: { id: "env-gone", name: "old", tier: "dev", baseUrl: "http://old.test" } })] }] }));
      render(<PerformanceRunPanel plan={readyPlan()} script={script()} environment={environment()} />);
      const rerun = await screen.findByRole("region", { name: "Run again" });
      expect(within(rerun).getByRole("button", { name: "Run performance test" })).toBeDisabled();
      expect(rerun).toHaveTextContent("The environment run run-1234 used no longer exists.");
    });

    it("is not offered while the newest run is in progress", async () => {
      stubFetch(
        routes({
          [`GET ${BASE}/runs`]: () => [200, { runs: [listed({ status: "in-progress" })] }],
          [`GET ${BASE}/runs/run-12345678`]: () => [200, { run: runFixture() }],
        }),
      );
      render(<PerformanceRunPanel plan={readyPlan()} script={script()} environment={environment()} />);
      expect(await screen.findByTestId("live-run-target")).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Run again" })).not.toBeInTheDocument();
    });
  });
});
