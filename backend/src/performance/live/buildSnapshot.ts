import type { LiveChainRow, LivePoint, LiveRunKind, LiveRunLatency, LiveRunSnapshot, LiveRunState, RecentRequest } from "@apipilot/shared-domain";
import { LIVE_RECENT_REQUEST_LIMIT } from "@apipilot/shared-domain";
import type { LiveSeriesView } from "./liveSeries";

/**
 * Builds the one `LiveRunSnapshot` every route returns (AP-045 data-model). Pure: the caller passes
 * what the run's aggregate holds now; nothing is recomputed from the stored result and nothing is
 * written. Unavailable figures stay null; a count of zero is shown as zero.
 */
export interface LiveRunSource {
  runId: string;
  kind: LiveRunKind;
  state: LiveRunState;
  elapsedMs: number;
  plannedDurationMs: number | null;
  plannedRequests: number | null;
  totals: { requests: number; failures: number };
  currentVirtualUsers: number | null;
  latency: LiveRunLatency | null;
  chains: LiveChainRow[];
  series: LiveSeriesView;
  recent: RecentRequest[];
  inFlight: string | null;
}

/** What an aggregate reports about the run now; the registry adds the run's identity and state. */
export type LiveParts = Pick<LiveRunSource, "elapsedMs" | "totals" | "currentVirtualUsers" | "latency" | "chains" | "series" | "recent">;

export interface LiveCursor {
  /** Points whose bucket ends at or after this second are returned. */
  since: number;
  /** The bucket width the client holds; when it differs from the current one the whole series is returned. */
  knownBucketSeconds?: number;
}

function pointsFor(series: LiveSeriesView, cursor: LiveCursor): { points: LivePoint[]; replaced: boolean } {
  const replaced = cursor.knownBucketSeconds !== undefined && cursor.knownBucketSeconds !== series.bucketSeconds;
  if (replaced || cursor.since <= 0) return { points: series.points, replaced };
  return { points: series.points.filter((point) => point.second + series.bucketSeconds > cursor.since), replaced };
}

/**
 * k6 writes its metrics in batches and stamps each point with the time of the request, so points for
 * a second can still arrive after newer seconds have. The next poll therefore starts this many
 * seconds before the newest bucket and the client replaces points by `second`.
 */
export const LATE_POINT_MARGIN_SECONDS = 10;

export function buildSnapshot(source: LiveRunSource, requested: LiveCursor): LiveRunSnapshot {
  // A run that has ended sends its whole series once, so the final graph never misses a late point.
  const cursor: LiveCursor = source.state === "live" ? requested : { since: 0 };
  const { points } = pointsFor(source.series, cursor);
  const last = source.series.points.at(-1);
  return {
    runId: source.runId,
    kind: source.kind,
    state: source.state,
    elapsedMs: Math.max(0, source.elapsedMs),
    plannedDurationMs: source.plannedDurationMs,
    plannedRequests: source.plannedRequests,
    totals: { requests: source.totals.requests, failures: source.totals.failures },
    currentVirtualUsers: source.currentVirtualUsers,
    latency: source.latency,
    chains: source.chains,
    series: { fromSecond: points[0]?.second ?? Math.max(0, cursor.since), bucketSeconds: source.series.bucketSeconds, points, ...(source.series.groups ? { groups: source.series.groups } : {}) },
    recent: source.recent.slice(0, LIVE_RECENT_REQUEST_LIMIT),
    inFlight: source.inFlight,
    // The newest buckets may still fill (see LATE_POINT_MARGIN_SECONDS), so the next poll asks for them again.
    nextSince: last ? Math.max(0, last.second - Math.ceil(LATE_POINT_MARGIN_SECONDS / source.series.bucketSeconds) * source.series.bucketSeconds) : 0,
    thinned: source.series.bucketSeconds > 1,
  };
}

/** The run's average and 95th-percentile duration from its histogram, or null when no request completed. */
export function latencyOf(histogram: { summary(): { mean: number } | null; percentile(p: number): number | null }): LiveRunLatency | null {
  const summary = histogram.summary();
  const p95 = histogram.percentile(95);
  return summary && p95 !== null ? { averageMs: summary.mean, p95Ms: p95 } : null;
}
