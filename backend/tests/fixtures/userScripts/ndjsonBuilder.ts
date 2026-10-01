/**
 * Builds k6 `--out json` lines for a user-supplied script's run (specs/034-run-user-k6-script
 * tasks T004), in the same shape as `../performance/ndjson.ts`, but with the tags a user script
 * carries under research R10's `--system-tags`: `name`, `url`, `method`, `status`, `group`,
 * `check`, `expected_response`, `scenario`. The three fixture streams are built here rather than
 * stored as files, so their timestamps and counts stay readable in one place.
 */

export const USER_STREAM_START_MS = Date.parse("2026-10-01T12:00:00.000Z");

function time(atMs: number): string {
  return new Date(USER_STREAM_START_MS + atMs).toISOString();
}

export function point(metric: string, value: number, tags: Record<string, string>, atMs: number): string {
  return JSON.stringify({ type: "Point", metric, data: { time: time(atMs), value, tags } });
}

export function declaration(name: string, type: "counter" | "trend" | "rate" | "gauge", thresholds: string[] = []): string {
  return JSON.stringify({
    type: "Metric",
    metric: name,
    data: { name, type, contains: type === "trend" ? "time" : "default", thresholds, submetrics: null },
  });
}

export interface UserRequestInput {
  url: string;
  /** Defaults to `url`, which is what k6 sets when the script names nothing. */
  name?: string;
  method: string;
  status: number;
  durationMs: number;
  atMs: number;
  /** k6's own verdict (`expected_response`); defaults to 2xx/3xx. */
  failed?: boolean;
  group?: string;
  errorCode?: number;
  /** k6's `ip` tag; defaults to the URL's host when it is an address, else 203.0.113.10. */
  ip?: string;
}

function addressOf(url: string): string {
  const host = new URL(url).hostname;
  return /^\d+(\.\d+){3}$/.test(host) ? host : "203.0.113.10";
}

/** One request: `http_reqs`, `http_req_duration`, `http_req_failed` and the six phase samples. */
export function userRequest(input: UserRequestInput): string[] {
  const failed = input.failed ?? !(input.status >= 200 && input.status < 400);
  // As real k6 does (checked against k6 2.3.0): a named request's `url` tag holds its name, and
  // `ip` is the address it connected to.
  const tags: Record<string, string> = {
    name: input.name ?? input.url,
    url: input.name ?? input.url,
    ip: input.ip ?? addressOf(input.url),
    method: input.method,
    status: String(input.status),
    proto: "HTTP/1.1",
    scenario: "default",
    expected_response: failed ? "false" : "true",
    group: input.group ?? "",
  };
  if (input.errorCode !== undefined) tags.error_code = String(input.errorCode);
  const lines = [
    point("http_reqs", 1, tags, input.atMs),
    point("http_req_duration", input.durationMs, tags, input.atMs),
    point("http_req_failed", failed ? 1 : 0, tags, input.atMs),
  ];
  const phases: [string, number][] = [
    ["http_req_blocked", 0.5],
    ["http_req_connecting", 0.25],
    ["http_req_tls_handshaking", 0],
    ["http_req_sending", 0.05],
    ["http_req_waiting", input.durationMs * 0.9],
    ["http_req_receiving", input.durationMs * 0.1],
  ];
  for (const [metric, value] of phases) lines.push(point(metric, value, tags, input.atMs));
  return lines;
}

export function check(name: string, passed: boolean, atMs: number, group = ""): string {
  return point("checks", passed ? 1 : 0, { check: name, group, scenario: "default" }, atMs);
}

const BUILTIN_DECLARATIONS = [
  declaration("http_reqs", "counter"),
  declaration("http_req_duration", "trend", ["p(95)<500"]),
  declaration("http_req_failed", "rate"),
  declaration("checks", "rate"),
  declaration("vus", "gauge"),
  declaration("iterations", "counter"),
  declaration("iteration_duration", "trend"),
  declaration("data_sent", "counter"),
  declaration("data_received", "counter"),
  declaration("group_duration", "trend"),
];

/** `basic.ndjson`: named requests, a second host, checks, a group, four custom metrics. */
export function basicLines(): string[] {
  const lines = [
    ...BUILTIN_DECLARATIONS,
    declaration("order_latency", "trend"),
    declaration("orders_created", "counter"),
    declaration("order_errors", "rate"),
    declaration("queue_depth", "gauge"),
    point("vus", 2, {}, 0),
  ];
  for (let i = 0; i < 10; i += 1) {
    const at = i * 1_000;
    lines.push(...userRequest({ url: "http://127.0.0.1:4600/orders", name: "GET /orders", method: "GET", status: 200, durationMs: 10 + i, atMs: at, group: "::orders" }));
    lines.push(...userRequest({ url: "http://127.0.0.1:4600/orders", name: "POST /orders", method: "POST", status: i < 8 ? 201 : 500, durationMs: 40 + i, atMs: at + 100, group: "::orders" }));
    lines.push(...userRequest({ url: "https://audit.example.test/log", name: "POST /log", method: "POST", status: 202, durationMs: 5, atMs: at + 200 }));
    lines.push(check("list is 200", true, at + 50, "::orders"));
    lines.push(check("created", i < 8, at + 150, "::orders"));
    lines.push(point("order_latency", 40 + i, { scenario: "default" }, at + 100));
    lines.push(point("orders_created", 1, { scenario: "default" }, at + 100));
    lines.push(point("order_errors", i < 8 ? 0 : 1, { scenario: "default" }, at + 100));
    lines.push(point("queue_depth", 3 + i, { scenario: "default" }, at + 100));
    lines.push(point("group_duration", 60 + i, { group: "::orders", scenario: "default" }, at + 250));
    lines.push(point("iterations", 1, { scenario: "default" }, at + 300));
    lines.push(point("iteration_duration", 300 + i, { scenario: "default" }, at + 300));
    lines.push(point("data_sent", 100, { scenario: "default" }, at + 300));
    lines.push(point("data_received", 1_000, { scenario: "default" }, at + 300));
  }
  return lines;
}

/** `unnamed-many.ndjson`: 130 distinct unnamed URLs with user info and query strings. */
export function unnamedManyLines(): string[] {
  const lines = [...BUILTIN_DECLARATIONS, point("vus", 1, {}, 0)];
  for (let id = 0; id < 130; id += 1) {
    lines.push(...userRequest({ url: `http://user:pw@127.0.0.1:4600/customers/${id}?token=abc&page=${id}#frag`, method: "GET", status: 200, durationMs: 8, atMs: id * 10 }));
  }
  return lines;
}

/** `long-soak.ndjson`: one request every 5 s for 2,500 s, so more than 200 five-second buckets. */
export function longSoakLines(): string[] {
  const lines = [...BUILTIN_DECLARATIONS, point("vus", 1, {}, 0)];
  for (let i = 0; i < 500; i += 1) {
    lines.push(...userRequest({ url: "http://127.0.0.1:4600/soak", name: "GET /soak", method: "GET", status: 200, durationMs: 12, atMs: i * 5_000 }));
  }
  return lines;
}
