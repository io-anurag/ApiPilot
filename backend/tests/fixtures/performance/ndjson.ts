/**
 * Builds k6 `--out json` lines deterministically (specs/031-k6-performance-testing tasks T004), in
 * k6's documented shape: one `{"type":"Metric",…}` declaration per metric, then
 * `{"type":"Point","metric":…,"data":{"time":ISO,"value":n,"tags":{…}}}` samples. The opt-in
 * real-k6 test (tasks T092) confirms the shape against a real binary.
 */

/** The fixed run start every builder offsets from. */
export const STREAM_START_MS = Date.parse("2026-09-27T12:00:00.000Z");

function time(atMs: number): string {
  return new Date(STREAM_START_MS + atMs).toISOString();
}

function point(metric: string, value: number, tags: Record<string, string>, atMs: number): string {
  return JSON.stringify({ type: "Point", metric, data: { time: time(atMs), value, tags } });
}

export function metricDeclaration(name: string, type: "counter" | "trend" | "rate" | "gauge"): string {
  return JSON.stringify({
    type: "Metric",
    metric: name,
    data: { name, type, contains: type === "trend" ? "time" : "default", thresholds: [], submetrics: null },
  });
}

export interface HttpReqInput {
  step: string;
  journey: string;
  status: number;
  method: string;
  durationMs: number;
  atMs: number;
  /** k6's `error_code` tag; set for status 0 (no response). */
  errorCode?: number;
}

/** One sent request: an `http_reqs` sample and its `http_req_duration` sample. */
export function httpReq(input: HttpReqInput): string[] {
  const tags: Record<string, string> = {
    step: input.step,
    journey: input.journey,
    status: String(input.status),
    method: input.method,
  };
  if (input.errorCode !== undefined) tags.error_code = String(input.errorCode);
  return [point("http_reqs", 1, tags, input.atMs), point("http_req_duration", input.durationMs, tags, input.atMs)];
}

/** Any other sample, such as a request phase (`http_req_waiting`) or `data_received`. */
export function sample(metric: string, value: number, tags: Record<string, string>, atMs: number): string {
  return point(metric, value, tags, atMs);
}

export function vus(count: number, atMs: number): string {
  return point("vus", count, {}, atMs);
}

export function check(input: { step: string; journey: string; passed: boolean; atMs: number }): string {
  return point("checks", input.passed ? 1 : 0, { step: input.step, journey: input.journey, check: "status" }, input.atMs);
}

export function counter(metric: string, tags: Record<string, string>, atMs: number): string {
  return point(metric, 1, tags, atMs);
}

export function iteration(atMs: number): string {
  return point("iterations", 1, {}, atMs);
}

/** A token-refresh request: no `step` tag, so it never enters a step's figures (research D12). */
export function tokenRefreshReq(input: { atMs: number; status: number; durationMs?: number }): string[] {
  const tags = { apipilot_kind: "token-refresh", status: String(input.status), method: "POST" };
  return [
    point("http_reqs", 1, tags, input.atMs),
    point("http_req_duration", input.durationMs ?? 20, tags, input.atMs),
    point("apipilot_token_refresh", 1, { outcome: input.status >= 200 && input.status < 300 ? "ok" : "failed" }, input.atMs),
  ];
}

export function stream(lines: Array<string | string[]>): string {
  return `${lines.flat().join("\n")}\n`;
}
