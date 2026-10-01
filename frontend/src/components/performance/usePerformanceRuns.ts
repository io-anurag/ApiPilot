import { useCallback, useEffect, useRef, useState } from "react";
import type { K6Readiness, PerformanceRun, PerformanceRunStatus, PerformanceRunSummary } from "@apipilot/shared-domain";
import type { PerformanceRunsClient } from "../../services/performanceTestingClient";

/**
 * Readiness, the current run and the session's run history for one plan source (AP-029 FR-027 to
 * FR-035). Held by the plan screen so the run trigger (in the run-setup column) and the run
 * activity (in the Runs tab) share one state and one poll, whichever of them is on screen.
 *
 * AP-034 (specs/034 tasks T016): generic over the run, summary and start-input types, so a user
 * script's runs share the same polling and report hand-off. The defaults are the plan sources'
 * types, so every AP-029 and AP-032 caller is unchanged.
 */
export const RUN_POLL_INTERVAL_MS = 2_000;

export interface RunRecord {
  id: string;
  status: PerformanceRunStatus;
  result?: unknown;
}

export interface RunSummaryRecord {
  id: string;
  status: PerformanceRunStatus;
}

export interface PerformanceRuns<TRun extends RunRecord = PerformanceRun, TSummary extends RunSummaryRecord = PerformanceRunSummary, TStartInput = string> {
  readiness: K6Readiness | null;
  checking: boolean;
  checkReadiness: (recheck: boolean) => Promise<void>;
  run: TRun | null;
  /**
   * AP-033 FR-023 (amended 2026-09-30): the session's newest run that has ended with results, so
   * the plan can mark the steps that received statuses they do not expect. `null` until one exists.
   */
  latestFinished: TRun | null;
  inProgress: boolean;
  runs: TSummary[];
  reportRunId: string | null;
  showReport: (runId: string) => void;
  starting: boolean;
  cancelling: boolean;
  error: string | null;
  /** Resolves to `true` when the run started. */
  start: (input: TStartInput) => Promise<boolean>;
  cancel: () => Promise<void>;
}

export function usePerformanceRuns<TRun extends RunRecord = PerformanceRun, TSummary extends RunSummaryRecord = PerformanceRunSummary, TStartInput = string>(
  client: PerformanceRunsClient<TRun, TSummary, TStartInput>,
): PerformanceRuns<TRun, TSummary, TStartInput> {
  const { cancelRun, fetchReadiness, fetchRun, fetchRuns, startRun } = client;
  const [readiness, setReadiness] = useState<K6Readiness | null>(null);
  const [checking, setChecking] = useState(false);
  const [run, setRun] = useState<TRun | null>(null);
  const [latestFinished, setLatestFinished] = useState<TRun | null>(null);
  const [runs, setRuns] = useState<TSummary[]>([]);
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
      // Newest first (contract): the first run that ended, whether completed or cancelled.
      const ended = list.ok ? list.runs.find((candidate) => candidate.status === "completed" || candidate.status === "cancelled") : undefined;
      if (ended) {
        const detail = await fetchRun(ended.id);
        if (detail.ok && detail.run.result) setLatestFinished(detail.run);
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
        if (result.run.result) setLatestFinished(result.run);
        setReportRunId(result.run.id);
        void refreshRuns();
      }
    }, RUN_POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [run, refreshRuns, fetchRun]);

  async function start(input: TStartInput): Promise<boolean> {
    setStarting(true);
    setError(null);
    const result = await startRun(input);
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
    latestFinished,
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
