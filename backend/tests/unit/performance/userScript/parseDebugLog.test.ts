import { describe, expect, it } from "vitest";
import { buildUserScriptDebugK6Args } from "../../../../src/performance/k6/runner";
import { createDebugLogCollector, decodeChunked, MAX_DEBUG_RECORD_CHARS } from "../../../../src/performance/userScript/debug/parseDebugLog";

/**
 * AP-053 (specs/053-user-script-debug-run FR-002 to FR-004): k6's HTTP debug records, in the shapes checked
 * against k6 2.3.0 on 2026-10-15, become exchanges; every other record is dropped unread.
 */

const record = (msg: string, requestId: string, extra: Record<string, unknown> = {}) => JSON.stringify({ source: "http-debug", level: "info", msg, request_id: requestId, vu: 1, iter: 0, ...extra });

const GET_BAD = "Request:\nGET /bad?token=abc HTTP/1.1\nHost: 127.0.0.1:4600\nUser-Agent: Grafana k6/2.3.0\nAuthorization: Bearer abc\nAccept-Encoding: gzip\n\n\n";
const RESPONSE_500 = 'Response:\nHTTP/1.1 500 Internal Server Error\nTransfer-Encoding: chunked\nContent-Type: application/json\n\n25\n{"error":"boom SECRET-RESPONSE-BODY"}\n0\n\n\n';
const POST_ORDERS = 'Request:\nPOST /orders HTTP/1.1\nHost: 127.0.0.1:4600\nContent-Type: application/json\n\n{"a":1}\n';
const RESPONSE_422 = 'Response:\nHTTP/1.1 422 Unprocessable Entity\nContent-Length: 25\nContent-Type: application/json\n\n{"error":"invalid order"}\n';

function collect(lines: string[], maxExchanges = 200) {
  const collector = createDebugLogCollector({ maxExchanges });
  for (const line of lines) collector.onStderrLine(line);
  return collector;
}

describe("buildUserScriptDebugK6Args", () => {
  it("is pinned: one virtual user, one iteration, the HTTP debug log, JSON logs, and nothing that writes or sends elsewhere", () => {
    expect(buildUserScriptDebugK6Args("/run/script.js")).toEqual(["run", "--no-usage-report", "--quiet", "--no-color", "--log-format", "json", "--http-debug=full", "--vus", "1", "--iterations", "1", "/run/script.js"]);
    const args = buildUserScriptDebugK6Args("/run/script.js").join(" ");
    for (const forbidden of ["--out", "--stage", "--summary-export", "cloud", "--duration"]) expect(args).not.toContain(forbidden);
  });
});

describe("the HTTP debug log", () => {
  it("pairs a request with its response by request id, and decodes a chunked body", () => {
    const [bad, orders] = collect([record(GET_BAD, "a1", { name: "Bad" }), record(RESPONSE_500, "a1", { name: "Bad" }), record(POST_ORDERS, "b2"), record(RESPONSE_422, "b2")]).exchanges();
    expect(bad).toMatchObject({ name: "Bad", request: { method: "GET", host: "127.0.0.1:4600", target: "/bad?token=abc", body: "" }, response: { status: 500, statusText: "Internal Server Error", compressedWith: null } });
    expect(bad.request.headers).toContainEqual({ name: "Authorization", value: "Bearer abc" });
    expect(bad.response!.body).toBe('{"error":"boom SECRET-RESPONSE-BODY"}');
    expect(orders).toMatchObject({ name: null, request: { method: "POST", body: '{"a":1}' }, response: { status: 422, body: '{"error":"invalid order"}' } });
  });

  it("keeps a request that got no response, and each redirect hop as its own exchange", () => {
    const exchanges = collect([
      record("Request:\nGET /redir HTTP/1.1\nHost: h\n\n\n", "r1"),
      record("Response:\nHTTP/1.1 302 Found\nLocation: /ok\n\n0\n\n\n", "r1"),
      record("Request:\nGET /ok HTTP/1.1\nHost: h\nReferer: http://h/redir\n\n\n", "r2"),
      record("Request:\nGET /drop HTTP/1.1\nHost: h\n\n\n", "r3"),
    ]).exchanges();
    expect(exchanges.map((exchange) => [exchange.request.target, exchange.response?.status ?? null])).toEqual([
      ["/redir", 302],
      ["/ok", null],
      ["/drop", null],
    ]);
  });

  it("marks a compressed body, whose text is compressed bytes, and leaves an identity encoding alone", () => {
    const [zipped, plain] = collect([
      record("Request:\nGET /gz HTTP/1.1\nHost: h\n\n\n", "z1"),
      record("Response:\nHTTP/1.1 200 OK\nContent-Encoding: gzip\nContent-Type: application/json\nContent-Length: 3\n\n\u001f�\b\n", "z1"),
      record("Request:\nGET /id HTTP/1.1\nHost: h\n\n\n", "z2"),
      record("Response:\nHTTP/1.1 200 OK\nContent-Encoding: identity\nContent-Length: 2\n\n{}\n", "z2"),
    ]).exchanges();
    expect(zipped.response).toMatchObject({ compressedWith: "gzip" });
    expect(plain.response).toMatchObject({ compressedWith: null, body: "{}" });
  });

  it("drops the script's own console output and every other record unread, and counts them", () => {
    const collector = collect([
      JSON.stringify({ level: "info", msg: "hello SECRET-CONSOLE", source: "console" }),
      JSON.stringify({ level: "warning", msg: "Request Failed", error: 'Get "http://h/x?token=SECRET-ERROR": EOF' }),
      "not json at all",
      record(GET_BAD, "a1"),
    ]);
    expect(collector.counts()).toMatchObject({ lines: 4, debugRecords: 1, droppedRecords: 2, unreadableLines: 1 });
    expect(JSON.stringify(collector.exchanges())).not.toContain("SECRET-CONSOLE");
    expect(JSON.stringify(collector.exchanges())).not.toContain("SECRET-ERROR");
  });

  it("cannot be spoofed by a console line that looks like a request", () => {
    const forged = JSON.stringify({ level: "info", msg: GET_BAD, source: "console", request_id: "evil" });
    expect(collect([forged]).exchanges()).toEqual([]);
  });

  it("stops at the exchange limit and says so", () => {
    const lines = Array.from({ length: 5 }, (_unused, n) => record(`Request:\nGET /n${n} HTTP/1.1\nHost: h\n\n\n`, `id${n}`));
    const collector = collect(lines, 3);
    expect(collector.exchanges()).toHaveLength(3);
    expect(collector.limitReached()).toBe(true);
    expect(collect(lines, 5).limitReached()).toBe(false);
  });

  it("does not parse an oversized record, and counts it", () => {
    const collector = collect(["x".repeat(MAX_DEBUG_RECORD_CHARS + 1), record(GET_BAD, "a1")]);
    expect(collector.counts().oversizedRecords).toBe(1);
    expect(collector.exchanges()).toHaveLength(1);
  });

  it("takes an absolute request target as sent (a proxied request)", () => {
    const [exchange] = collect([record("Request:\nGET http://h.test/a?b=1 HTTP/1.1\nHost: h.test\n\n\n", "p1")]).exchanges();
    expect(exchange.request.target).toBe("http://h.test/a?b=1");
  });
});

describe("decodeChunked", () => {
  it("removes the framing, counting bytes, with LF or CRLF", () => {
    expect(decodeChunked("5\nhello\n7\n wörld\n0\n\n")).toBe("hello wörld");
    expect(decodeChunked("5\r\nhello\r\n0\r\n\r\n")).toBe("hello");
  });

  it("returns text that is not framing unchanged", () => {
    expect(decodeChunked("not framing")).toBe("not framing");
    expect(decodeChunked("zz\nhello\n0\n")).toBe("zz\nhello\n0\n");
    expect(decodeChunked("ff\nshort\n0\n")).toBe("ff\nshort\n0\n");
  });
});
