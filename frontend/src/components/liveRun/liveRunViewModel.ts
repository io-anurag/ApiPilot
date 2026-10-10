import type { LivePoint, RecentRequest } from "@apipilot/shared-domain";
import type { StatusTone } from "../StatusBadge";
import { formatDuration } from "../performance/performanceViewModel";
import type { LiveRunStatus } from "./useLiveRun";

/**
 * Labels, tones and number formatting of the live run dashboard (AP-045), kept out of JSX
 * (CLAUDE.md §43). The run-state wording is the one the run lists use ("In progress", "Completed",
 * "Cancelled", "Failed"); every tone is paired with its text label.
 */
export const LIVE_STATE_BADGE: Record<LiveRunStatus, { label: string; tone: StatusTone }> = {
  loading: { label: "Loading", tone: "neutral" },
  live: { label: "Live", tone: "danger" },
  stale: { label: "Figures stale", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
  error: { label: "Figures unavailable", tone: "danger" },
};

/** The heading of the dashboard's card for each state. */
export const LIVE_STATE_TITLE: Record<LiveRunStatus, string> = {
  loading: "Run in progress",
  live: "Run in progress",
  stale: "Run in progress",
  completed: "Run completed",
  cancelled: "Run cancelled",
  failed: "Run failed",
  error: "Run",
};

/** Failures as a share of requests, one decimal; null when no request was sent (not 0%). */
export function failureShare(failures: number, requests: number): string | null {
  return requests > 0 ? `${((failures / requests) * 100).toFixed(1)}% of requests` : null;
}

/** The highest virtual-user count in the series, or null when the run has none. */
export function peakVirtualUsers(points: readonly LivePoint[]): number | null {
  const counts = points.flatMap((point) => (point.virtualUsers === null ? [] : [point.virtualUsers]));
  return counts.length === 0 ? null : Math.max(...counts);
}

export const UNAVAILABLE = "Unavailable";
export const NO_REQUESTS_YET = "No requests yet";

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** A request duration: whole milliseconds below one second, otherwise seconds with two decimals. */
export function formatRequestDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function formatElapsed(ms: number): string {
  return formatDuration(ms);
}

/** Local time of day as HH:MM:SS. */
export function formatClock(epochMs: number): string {
  const date = new Date(epochMs);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

/** The plotted figure: a point's count over its bucket width, in requests (or failures) per second. */
export function perSecond(count: number, bucketSeconds: number): number {
  return count / Math.max(1, bucketSeconds);
}

/**
 * The request rate now, in requests per second: the mean of the last three complete buckets (the
 * newest bucket is still filling, so it is left out once there are others). Null before any point.
 */
export function recentRate(points: readonly LivePoint[], bucketSeconds: number): number | null {
  if (points.length === 0) return null;
  const complete = points.length > 1 ? points.slice(0, -1) : points;
  const window = complete.slice(-3);
  return window.reduce((sum, point) => sum + perSecond(point.requests, bucketSeconds), 0) / window.length;
}

export function formatRate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Share of the planned time elapsed, 0 to 100; null when there is no plan. */
export function progressPercent(elapsedMs: number, plannedMs: number | null): number | null {
  if (plannedMs === null || plannedMs <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((elapsedMs / plannedMs) * 100)));
}

/** A status as a word plus the number, so it is never only a colour. */
export function requestStatusText(request: Pick<RecentRequest, "status" | "failed">): string {
  if (request.status === null) return "No response";
  const word = request.failed ? "Failed" : "OK";
  return `${word} ${request.status}`;
}

export function requestStatusTone(request: Pick<RecentRequest, "status" | "failed">): StatusTone {
  return request.failed || request.status === null ? "danger" : "success";
}

export function hasVirtualUsers(points: readonly LivePoint[]): boolean {
  return points.some((point) => point.virtualUsers !== null);
}
