import { useCallback, useEffect, useRef, useState } from "react";
import type { K6Readiness, PerformanceRun, PerformanceRunSummary } from "@apipilot/shared-domain";
import type { PerformanceClient } from "../../services/performanceTestingClient";

/**
 * Readiness, the current run and the session's run history for one plan source (AP-029 FR-027 to
 * FR-035). Held by the plan screen so the run trigger (in the run-setup column) and the run
 * activity (in the Runs tab) share one state and one poll, whichever of them is on screen.
 */
export const RUN_POLL_INTERVAL_MS = 2_000;

export interface PerformanceRuns {
  readiness: K6Readiness | null;
  checking: boolean;
  checkReadiness: (recheck: boolean) => Promise<void>;
  run: PerformanceRun | null;
  inProgress: boolean;
  runs: PerformanceRunSummary[];
  reportRunId: string | null;
  showReport: (runId: string) => void;
  starting: boolean;
  cancelling: boolean;
  error: string | null;
  /** Resolves to `true` when the run started. */
  start: (environmentId: string) => Promise<boolean>;
  cancel: () => Promise<void>;
}

export function usePerformanceRuns(client: PerformanceClient): PerformanceRuns {
  const { cancelRun, fetchReadiness, fetchRun, fetchRuns, startRun } = client;
  const [readiness, setReadiness] = useState<K6Readiness | null>(null);
  const [checking, setChecking] = useState(false);
  const [run, setRun] = useState<PerformanceRun | null>(null);
  const [runs, setRuns] = useState<PerformanceRunSummary[]>([]);
  const [reportRunId, setReportRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshRuns = useCallback(async () => {
    const result = await fetchRuns();
    if (result.ok) setRuns(result.runs);
  }, [fetchRuns]);

  const checkReadiness = useCallback(
    async (recheck: boolean) => {
      setChecking(true);
      const result = await fetchReadiness(recheck);
      setChecking(false);
      setReadiness(result.ok ? result.readiness : null);
    },
    [fetchReadiness],
  );

  useEffect(() => {
    void checkReadiness(false);
    void refreshRuns().then(async () => {
      const list = await fetchRuns();
      const live = list.ok ? list.runs.find((candidate) => candidate.status === "in-progress") : undefined;
      if (live) {
        const detail = await fetchRun(live.id);
        if (detail.ok) setRun(detail.run);
      }
    });
  }, [checkReadiness, refreshRuns, fetchRuns, fetchRun]);

  useEffect(() => {
    if (run?.status !== "in-progress") return undefined;
    pollTimer.current = setTimeout(async () => {
      const result = await fetchRun(run.id);
      if (!result.ok) return;
      setRun(result.run);
      if (result.run.status !== "in-progress") {
        setCancelling(false);
        setReportRunId(result.run.id);
        void refreshRuns();
      }
    }, RUN_POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [run, refreshRuns, fetchRun]);

  async function start(environmentId: string): Promise<boolean> {
    setStarting(true);
    setError(null);
    const result = await startRun(environmentId);
    setStarting(false);
    if (!result.ok) {
      setError(result.error === "execution_in_progress" ? "Another run is in progress in this session. Nothing was sent." : result.message);
      if (result.readiness) setReadiness(result.readiness);
      return false;
    }
    setReportRunId(null);
    setRun(result.run);
    void refreshRuns();
    return true;
  }

  async function cancel() {
    if (!run) return;
    setCancelling(true);
    const result = await cancelRun(run.id);
    if (result.ok) setRun(result.run);
    else setCancelling(false);
  }

  return {
    readiness,
    checking,
    checkReadiness,
    run,
    inProgress: run?.status === "in-progress",
    runs,
    reportRunId,
    showReport: setReportRunId,
    starting,
    cancelling,
    error,
    start,
    cancel,
  };
}
