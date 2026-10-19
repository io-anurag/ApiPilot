import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioOutcomeKind } from "@apipilot/shared-domain";
import { SCENARIO_OUTCOME_KINDS } from "@apipilot/shared-domain";
import { RunProgress } from "../../../src/components/securityLab/RunProgress";
import * as client from "../../../src/services/securityLabClient";
import { cleanupEntry, runDetail, scenarioResult } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  fetchRun: vi.fn(),
  cancelRun: vi.fn(),
}));

const fetchRun = vi.mocked(client.fetchRun);
const cancelRun = vi.mocked(client.cancelRun);

const TITLES = { "ss-1": "Reject a request with no credentials", "ss-2": "Reject an expired token" };
const PLAN = [
  { scenarioId: "ss-1", version: 1, plannedRequests: 1 },
  { scenarioId: "ss-2", version: 1, plannedRequests: 1 },
];

function show(detail: ReturnType<typeof runDetail>) {
  fetchRun.mockResolvedValue({ ok: true, data: detail });
}

function renderProgress(props: Partial<React.ComponentProps<typeof RunProgress>> = {}) {
  return render(<RunProgress runId="run-1" titles={TITLES} {...props} />);
}

beforeEach(() => {
  fetchRun.mockReset();
  cancelRun.mockReset();
});

describe("RunProgress (T107, FR-044 to FR-047)", () => {
  it("shows a loading state, then the run", async () => {
    show(runDetail({ run: { status: "completed", plan: PLAN }, results: [scenarioResult()] }));
    renderProgress();
    expect(screen.getByRole("status", { name: "Reading the run" })).toBeInTheDocument();
    expect(await screen.findByTestId("run-progress")).toBeInTheDocument();
    expect(screen.getByText(/Run started 2026-10-18 10:00 UTC/)).toBeInTheDocument();
  });

  it("shows a run that cannot be read as an error with a retry, not as nothing", async () => {
    fetchRun.mockResolvedValueOnce({ ok: false, error: "run_not_found", message: "No security run with id run-1 was found.", status: 404, details: {} });
    renderProgress();
    const error = await screen.findByTestId("run-progress-error");
    expect(error).toHaveTextContent("No security run with id run-1 was found.");
    fetchRun.mockResolvedValue({ ok: true, data: runDetail({ run: { status: "completed" }, results: [scenarioResult()] }) });
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("run-progress")).toBeInTheDocument();
  });

  it.each(SCENARIO_OUTCOME_KINDS)("shows a %s result as a text badge with what it does and does not mean", async (outcome: ScenarioOutcomeKind) => {
    show(runDetail({ run: { status: "completed" }, results: [scenarioResult({ outcome, reason: `Reason for ${outcome}` })] }));
    renderProgress();
    const row = await screen.findByTestId("run-result-row");
    expect(row).toHaveAttribute("data-outcome", outcome);
    const badge = within(row).getByTestId("status-badge");
    expect(badge.textContent).toBe({ passed: "Passed", failed: "Failed", inconclusive: "Inconclusive", blocked: "Blocked", errored: "Errored", not_run: "Not run" }[outcome]);
    expect(within(row).getByText(`Reason for ${outcome}`)).toBeInTheDocument();
    if (outcome === "blocked" || outcome === "errored" || outcome === "not_run") {
      expect(row).toHaveTextContent(/This is not a pass\./);
      expect(badge.textContent).not.toBe("Passed");
    }
    if (outcome === "passed") expect(row).toHaveTextContent("This is not proof that the API is secure.");
    if (outcome === "failed") expect(row).toHaveTextContent("a potential finding to review");
  });

  it("names each result's scenario by title, its version and what was observed", async () => {
    show(runDetail({ run: { status: "completed" }, results: [scenarioResult({ version: 3, evidenceCount: 2, durationMs: 40, observed: { responseStatus: 403, responseHeadersSelected: {}, statement: "The response status was 403.", truncated: true } })] }));
    renderProgress();
    const row = await screen.findByTestId("run-result-row");
    expect(within(row).getByText("Reject a request with no credentials")).toBeInTheDocument();
    expect(within(row).getByText("Version 3")).toBeInTheDocument();
    expect(row).toHaveTextContent("Status 403. The response status was 403. (response truncated)");
    expect(row).toHaveTextContent("2 requests, 40 ms");
  });

  it("counts outcomes as text", async () => {
    show(runDetail({ run: { status: "completed", summary: { passed: 3, failed: 1, inconclusive: 0, blocked: 2, errored: 0, not_run: 1 } }, results: [scenarioResult()] }));
    renderProgress();
    const counts = await screen.findByTestId("run-summary-counts");
    expect(counts).toHaveTextContent("Passed: 3");
    expect(counts).toHaveTextContent("Failed: 1");
    expect(counts).toHaveTextContent("Blocked: 2");
    expect(counts).toHaveTextContent("Not run: 1");
  });

  it("shows how far an in-progress run has got, and offers Cancel", async () => {
    show(runDetail({ run: { status: "in-progress", plan: PLAN, budget: { planned: 4, used: 1 } }, results: [scenarioResult()] }));
    renderProgress();
    expect(await screen.findByTestId("run-progress-text")).toHaveTextContent("1 of 2 scenarios finished. 1 of 4 planned requests used.");
    expect(screen.getByRole("progressbar", { name: "Scenarios finished" })).toHaveAttribute("value", "1");
    expect(screen.getByTestId("run-status-text")).toHaveTextContent("Requests are being sent to the target.");
    expect(screen.getByRole("button", { name: "Cancel run" })).toBeInTheDocument();
  });

  describe("polling", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("follows the run once a second until it is final, then stops, and reports it finished once", async () => {
      fetchRun
        .mockResolvedValueOnce({ ok: true, data: runDetail({ run: { status: "in-progress", plan: PLAN } }) })
        .mockResolvedValueOnce({ ok: true, data: runDetail({ run: { status: "in-progress", plan: PLAN }, results: [scenarioResult()] }) })
        .mockResolvedValue({ ok: true, data: runDetail({ run: { status: "completed", plan: PLAN }, results: [scenarioResult(), scenarioResult({ id: "res-2", scenarioId: "ss-2" })] }) });
      const onFinished = vi.fn();
      renderProgress({ onFinished });
      await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
      expect(screen.getByTestId("run-progress-text")).toHaveTextContent("0 of 2 scenarios finished");
      expect(onFinished).not.toHaveBeenCalled();
      await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
      expect(screen.getByTestId("run-progress-text")).toHaveTextContent("1 of 2 scenarios finished");
      await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
      expect(screen.getByTestId("run-progress-text")).toHaveTextContent("2 of 2 scenarios finished");
      expect(screen.getByText("Completed")).toBeInTheDocument();
      expect(onFinished).toHaveBeenCalledTimes(1);
      expect(onFinished.mock.calls[0][0].run.status).toBe("completed");
      await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
      expect(fetchRun).toHaveBeenCalledTimes(3);
      expect(onFinished).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "Cancel run" })).not.toBeInTheDocument();
    });

    it("keeps the last results and says the latest read failed and that it is trying again", async () => {
      fetchRun
        .mockResolvedValueOnce({ ok: true, data: runDetail({ run: { status: "in-progress", plan: PLAN }, results: [scenarioResult()] }) })
        .mockResolvedValueOnce({ ok: false, error: "network_error", message: "The Security Lab service is unreachable.", status: 0, details: {} });
      renderProgress();
      await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
      await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
      const error = screen.getByTestId("run-progress-error");
      expect(error).toHaveTextContent("The latest read of this run failed");
      expect(error).toHaveTextContent("The Security Lab service is unreachable. Trying again.");
      expect(screen.getAllByTestId("run-result-row")).toHaveLength(1);
    });
  });

  describe("cancel", () => {
    it("asks first, and cancels nothing when the confirmation is dismissed", async () => {
      show(runDetail({ run: { status: "in-progress", plan: PLAN } }));
      renderProgress();
      fireEvent.click(await screen.findByRole("button", { name: "Cancel run" }));
      const dialog = await screen.findByTestId("confirm-dialog");
      expect(dialog).toHaveTextContent("Cancel this run?");
      expect(dialog).toHaveTextContent("Requests already sent cannot be recalled.");
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(cancelRun).not.toHaveBeenCalled();
      expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    });

    it("cancels the run when confirmed and reads the run again at once", async () => {
      show(runDetail({ run: { status: "in-progress", plan: PLAN } }));
      cancelRun.mockResolvedValue({ ok: true, data: { run: runDetail().run } });
      renderProgress();
      fireEvent.click(await screen.findByRole("button", { name: "Cancel run" }));
      fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByRole("button", { name: "Cancel run (2)" }));
      await waitFor(() => expect(cancelRun).toHaveBeenCalledWith("run-1"));
      await waitFor(() => expect(fetchRun.mock.calls.length).toBeGreaterThanOrEqual(2));
    });

    it("says a cancel is requested and removes the Cancel button while the run winds down", async () => {
      show(runDetail({ run: { status: "in-progress", cancelRequested: true, cancelReason: "user-requested", plan: PLAN } }));
      renderProgress();
      expect(await screen.findByTestId("run-status-text")).toHaveTextContent("Cancel requested: the run stops after the requests already in flight.");
      expect(screen.queryByRole("button", { name: "Cancel run" })).not.toBeInTheDocument();
    });

    it("shows a cancel that was refused", async () => {
      show(runDetail({ run: { status: "in-progress", plan: PLAN } }));
      cancelRun.mockResolvedValue({ ok: false, error: "no_run_in_progress", message: "This run is not in progress, so there is nothing to cancel.", status: 409, details: {} });
      renderProgress();
      fireEvent.click(await screen.findByRole("button", { name: "Cancel run" }));
      fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByRole("button", { name: "Cancel run (2)" }));
      expect(await screen.findByTestId("run-cancel-error")).toHaveTextContent("This run is not in progress, so there is nothing to cancel.");
    });
  });

  describe("partial results", () => {
    it("says a cancelled run is partial and lists the scenarios that were never run, as not run and not a pass", async () => {
      show(runDetail({ run: { status: "cancelled", cancelRequested: true, cancelReason: "user-requested", plan: PLAN }, results: [scenarioResult()] }));
      renderProgress();
      const partial = await screen.findByTestId("run-partial");
      expect(partial).toHaveTextContent("Partial results: 1 of 2 scenarios have a result.");
      expect(partial).toHaveTextContent("Not run is not a pass.");
      expect(screen.getByTestId("run-status-text")).toHaveTextContent("The run was stopped before it finished. The results below are partial.");
      const rows = screen.getAllByTestId("run-result-row");
      expect(rows).toHaveLength(2);
      expect(rows[1]).toHaveAttribute("data-recorded", "false");
      expect(within(rows[1]).getByText("Reject an expired token")).toBeInTheDocument();
      expect(within(rows[1]).getByText("Not run")).toBeInTheDocument();
      expect(rows[1]).toHaveTextContent("No result was recorded: the run ended before this scenario was attempted.");
      expect(rows[1]).toHaveTextContent("No request was sent for it.");
      expect(rows[1]).toHaveTextContent("This is not a pass.");
    });

    it("says a failed run is partial too", async () => {
      show(runDetail({ run: { status: "failed", plan: PLAN }, results: [] }));
      renderProgress();
      expect(await screen.findByTestId("run-partial")).toHaveTextContent("Partial results: 0 of 2 scenarios have a result.");
      expect(screen.getByText("Failed")).toBeInTheDocument();
      expect(screen.getAllByTestId("run-result-row")).toHaveLength(2);
    });

    it("says a run cancelled by a backend restart was", async () => {
      show(runDetail({ run: { status: "cancelled", cancelReason: "backend-restart", plan: PLAN } }));
      renderProgress();
      expect(await screen.findByTestId("run-status-text")).toHaveTextContent("The backend restarted while this run was in progress, so it was cancelled.");
    });

    it("does not call a completed run partial", async () => {
      show(runDetail({ run: { status: "completed" }, results: [scenarioResult()] }));
      renderProgress();
      await screen.findByTestId("run-progress");
      expect(screen.queryByTestId("run-partial")).not.toBeInTheDocument();
    });
  });

  describe("cleanup (FR-047)", () => {
    it("shows what cleanup did, each entry's state as text", async () => {
      show(runDetail({ run: { status: "completed", cleanup: [cleanupEntry(), cleanupEntry({ state: "skipped", action: "DELETE /orders/43", detail: "No id was returned." })] }, results: [scenarioResult()] }));
      renderProgress();
      const entries = await screen.findAllByTestId("cleanup-entry");
      expect(within(entries[0]).getByText("Done")).toBeInTheDocument();
      expect(within(entries[1]).getByText("Skipped")).toBeInTheDocument();
      expect(within(entries[0]).getByText(/Reject a request with no credentials: DELETE \/orders\/42/)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("warns when cleanup failed, and says what was left behind and how to remove it by hand", async () => {
      show(
        runDetail({
          run: {
            status: "completed",
            cleanup: [cleanupEntry({ state: "failed", detail: "The delete returned 500.", leftBehind: "Order 42 created by the scenario", manualRemoval: "Delete order 42 with DELETE /orders/42." })],
          },
          results: [scenarioResult()],
        }),
      );
      renderProgress();
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Cleanup did not finish for 1 item. Data created by this run may remain on the target.");
      const entry = screen.getByTestId("cleanup-entry");
      expect(within(entry).getByText("Failed")).toBeInTheDocument();
      expect(entry).toHaveTextContent("The delete returned 500.");
      expect(entry).toHaveTextContent("Left behind: Order 42 created by the scenario");
      expect(entry).toHaveTextContent("To remove it yourself: Delete order 42 with DELETE /orders/42.");
    });

    it("shows no cleanup section when nothing was cleaned up", async () => {
      show(runDetail({ run: { status: "completed" }, results: [scenarioResult()] }));
      renderProgress();
      await screen.findByTestId("run-progress");
      expect(screen.queryByTestId("run-cleanup")).not.toBeInTheDocument();
    });
  });

  it("offers an extension point under each result, for findings", async () => {
    show(runDetail({ run: { status: "completed" }, results: [scenarioResult({ id: "res-7" })] }));
    renderProgress({ renderResultExtra: (result) => <a href={`#/finding/${result.id}`}>Findings for {result.id}</a> });
    expect(await screen.findByRole("link", { name: "Findings for res-7" })).toBeInTheDocument();
  });

  it("offers to close the results once the run is final, and not before", async () => {
    show(runDetail({ run: { status: "in-progress", plan: PLAN } }));
    const onDismiss = vi.fn();
    const view = renderProgress({ onDismiss });
    await screen.findByTestId("run-progress");
    expect(screen.queryByRole("button", { name: "Close results" })).not.toBeInTheDocument();
    view.unmount();
    show(runDetail({ run: { status: "completed" }, results: [scenarioResult()] }));
    renderProgress({ onDismiss });
    fireEvent.click(await screen.findByRole("button", { name: "Close results" }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
