import type { LivePoint, LiveSeriesGroup } from "@apipilot/shared-domain";
import { LIVE_SERIES_MAX_POINTS } from "@apipilot/shared-domain";

/**
 * The bounded per-second series behind the live dashboard (AP-045 research R2, R3). One cell per
 * bucket, one second wide until the run is longer than `maxPoints` seconds; then neighbouring
 * buckets are merged pairwise, so the whole run is always kept, totals never change and the number
 * of points stays bounded. A cell also keeps the sum and count of the durations that completed in
 * it (so a mean latency can be drawn) and, when the run has groups, the requests per group. It uses
 * only the run's own times, so the same stream gives the same series.
 */

interface Cell {
  requests: number;
  failures: number;
  /** The last virtual-user count seen in the bucket, or null when none was reported in it. */
  virtualUsers: number | null;
  latencySum: number;
  latencyCount: number;
  groups: Map<string, number>;
}

export interface LiveSeriesView {
  bucketSeconds: number;
  points: LivePoint[];
  groups?: LiveSeriesGroup[];
}

export interface LiveSeries {
  recordRequest(second: number, groupId?: string): void;
  recordFailure(second: number): void;
  recordVirtualUsers(second: number, count: number): void;
  /** A completed request's duration, in ms, in the second it finished. */
  recordLatency(second: number, durationMs: number): void;
  /**
   * Every bucket from the start of the run to `nowSecond` (or the last second seen if later), with
   * zeros for seconds with no requests, so a stall is visible. Virtual users carry forward until
   * the next report, and stay null until the first one.
   */
  view(nowSecond: number): LiveSeriesView;
  readonly bucketSeconds: number;
}

/** More groups than this are not drawn separately: the graph would have more lines than can be told apart. */
export const LIVE_SERIES_MAX_GROUPS = 8;

export function createLiveSeries(options: { withVirtualUsers: boolean; maxPoints?: number; groups?: readonly LiveSeriesGroup[] }): LiveSeries {
  const maxPoints = options.maxPoints ?? LIVE_SERIES_MAX_POINTS;
  const groups = options.groups && options.groups.length >= 2 && options.groups.length <= LIVE_SERIES_MAX_GROUPS ? options.groups.map((group) => ({ ...group })) : undefined;
  const groupIds = new Set(groups?.map((group) => group.id));
  let bucketSeconds = 1;
  let cells = new Map<number, Cell>();
  let lastSecond = 0;

  const clamp = (second: number) => (Number.isFinite(second) && second > 0 ? Math.floor(second) : 0);
  const emptyCell = (): Cell => ({ requests: 0, failures: 0, virtualUsers: null, latencySum: 0, latencyCount: 0, groups: new Map() });

  /** Doubles the bucket width until `second` fits in `maxPoints` buckets. */
  function fit(second: number): void {
    lastSecond = Math.max(lastSecond, second);
    while (Math.floor(lastSecond / bucketSeconds) >= maxPoints) {
      const merged = new Map<number, Cell>();
      for (const [index, cell] of [...cells.entries()].sort(([a], [b]) => a - b)) {
        const target = merged.get(Math.floor(index / 2));
        if (!target) {
          merged.set(Math.floor(index / 2), { ...cell, groups: new Map(cell.groups) });
          continue;
        }
        target.requests += cell.requests;
        target.failures += cell.failures;
        target.latencySum += cell.latencySum;
        target.latencyCount += cell.latencyCount;
        for (const [id, count] of cell.groups) target.groups.set(id, (target.groups.get(id) ?? 0) + count);
        // Later buckets are visited later, so a reported count replaces an earlier one.
        if (cell.virtualUsers !== null) target.virtualUsers = cell.virtualUsers;
      }
      cells = merged;
      bucketSeconds *= 2;
    }
  }

  function cellAt(second: number): Cell {
    const clamped = clamp(second);
    fit(clamped);
    const index = Math.floor(clamped / bucketSeconds);
    let cell = cells.get(index);
    if (!cell) {
      cell = emptyCell();
      cells.set(index, cell);
    }
    return cell;
  }

  return {
    recordRequest: (second, groupId) => {
      const cell = cellAt(second);
      cell.requests += 1;
      if (groupId !== undefined && groupIds.has(groupId)) cell.groups.set(groupId, (cell.groups.get(groupId) ?? 0) + 1);
    },
    recordFailure: (second) => {
      cellAt(second).failures += 1;
    },
    recordVirtualUsers: (second, count) => {
      if (options.withVirtualUsers) cellAt(second).virtualUsers = count;
    },
    recordLatency: (second, durationMs) => {
      const cell = cellAt(second);
      cell.latencySum += durationMs;
      cell.latencyCount += 1;
    },
    view(nowSecond) {
      fit(clamp(nowSecond));
      const lastIndex = Math.floor(lastSecond / bucketSeconds);
      const points: LivePoint[] = [];
      let carried: number | null = null;
      for (let index = 0; index <= lastIndex; index += 1) {
        const cell = cells.get(index);
        if (cell?.virtualUsers != null) carried = cell.virtualUsers;
        const point: LivePoint = {
          second: index * bucketSeconds,
          requests: cell?.requests ?? 0,
          failures: cell?.failures ?? 0,
          virtualUsers: options.withVirtualUsers ? carried : null,
          latencyMs: cell && cell.latencyCount > 0 ? Math.round((cell.latencySum / cell.latencyCount) * 100) / 100 : null,
        };
        if (groups) point.byGroup = Object.fromEntries(groups.map((group) => [group.id, cell?.groups.get(group.id) ?? 0]));
        points.push(point);
      }
      return { bucketSeconds, points, ...(groups ? { groups } : {}) };
    },
    get bucketSeconds() {
      return bucketSeconds;
    },
  };
}
