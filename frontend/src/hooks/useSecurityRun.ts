import { useCallback, useEffect, useRef, useState } from "react";
import type { RunDetail } from "@apipilot/shared-domain";
import { fetchRun } from "../services/securityLabClient";

export const RUN_POLL_INTERVAL_MS = 1000;

export interface RunPollError {
  readonly code: string;
  readonly message: string;
}

export interface UseSecurityRun {
  /** The last reply received; kept while a newer one loads, and after an error, so results never blank. */
  readonly detail: RunDetail | null;
  /** The latest poll failed. Cleared by the next successful poll. */
  readonly error: RunPollError | null;
  /** True while the hook is still polling, or waiting for its next poll. False once the run is final, or polling has stopped on an error. */
  readonly polling: boolean;
  /** Polls again at once after polling stopped on an error. */
  readonly retry: () => void;
  /** Reads the run now, outside the one-second cadence (after a cancel, so the change shows without waiting). */
  readonly refreshNow: () => void;
}

/** Errors a repeat poll cannot fix: the run does not exist (or is not this owner's). Everything else may be transient. */
const STOPPING_ERRORS: ReadonlySet<string> = new Set(["run_not_found"]);

/**
 * Follows one security run (specs/057 FR-044, contracts "Runs"): reads `GET /runs/:id` once a second until the run is
 * final. The next read is scheduled only after the previous one has settled, so two reads are never in flight at
 * once, and an aborted read never reports. A failed read is shown as an error and the next read is still scheduled
 * (the run is still executing on the server), except when the run is not found, when polling stops and `retry`
 * resumes it. A final status (completed, cancelled, failed) stops polling. This is a security-run follower of its own:
 * it does not change `LiveRunKind` or any other run kind.
 */
export function useSecurityRun(runId: string | null, intervalMs: number = RUN_POLL_INTERVAL_MS): UseSecurityRun {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<RunPollError | null>(null);
  const [polling, setPolling] = useState(false);
  const [token, setToken] = useState(0);
  const [nudge, setNudge] = useState(0);
  const nudgeHandler = useRef<(() => void) | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
  }, [runId]);

  useEffect(() => {
    if (runId === null) {
      setPolling(false);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setPolling(true);

    const poll = async (): Promise<void> => {
      timer = undefined;
      let result: Awaited<ReturnType<typeof fetchRun>>;
      try {
        result = await fetchRun(runId, { signal: controller.signal });
      } catch {
        return; // Aborted: superseded or unmounted, so nothing is reported.
      }
      if (stopped) return;
      if (result.ok) {
        setDetail(result.data);
        setError(null);
        if (result.data.run.status !== "in-progress") {
          setPolling(false);
          return;
        }
      } else {
        setError({ code: result.error, message: result.message });
        if (STOPPING_ERRORS.has(result.error)) {
          setPolling(false);
          return;
        }
      }
      timer = setTimeout(() => void poll(), intervalMs);
    };

    // A read now replaces the waiting timer; one already in flight is left to finish, so reads never overlap.
    nudgeHandler.current = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      void poll();
    };
    void poll();

    return () => {
      stopped = true;
      nudgeHandler.current = null;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [runId, intervalMs, token]);

  useEffect(() => {
    if (nudge > 0) nudgeHandler.current?.();
  }, [nudge]);

  const retry = useCallback(() => setToken((current) => current + 1), []);
  const refreshNow = useCallback(() => setNudge((current) => current + 1), []);
  return { detail, error, polling, retry, refreshNow };
}
