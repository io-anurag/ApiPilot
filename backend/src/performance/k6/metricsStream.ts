/**
 * Parses k6's `--out json` stream one line at a time (specs/031-k6-performance-testing research
 * D11). Only the metrics the aggregate needs are kept; every other line is ignored. A line that is
 * not valid JSON, or not k6's point shape, is reported as unreadable rather than guessed at.
 */
export interface MetricsPoint {
  metric: string;
  timeMs: number;
  value: number;
  tags: Record<string, string>;
}

export type MetricType = "counter" | "gauge" | "rate" | "trend";

export type ParsedLine =
  | { kind: "point"; point: MetricsPoint }
  /** AP-034 (`acceptAllMetrics` only): a metric's declaration, with the thresholds the script defines on it. */
  | { kind: "declaration"; name: string; metricType: MetricType; thresholds: string[] }
  | { kind: "ignored" }
  | { kind: "blank" }
  | { kind: "unreadable" };

export interface ParseOptions {
  /**
   * AP-034 (specs/034-run-user-k6-script research R14): a user script's custom metrics and its
   * threshold declarations are part of its report, so every metric is kept and `Metric` lines are
   * returned as declarations. Generated runs keep the allow-list below.
   */
  acceptAllMetrics?: boolean;
}

const METRIC_TYPES: ReadonlySet<string> = new Set(["counter", "gauge", "rate", "trend"]);

function parseDeclaration(record: Record<string, unknown>): ParsedLine {
  const data = record.data as Record<string, unknown> | undefined;
  const name = typeof data?.name === "string" ? data.name : record.metric;
  const type = data?.type;
  if (typeof name !== "string" || typeof type !== "string" || !METRIC_TYPES.has(type)) return { kind: "unreadable" };
  const thresholds = Array.isArray(data?.thresholds) ? data.thresholds.filter((entry): entry is string => typeof entry === "string") : [];
  return { kind: "declaration", name, metricType: type as MetricType, thresholds };
}

export const KNOWN_METRICS: ReadonlySet<string> = new Set([
  "http_reqs",
  "http_req_duration",
  // FR-036 (amended 2026-09-30): the timed phases of each request, which carry its `step` tag, and
  // three run-level metrics k6 emits once per iteration without it.
  "http_req_blocked",
  "http_req_connecting",
  "http_req_tls_handshaking",
  "http_req_sending",
  "http_req_waiting",
  "http_req_receiving",
  "iteration_duration",
  "data_sent",
  "data_received",
  "vus",
  "checks",
  "iterations",
  "apipilot_missing_data",
  "apipilot_not_attempted",
  "apipilot_cut_short",
  "apipilot_token_refresh",
]);

export function parseMetricsLine(line: string, options: ParseOptions = {}): ParsedLine {
  const text = line.trim();
  if (text.length === 0) return { kind: "blank" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "unreadable" };
  }
  if (typeof parsed !== "object" || parsed === null) return { kind: "unreadable" };
  const record = parsed as Record<string, unknown>;
  if (record.type === "Metric") return options.acceptAllMetrics ? parseDeclaration(record) : { kind: "ignored" };
  if (record.type !== "Point" || typeof record.metric !== "string") return { kind: "unreadable" };
  if (!options.acceptAllMetrics && !KNOWN_METRICS.has(record.metric)) return { kind: "ignored" };
  const data = record.data as Record<string, unknown> | undefined;
  const timeMs = typeof data?.time === "string" ? Date.parse(data.time) : Number.NaN;
  const value = data?.value;
  if (!Number.isFinite(timeMs) || typeof value !== "number" || !Number.isFinite(value)) return { kind: "unreadable" };
  const tags: Record<string, string> = {};
  if (data?.tags && typeof data.tags === "object") {
    for (const [key, tag] of Object.entries(data.tags as Record<string, unknown>)) {
      if (typeof tag === "string") tags[key] = tag;
      else if (typeof tag === "number") tags[key] = String(tag);
    }
  }
  return { kind: "point", point: { metric: record.metric, timeMs, value, tags } };
}

/** Joins lines split across read chunks. */
export class LineSplitter {
  private pending = "";

  push(chunk: string): string[] {
    const text = this.pending + chunk;
    const lines = text.split("\n");
    this.pending = lines.pop() ?? "";
    return lines;
  }

  flush(): string[] {
    const rest = this.pending;
    this.pending = "";
    return rest.length > 0 ? [rest] : [];
  }
}
