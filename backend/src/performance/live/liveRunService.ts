import type { ChainRun, LatencyPercentiles, LatencySummary, LiveRunSnapshot, LiveRunState, PerformanceRunStatus, StoredLiveSeries, UserScriptRun } from "@apipilot/shared-domain";
import { getPerformanceRunRepository } from "../../persistence/performanceRunRepository";
import { getUserScriptRunRepository } from "../../persistence/userScriptRunRepository";
import { InvalidLiveQueryError, PerformanceRunNotFoundError } from "../errors";
import { buildSnapshot, type LiveCursor } from "./buildSnapshot";
import { readLiveSnapshot } from "./liveRunRegistry";

/**
 * The read side of the live dashboard for the two k6 run kinds (AP-045 contracts/live-run-routes.md).
 * A run this process still holds is answered from memory. Any other run of the session, one that
 * finished before a restart or before this feature, is answered from its stored record: the
 * stored series when it has one, otherwise an empty series, and never an invented figure. Nothing
 * is written, and a run of another session is not found.
 */

function wholeNumber(value: unknown, parameter: string, minimum: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d{1,9}$/.test(value)) throw new InvalidLiveQueryError(parameter);
  const parsed = Number(value);
  if (parsed < minimum) throw new InvalidLiveQueryError(parameter);
  return parsed;
}

/** Reads `since` (default 0) and `bucket` (optional) from a request's query. */
export function parseLiveCursor(query: Record<string, unknown>): LiveCursor {
  const since = wholeNumber(query.since, "since", 0) ?? 0;
  const knownBucketSeconds = wholeNumber(query.bucket, "bucket", 1);
  return knownBucketSeconds === undefined ? { since } : { since, knownBucketSeconds };
}

function stateOf(status: PerformanceRunStatus): LiveRunState {
  return status === "in-progress" ? "live" : status;
}

interface StoredK6Run {
  runId: string;
  kind: "chain" | "user-script";
  status: PerformanceRunStatus;
  startedAt: string;
  endedAt?: string;
  plannedDurationMs: number | null;
  progress?: { elapsedMs: number; currentVirtualUsers: number; requestsSoFar: number; failuresSoFar: number };
  totals?: { requests: number; failures: number; latencyMs: LatencyPercentiles | null; latencySummaryMs: LatencySummary | null };
  liveSeries?: StoredLiveSeries;
}

function storedSnapshot(run: StoredK6Run, cursor: LiveCursor): LiveRunSnapshot {
  const requests = run.totals?.requests ?? run.progress?.requestsSoFar ?? 0;
  const failures = run.totals?.failures ?? run.progress?.failuresSoFar ?? 0;
  const mean = run.totals?.latencySummaryMs?.mean;
  const p95 = run.totals?.latencyMs?.p95;
  const elapsedMs = run.endedAt ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : (run.progress?.elapsedMs ?? 0);
  return buildSnapshot(
    {
      runId: run.runId,
      kind: run.kind,
      state: stateOf(run.status),
      elapsedMs,
      plannedDurationMs: run.plannedDurationMs,
      plannedRequests: null,
      totals: { requests, failures },
      currentVirtualUsers: run.progress?.currentVirtualUsers ?? null,
      latency: mean !== undefined && p95 !== undefined ? { averageMs: mean, p95Ms: p95 } : null,
      chains: [],
      series: run.liveSeries ?? { bucketSeconds: 1, points: [] },
      recent: [],
      inFlight: null,
    },
    cursor,
  );
}

export function getChainLiveSnapshot(sessionId: string, runId: string, nowMs: number, cursor: LiveCursor): LiveRunSnapshot {
  const live = readLiveSnapshot(sessionId, runId, nowMs, cursor);
  if (live) return live;
  const run: ChainRun | undefined = getPerformanceRunRepository().getChainRun(sessionId, runId);
  if (!run) throw new PerformanceRunNotFoundError(runId);
  return storedSnapshot(
    {
      runId,
      kind: "chain",
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      plannedDurationMs: run.plannedDurationMs,
      progress: run.progress,
      totals: run.result ? { requests: run.result.totals.requests, failures: run.result.totals.errors, latencyMs: run.result.totals.latencyMs, latencySummaryMs: run.result.totals.latencySummaryMs ?? null } : undefined,
      liveSeries: run.result?.liveSeries,
    },
    cursor,
  );
}

export function getUserScriptLiveSnapshot(sessionId: string, runId: string, nowMs: number, cursor: LiveCursor): LiveRunSnapshot {
  const live = readLiveSnapshot(sessionId, runId, nowMs, cursor);
  if (live) return live;
  const run: UserScriptRun | undefined = getUserScriptRunRepository().get(sessionId, runId);
  if (!run) throw new PerformanceRunNotFoundError(runId);
  return storedSnapshot(
    {
      runId,
      kind: "user-script",
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      plannedDurationMs: run.plannedDurationMs,
      progress: run.progress,
      totals: run.result ? { requests: run.result.totals.requests, failures: run.result.totals.failures, latencyMs: run.result.totals.latencyMs, latencySummaryMs: run.result.totals.latencySummaryMs } : undefined,
      liveSeries: run.result?.liveSeries,
    },
    cursor,
  );
}
