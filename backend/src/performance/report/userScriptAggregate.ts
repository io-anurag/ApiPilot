import type {
  CustomMetricSummary,
  LatencyPercentiles,
  LatencySummary,
  RequestGroupMetrics,
  RequestGroupResult,
  RequestPhase,
  StepTimelinePoint,
  TimelinePoint,
  UserScriptResult,
  UserScriptRunProgress,
  WriteMethod,
} from "@apipilot/shared-domain";
import { isWriteMethod, REQUEST_PHASES, USER_SCRIPT_FINDINGS_RULESET_VERSION, USER_SCRIPT_MAX_REQUEST_GROUPS } from "@apipilot/shared-domain";
import { compareCodeUnits } from "../../postman/ordering";
import type { MetricType, ParsedLine } from "../k6/metricsStream";
import { timelineBucketMs } from "./aggregate";
import { LatencyHistogram } from "./histogram";

/**
 * Streams a user script's k6 metrics into a bounded aggregate (specs/034-run-user-k6-script FR-031
 * to FR-034; research R14). Requests are grouped by k6's request name, at most 100 groups in order
 * of first appearance, then one "Other requests" group. Failure is k6's own `http_req_failed`. The
 * raw `url` and `name` tags are read here only: no result field holds a URL with its query, user
 * info or fragment. The same stream always gives the same result.
 */

export const OTHER_REQUESTS = "Other requests";
const MAX_TRACKED = 100;
const MAX_HOSTS = 50;
const MAX_TIMELINE_BUCKETS = 200;
const ADAPTIVE_START_BUCKET_MS = 5_000;

/** Metrics k6 emits itself; any other metric is the script's own (FR-033). */
const BUILTIN_METRICS: ReadonlySet<string> = new Set([
  "http_reqs",
  "http_req_duration",
  "http_req_failed",
  "http_req_blocked",
  "http_req_connecting",
  "http_req_tls_handshaking",
  "http_req_sending",
  "http_req_waiting",
  "http_req_receiving",
  "vus",
  "vus_max",
  "iterations",
  "iteration_duration",
  "dropped_iterations",
  "data_sent",
  "data_received",
  "checks",
  "group_duration",
]);

const PHASE_METRICS: Readonly<Record<string, RequestPhase>> = {
  http_req_blocked: "blocked",
  http_req_connecting: "connecting",
  http_req_tls_handshaking: "tls-handshaking",
  http_req_sending: "sending",
  http_req_waiting: "waiting",
  http_req_receiving: "receiving",
};

const DEFAULT_PORTS: Readonly<Record<string, string>> = { "http:": "80", "https:": "443", "ws:": "80", "wss:": "443" };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : round2((part / whole) * 100);
}

function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

function decodePath(pathname: string): string {
  try {
    return decodeURI(pathname);
  } catch {
    return pathname;
  }
}

/**
 * Research R14's display-name rule (FR-032). k6 names an unnamed request by its URL, and replaces a
 * named request's `url` tag with the name (checked against k6 2.3.0, 2026-10-01). So a request is
 * named exactly when its `name` is not an absolute URL; otherwise it is shown as method, host and
 * path, with user info, query and fragment removed. An `http.url` template keeps its `${}`.
 */
export function displayNameOf(tags: Record<string, string>): { displayName: string; named: boolean } {
  const name = tags.name ?? "";
  if (name !== "" && parseUrl(name) === null) return { displayName: name, named: true };
  const source = name !== "" ? name : (tags.url ?? "");
  const method = tags.method ?? "";
  const parsed = parseUrl(source);
  const where = parsed ? `${parsed.host}${decodePath(parsed.pathname)}` : source.split(/[?#]/)[0];
  return { displayName: method === "" ? where : `${method} ${where}`, named: false };
}

export function originOf(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed || parsed.hostname === "") return null;
  return `${parsed.protocol}//${parsed.hostname}:${parsed.port || DEFAULT_PORTS[parsed.protocol] || ""}`;
}

interface Bucket {
  virtualUsers: number;
  requests: number;
  errors: number;
  histogram: LatencyHistogram;
}

interface Measures {
  requests: number;
  failures: number;
  statuses: Map<number, number>;
  histogram: LatencyHistogram;
  phases: Map<RequestPhase, LatencyHistogram>;
}

interface GroupStats extends Measures {
  displayName: string;
  named: boolean;
  writes: Map<WriteMethod, { sent: number; succeeded: number }>;
  buckets: Map<number, Bucket>;
}

function newMeasures(): Measures {
  return { requests: 0, failures: 0, statuses: new Map(), histogram: new LatencyHistogram(), phases: new Map() };
}

function newBucket(virtualUsers: number): Bucket {
  return { virtualUsers, requests: 0, errors: 0, histogram: new LatencyHistogram() };
}

interface CustomStats {
  type: MetricType;
  total: number;
  samples: number;
  nonZero: number;
  last: number;
  min: number;
  max: number;
  histogram: LatencyHistogram;
}

export interface UserScriptAggregate {
  add(line: ParsedLine): void;
  progress(nowMs: number): UserScriptRunProgress;
  /** Thresholds and findings are filled in afterwards (`withUserScriptReportFields`). */
  toResult(endMs: number): UserScriptResult;
  /** Request groups seen so far; read by the run to know whether anything was measured. */
  readonly requestCount: number;
}

export function createUserScriptAggregate(options: { plannedDurationMs: number | null; startedAtMs: number }): UserScriptAggregate {
  const { startedAtMs } = options;
  const adaptive = options.plannedDurationMs === null;
  let bucketMs = adaptive ? ADAPTIVE_START_BUCKET_MS : timelineBucketMs(options.plannedDurationMs!);

  const totals = newMeasures();
  const groups = new Map<string, GroupStats>();
  let other: (GroupStats & { names: Set<string> }) | null = null;
  const buckets = new Map<number, Bucket>();
  const hosts = new Map<string, number>();
  const otherHosts = new Set<string>();
  const checks = new Map<string, { passes: number; fails: number }>();
  const groupDurations = new Map<string, LatencyHistogram>();
  const declared = new Map<string, MetricType>();
  const thresholds = new Map<string, string[]>();
  const custom = new Map<string, CustomStats>();
  const iterationDuration = new LatencyHistogram();
  let iterations = 0;
  let dataSent = 0;
  let dataReceived = 0;
  let currentVirtualUsers = 0;

  const indexOf = (timeMs: number) => Math.max(0, Math.floor((timeMs - startedAtMs) / bucketMs));

  function mergeBuckets(map: Map<number, Bucket>): Map<number, Bucket> {
    const merged = new Map<number, Bucket>();
    for (const [index, bucket] of [...map.entries()].sort(([a], [b]) => a - b)) {
      const target = merged.get(Math.floor(index / 2));
      if (!target) {
        merged.set(Math.floor(index / 2), bucket);
        continue;
      }
      target.virtualUsers = Math.max(target.virtualUsers, bucket.virtualUsers);
      target.requests += bucket.requests;
      target.errors += bucket.errors;
      target.histogram.merge(bucket.histogram);
    }
    return merged;
  }

  /** Research R14: with no planned duration, double the bucket width whenever more than 200 would be needed. */
  function bucketIndex(timeMs: number): number {
    let index = indexOf(timeMs);
    while (adaptive && index >= MAX_TIMELINE_BUCKETS) {
      bucketMs *= 2;
      const run = mergeBuckets(buckets);
      buckets.clear();
      for (const [key, value] of run) buckets.set(key, value);
      for (const group of [...groups.values(), ...(other ? [other] : [])]) {
        const merged = mergeBuckets(group.buckets);
        group.buckets.clear();
        for (const [key, value] of merged) group.buckets.set(key, value);
      }
      index = indexOf(timeMs);
    }
    return index;
  }

  function runBucket(index: number): Bucket {
    let bucket = buckets.get(index);
    if (!bucket) {
      bucket = newBucket(currentVirtualUsers);
      buckets.set(index, bucket);
    }
    return bucket;
  }

  function groupBucket(group: GroupStats, index: number): Bucket {
    let bucket = group.buckets.get(index);
    if (!bucket) {
      bucket = newBucket(0);
      group.buckets.set(index, bucket);
    }
    return bucket;
  }

  function groupFor(tags: Record<string, string>): GroupStats {
    const { displayName, named } = displayNameOf(tags);
    const existing = groups.get(displayName);
    if (existing) return existing;
    if (groups.size < USER_SCRIPT_MAX_REQUEST_GROUPS) {
      const created: GroupStats = { ...newMeasures(), displayName, named, writes: new Map(), buckets: new Map() };
      groups.set(displayName, created);
      return created;
    }
    if (!other) other = { ...newMeasures(), displayName: OTHER_REQUESTS, named: true, writes: new Map(), buckets: new Map(), names: new Set() };
    other.names.add(displayName);
    return other;
  }

  function addPhase(measures: Measures, phase: RequestPhase, value: number): void {
    let histogram = measures.phases.get(phase);
    if (!histogram) {
      histogram = new LatencyHistogram();
      measures.phases.set(phase, histogram);
    }
    histogram.add(value);
  }

  /** A URL's origin, or, for a named request whose `url` tag holds its name, the address k6 connected to. */
  function recordHost(tags: Record<string, string>): void {
    const origin = tags.url ? originOf(tags.url) : null;
    const key = origin ? `url ${origin}` : tags.ip ? `ip ${tags.ip}` : null;
    if (!key) return;
    if (hosts.has(key)) hosts.set(key, hosts.get(key)! + 1);
    else if (hosts.size < MAX_HOSTS) hosts.set(key, 1);
    else otherHosts.add(key);
  }

  function addCustom(metric: string, value: number): void {
    const type = declared.get(metric);
    if (!type) return;
    let stats = custom.get(metric);
    if (!stats) {
      if (custom.size >= MAX_TRACKED) return;
      stats = { type, total: 0, samples: 0, nonZero: 0, last: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY, histogram: new LatencyHistogram() };
      custom.set(metric, stats);
    }
    stats.total += value;
    stats.samples += 1;
    if (value !== 0) stats.nonZero += 1;
    stats.last = value;
    stats.min = Math.min(stats.min, value);
    stats.max = Math.max(stats.max, value);
    if (type === "trend") stats.histogram.add(value);
  }

  function add(line: ParsedLine): void {
    if (line.kind === "declaration") {
      declared.set(line.name, line.metricType);
      if (line.thresholds.length > 0) thresholds.set(line.name, [...line.thresholds]);
      return;
    }
    if (line.kind !== "point") return;
    const { metric, tags, value, timeMs } = line.point;
    if (metric === "vus") {
      currentVirtualUsers = value;
      runBucket(bucketIndex(timeMs)).virtualUsers = value;
      return;
    }
    if (metric === "iterations") {
      iterations += value;
      return;
    }
    if (metric === "iteration_duration") {
      iterationDuration.add(value);
      return;
    }
    if (metric === "data_sent") {
      dataSent += value;
      return;
    }
    if (metric === "data_received") {
      dataReceived += value;
      return;
    }
    if (metric === "checks") {
      const name = tags.check ?? "";
      let entry = checks.get(name);
      if (!entry) {
        if (checks.size >= MAX_TRACKED) return;
        entry = { passes: 0, fails: 0 };
        checks.set(name, entry);
      }
      if (value > 0) entry.passes += 1;
      else entry.fails += 1;
      return;
    }
    if (metric === "group_duration") {
      const name = tags.group ?? "";
      let histogram = groupDurations.get(name);
      if (!histogram) {
        if (groupDurations.size >= MAX_TRACKED) return;
        histogram = new LatencyHistogram();
        groupDurations.set(name, histogram);
      }
      histogram.add(value);
      return;
    }
    if (!BUILTIN_METRICS.has(metric)) {
      addCustom(metric, value);
      return;
    }
    if (!metric.startsWith("http_req")) return;
    const group = groupFor(tags);
    const phase = PHASE_METRICS[metric];
    if (phase) {
      addPhase(group, phase, value);
      addPhase(totals, phase, value);
      return;
    }
    const index = bucketIndex(timeMs);
    if (metric === "http_reqs") {
      const status = Number(tags.status ?? "0");
      const code = Number.isFinite(status) ? status : 0;
      for (const measures of [group, totals]) {
        measures.requests += 1;
        measures.statuses.set(code, (measures.statuses.get(code) ?? 0) + 1);
      }
      runBucket(index).requests += 1;
      groupBucket(group, index).requests += 1;
      recordHost(tags);
      return;
    }
    if (metric === "http_req_duration") {
      group.histogram.add(value);
      totals.histogram.add(value);
      runBucket(index).histogram.add(value);
      groupBucket(group, index).histogram.add(value);
      return;
    }
    if (metric === "http_req_failed") {
      const failed = value > 0;
      if (failed) {
        group.failures += 1;
        totals.failures += 1;
        runBucket(index).errors += 1;
        groupBucket(group, index).errors += 1;
      }
      const method = (tags.method ?? "").toUpperCase();
      if (isWriteMethod(method)) {
        const entry = group.writes.get(method) ?? { sent: 0, succeeded: 0 };
        entry.sent += 1;
        if (!failed) entry.succeeded += 1;
        group.writes.set(method, entry);
      }
    }
  }

  function metricsOf(measures: Measures, seconds: number): RequestGroupMetrics {
    return {
      requests: measures.requests,
      failures: measures.failures,
      failureRatePercent: percent(measures.failures, measures.requests),
      throughputPerSecond: round2(measures.requests / seconds),
      latencyMs: measures.histogram.percentiles(),
      latencySummaryMs: measures.histogram.summary(),
      statusesReceived: [...measures.statuses.entries()].sort(([a], [b]) => a - b).map(([status, count]) => ({ status, count })),
      phaseTimings: REQUEST_PHASES.flatMap((phase) => {
        const histogram = measures.phases.get(phase);
        const summary = histogram?.summary();
        return histogram && summary ? [{ phase, meanMs: summary.mean, p95Ms: histogram.percentile(95)! }] : [];
      }),
    };
  }

  function groupResult(group: GroupStats, seconds: number): RequestGroupResult {
    const writeOrder: WriteMethod[] = ["POST", "PUT", "PATCH", "DELETE"];
    return {
      ...metricsOf(group, seconds),
      displayName: group.displayName,
      named: group.named,
      writes: writeOrder.flatMap((method) => {
        const entry = group.writes.get(method);
        return entry ? [{ method, ...entry }] : [];
      }),
      timeline: [...group.buckets.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, bucket]): StepTimelinePoint => ({ offsetMs: index * bucketMs, requests: bucket.requests, errors: bucket.errors, p95Ms: bucket.histogram.percentile(95) })),
    };
  }

  function trendOf(histogram: LatencyHistogram): (LatencyPercentiles & LatencySummary) | null {
    const percentiles = histogram.percentiles();
    const summary = histogram.summary();
    return percentiles && summary ? { ...percentiles, ...summary } : null;
  }

  function customSummary(name: string, stats: CustomStats, seconds: number): CustomMetricSummary | null {
    switch (stats.type) {
      case "counter":
        return { name, type: "counter", total: round2(stats.total), ratePerSecond: round2(stats.total / seconds) };
      case "gauge":
        return { name, type: "gauge", last: stats.last, min: stats.min, max: stats.max };
      case "rate":
        return { name, type: "rate", percentTrue: percent(stats.nonZero, stats.samples), samples: stats.samples };
      case "trend": {
        const percentiles = stats.histogram.percentiles();
        const summary = stats.histogram.summary();
        return percentiles && summary ? { name, type: "trend", percentiles, summary } : null;
      }
      default:
        return null;
    }
  }

  function toResult(endMs: number): UserScriptResult {
    const seconds = Math.max(1, endMs - startedAtMs) / 1000;
    const timeline: TimelinePoint[] = [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, bucket]) => ({ offsetMs: index * bucketMs, virtualUsers: bucket.virtualUsers, requests: bucket.requests, errors: bucket.errors, p95Ms: bucket.histogram.percentile(95) }));
    const otherGroup = other as (GroupStats & { names: Set<string> }) | null;
    return {
      totals: {
        ...metricsOf(totals, seconds),
        iterations,
        iterationDurationMs: trendOf(iterationDuration),
        dataSentBytes: dataSent,
        dataReceivedBytes: dataReceived,
      },
      requestGroups: [...groups.values()].map((group) => groupResult(group, seconds)),
      otherRequests: otherGroup ? { ...groupResult(otherGroup, seconds), combinedNames: otherGroup.names.size } : null,
      hostsReceived: [...hosts.entries()]
        .sort(([a], [b]) => compareCodeUnits(a, b))
        .map(([key, requests]) => ({ origin: key.slice(key.indexOf(" ") + 1), requests, source: key.startsWith("ip ") ? ("ip" as const) : ("url" as const) })),
      otherHostsCount: otherHosts.size,
      checks: [...checks.entries()].map(([name, entry]) => ({ name, ...entry })),
      groups: [...groupDurations.entries()].map(([name, histogram]) => ({ name, durationMs: trendOf(histogram) })),
      customMetrics: [...custom.entries()]
        .sort(([a], [b]) => compareCodeUnits(a, b))
        .flatMap(([name, stats]) => {
          const summary = customSummary(name, stats, seconds);
          return summary ? [summary] : [];
        }),
      scriptThresholds: [...thresholds.entries()].sort(([a], [b]) => compareCodeUnits(a, b)).map(([metric, expressions]) => ({ metric, expressions })),
      scriptThresholdsOutcome: thresholds.size === 0 ? "none-defined" : "not-evaluated",
      apiPilotThresholds: [],
      timeline: { bucketMs, points: timeline },
      findings: [],
      findingsRulesetVersion: USER_SCRIPT_FINDINGS_RULESET_VERSION,
      latencyPrecision: "within-1-percent",
    };
  }

  return {
    add,
    progress: (nowMs) => ({ elapsedMs: Math.max(0, nowMs - startedAtMs), currentVirtualUsers, requestsSoFar: totals.requests, failuresSoFar: totals.failures }),
    toResult,
    get requestCount() {
      return totals.requests;
    },
  };
}
