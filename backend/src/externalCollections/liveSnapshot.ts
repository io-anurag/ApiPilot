import type { LiveRunSnapshot, LiveRunState, RecentRequest, UploadedCollectionExecutionRun } from "@apipilot/shared-domain";
import { LIVE_RECENT_REQUEST_LIMIT } from "@apipilot/shared-domain";
import { buildSnapshot, type LiveCursor } from "../performance/live/buildSnapshot";
import { collectionLiveStateOf } from "./liveRunState";
import { resultSecond, runSeries } from "./runSeries";

/**
 * The live snapshot of an Import & Run Collection run (AP-045 research R7), derived from the run's
 * settled results: a collection run has no k6, no virtual users and no latency percentiles, so those
 * figures are absent, never zero. "Requests" are the requests that were sent (passed or failed), so
 * the final totals equal the run report's. The latest requests name the request, its method, its
 * authored path (variables unresolved, from memory while the run is held, otherwise empty), the
 * status and the duration; the result's raw capture, resolved URL, headers and bodies are never read.
 */

const STATE: Record<UploadedCollectionExecutionRun["status"], LiveRunState> = {
  "in-progress": "live",
  completed: "completed",
  cancelled: "cancelled",
};

export function buildCollectionLiveSnapshot(run: UploadedCollectionExecutionRun, nowMs: number, cursor: LiveCursor): LiveRunSnapshot {
  const startedMs = Date.parse(run.startedAt);
  const endMs = run.completedAt ? Date.parse(run.completedAt) : nowMs;
  const elapsedMs = Math.max(0, endMs - startedMs);
  const sent = run.results.filter((result) => result.outcome !== "not-attempted");
  const failures = sent.filter((result) => result.outcome === "failed").length;
  const held = collectionLiveStateOf(run.id);
  const live = run.status === "in-progress";

  const recent: RecentRequest[] = sent
    .slice(-LIVE_RECENT_REQUEST_LIMIT)
    .reverse()
    .map((result) => ({
      second: resultSecond(result, startedMs),
      chain: result.requestName,
      method: result.requestMethod.toUpperCase(),
      path: (result.itemId ? held?.paths.get(result.itemId) : undefined) ?? "",
      status: result.responseStatusCode ?? null,
      failed: result.outcome === "failed",
      durationMs: result.durationMs,
    }));

  return buildSnapshot(
    {
      runId: run.id,
      kind: "collection",
      state: STATE[run.status],
      elapsedMs,
      plannedDurationMs: null,
      plannedRequests: held?.plannedTotal ?? (live ? null : run.results.length),
      totals: { requests: sent.length, failures },
      currentVirtualUsers: null,
      latency: null,
      chains: [],
      series: runSeries(run.results, startedMs, elapsedMs),
      recent,
      inFlight: live ? (held?.inFlight ?? null) : null,
    },
    cursor,
  );
}
