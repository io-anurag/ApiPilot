import { useEffect, useRef, useState } from "react";
import type { LivePoint, LiveRunKind, LiveRunSnapshot, LiveSeries } from "@apipilot/shared-domain";
import { fetchLiveRun } from "../../services/liveRunClient";

/** One poll a second (AP-045 research R3). */
export const LIVE_POLL_INTERVAL_MS = 1_000;
/** No successful reply for this long marks the figures stale. */
export const LIVE_STALE_AFTER_MS = 10_000;

export type LiveRunStatus = "loading" | "live" | "stale" | "completed" | "cancelled" | "failed" | "error";

export interface LiveRunView {
  status: LiveRunStatus;
  /** The last good reply; its `series.points` are the merged series, never only the newest points. */
  snapshot: LiveRunSnapshot | null;
  /** Epoch milliseconds (from `now`) of the last good reply; null before the first. */
  lastGoodAt: number | null;
  /** The failure behind `error`, or the latest failure while `stale`. */
  error: { code: string; message: string } | null;
}

export interface UseLiveRunOptions {
  kind: LiveRunKind;
  runId: string;
  collectionId?: string;
  intervalMs?: number;
  staleAfterMs?: number;
  /** Injectable clock for the "stale since" time. */
  now?: () => number;
}

const INITIAL: LiveRunView = { status: "loading", snapshot: null, lastGoodAt: null, error: null };

/** Replaces the point of the same second, keeps every other, in second order. */
export function mergePoints(held: readonly LivePoint[], incoming: readonly LivePoint[]): LivePoint[] {
  const bySecond = new Map<number, LivePoint>();
  for (const point of held) bySecond.set(point.second, point);
  for (const point of incoming) bySecond.set(point.second, point);
  return [...bySecond.values()].sort((a, b) => a.second - b.second);
}

function withSeries(snapshot: LiveRunSnapshot, points: LivePoint[]): LiveRunSnapshot {
  const series: LiveSeries = { ...snapshot.series, points };
  return { ...snapshot, series };
}

/**
 * Polls one run's live figures (AP-045 FR-001, FR-007, FR-008). Polls never overlap (the next one is
 * scheduled after the previous reply), `since` is the reply's `nextSince` (0 on a fresh mount, which
 * restores the run so far), and the points are merged by `second`; a changed `bucketSeconds` means the
 * server sent the whole series, so the held points are replaced. Polling stops on a final state and
 * on a refusal that retrying cannot fix; it keeps going through lost connections and server faults.
 */
export function useLiveRun({ kind, runId, collectionId, intervalMs = LIVE_POLL_INTERVAL_MS, staleAfterMs = LIVE_STALE_AFTER_MS, now = Date.now }: UseLiveRunOptions): LiveRunView {
  const [view, setView] = useState<LiveRunView>(INITIAL);
  const clock = useRef(now);
  clock.current = now;

  useEffect(() => {
    setView(INITIAL);
    let active = true;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;
    let since = 0;
    let held: LiveSeries | null = null;
    let lastError: { code: string; message: string } | null = null;

    const armStale = () => {
      clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        if (!active) return;
        setView((current) => (current.status === "loading" || current.status === "live" ? { ...current, status: "stale", error: lastError } : current));
      }, staleAfterMs);
    };

    const poll = async () => {
      const result = await fetchLiveRun(kind, { runId, collectionId }, { since, bucket: held?.bucketSeconds });
      if (!active) return;
      if (!result.ok) {
        lastError = { code: result.error, message: result.message };
        if (!result.retryable) {
          clearTimeout(staleTimer);
          setView((current) => ({ ...current, status: "error", error: lastError }));
          return;
        }
        pollTimer = setTimeout(() => void poll(), intervalMs);
        return;
      }
      const { snapshot } = result;
      const replace = held === null || held.bucketSeconds !== snapshot.series.bucketSeconds;
      const points = replace ? [...snapshot.series.points].sort((a, b) => a.second - b.second) : mergePoints(held?.points ?? [], snapshot.series.points);
      held = { ...snapshot.series, points };
      since = snapshot.nextSince;
      lastError = null;
      const merged = withSeries(snapshot, points);
      if (snapshot.state === "live") {
        armStale();
        setView({ status: "live", snapshot: merged, lastGoodAt: clock.current(), error: null });
        pollTimer = setTimeout(() => void poll(), intervalMs);
      } else {
        clearTimeout(staleTimer);
        setView({ status: snapshot.state, snapshot: merged, lastGoodAt: clock.current(), error: null });
      }
    };

    armStale();
    void poll();
    return () => {
      active = false;
      clearTimeout(pollTimer);
      clearTimeout(staleTimer);
    };
  }, [kind, runId, collectionId, intervalMs, staleAfterMs]);

  return view;
}
