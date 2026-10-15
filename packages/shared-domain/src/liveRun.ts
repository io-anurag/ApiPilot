/**
 * Live run dashboard contract (AP-045, specs/045-live-run-dashboard/data-model.md). One snapshot
 * type serves every run kind that can be started; a figure a kind cannot supply is `null` or empty,
 * never zero. Nothing here carries headers, cookies, bodies, resolved URLs or secret values.
 */

export type LiveRunKind = "chain" | "user-script" | "collection";

/** From the run status. `loading` and `stale` are client-side states and are never sent. */
export type LiveRunState = "live" | "completed" | "cancelled" | "failed";

/** The most recent requests kept for the dashboard's list. */
export const LIVE_RECENT_REQUEST_LIMIT = 15;

/** The most points one snapshot holds; older seconds are merged into wider buckets beyond it. */
export const LIVE_SERIES_MAX_POINTS = 1_800;

/**
 * One bucket of the run (`LiveSeries.bucketSeconds` wide, one second until the run is thinned).
 * `requests` and `failures` count that bucket only.
 */
export interface LivePoint {
  second: number;
  requests: number;
  failures: number;
  /** Null where the kind has no virtual users (an Import & Run Collection run). */
  virtualUsers: number | null;
  /** Mean duration of the requests that completed in the bucket, in ms; null when none did. Absent on series stored before the graph showed it. */
  latencyMs?: number | null;
  /** Requests in the bucket by group id (see `LiveSeries.groups`); absent when the run has no groups. */
  byGroup?: Record<string, number>;
}

/** A named part of the run the graph can break requests down by (a chain). */
export interface LiveSeriesGroup {
  id: string;
  label: string;
}

export interface LiveSeries {
  fromSecond: number;
  /** 1 until the run is thinned, then 2, 4, ...; applies to every point. */
  bucketSeconds: number;
  points: LivePoint[];
  /** Present when requests can be broken down (a plan with several chains); each point's `byGroup` is keyed by these ids. */
  groups?: LiveSeriesGroup[];
}

/** A completed request in the latest-requests list. `path` is a template with no query, user info or fragment. */
export interface RecentRequest {
  second: number;
  chain: string;
  method: string;
  path: string;
  /** Null when no response was received (connectivity failure or timeout). */
  status: number | null;
  failed: boolean;
  durationMs: number;
}

/** How many failed requests the live view keeps, newest first. */
export const LIVE_RECENT_FAILURE_LIMIT = 15;
/** The most response text kept for one failed request, in characters, before masking. */
export const LIVE_FAILURE_BODY_LIMIT = 2048;

/**
 * What a failed request's response shows. Held in memory for the live view only: it is never stored,
 * reported or logged. Text has had secret values and credential-looking fields masked.
 */
export type FailureResponse =
  | { kind: "text"; contentType: string | null; text: string; truncated: boolean }
  | { kind: "empty"; contentType: string | null }
  /** No response arrived: the connection failed or the request timed out. */
  | { kind: "none-received" }
  /** Not kept, because the plan uses secret data set columns and the response could echo one. */
  | { kind: "withheld"; reason: "secret-data-columns" }
  /** Run k6 Script runs: ApiPilot runs the script as supplied and cannot see the response, so none is kept. */
  | { kind: "not-captured"; reason: "user-script" };

/**
 * A failed request sampled for the live view. A request-chain run samples at most one per second per
 * virtual user; a Run k6 Script run at most one per second for each request name and status.
 */
export interface RecentFailure {
  second: number;
  chain: string;
  method: string;
  path: string;
  /** Null when no response was received. */
  status: number | null;
  response: FailureResponse;
}

export interface LiveChainRow {
  id: string;
  label: string;
  method?: string;
  path?: string;
  requests: number;
  failures: number;
}

export interface LiveRunLatency {
  averageMs: number;
  p95Ms: number;
}

export interface LiveRunSnapshot {
  runId: string;
  kind: LiveRunKind;
  state: LiveRunState;
  elapsedMs: number;
  /** When the run started (ISO 8601, UTC); each request's `second` is measured from it. */
  startedAt?: string;
  /** k6 kinds only. */
  plannedDurationMs: number | null;
  /** Collection only. */
  plannedRequests: number | null;
  totals: { requests: number; failures: number };
  /** Null for a collection run. */
  currentVirtualUsers: number | null;
  /** Whole run so far; null when no request has completed (not zero), and omitted by the dashboard for a collection run. */
  latency: LiveRunLatency | null;
  chains: LiveChainRow[];
  series: LiveSeries;
  /** Newest first, at most `LIVE_RECENT_REQUEST_LIMIT`. */
  recent: RecentRequest[];
  /** Request-chain and Run k6 Script runs, newest first, at most `LIVE_RECENT_FAILURE_LIMIT`; a sample, not every failure. Absent once the run is no longer held in memory. */
  recentFailures?: RecentFailure[];
  /** Name of the request being sent (collection only). */
  inFlight: string | null;
  /** Cursor for the next poll. */
  nextSince: number;
  /** True when older points were merged into wider buckets; none are dropped. */
  thinned: boolean;
}

/** A finished run's stored series (AP-045 US4): at most `LIVE_SERIES_MAX_POINTS` points. */
export interface StoredLiveSeries {
  bucketSeconds: number;
  points: LivePoint[];
  groups?: LiveSeriesGroup[];
}
