/**
 * Reads k6's HTTP debug records (`--http-debug=full --log-format json`) for a Debug run of a user script
 * (specs/053-user-script-debug-run FR-003, FR-004; constitution v3.1.0, XVII). k6 writes each request and
 * each response as its own JSON log record on stderr, labelled `source: "http-debug"` and tied together by
 * `request_id`; the script's own `console` output is a record with another `source`, and every record that
 * is not an HTTP debug record is dropped unread here. Nothing is logged and nothing leaves memory except
 * through the masker of the Debug run service.
 *
 * Observed against k6 2.3.0 (2026-10-15): a request record is "Request:\n<METHOD> <target> HTTP/x\n<headers>\n\n<body>\n",
 * a response record "Response:\nHTTP/x <status> <text>\n<headers>\n\n<body>\n", each with one trailing newline
 * added; a chunked body is logged with its chunk framing; a compressed body as its compressed bytes; a request
 * that got no response has only the request record; the scheme and the time of a request are not logged.
 */

/** A record longer than this is not parsed: the exchange it belongs to is kept without its response. */
export const MAX_DEBUG_RECORD_CHARS = 4 * 1024 * 1024;

export interface RawHeader {
  name: string;
  value: string;
}

export interface RawRequest {
  method: string;
  /** The `Host` header; empty when the request had none. */
  host: string;
  /** The request target as sent: a path and query, or an absolute URL for a proxied request. */
  target: string;
  headers: RawHeader[];
  body: string;
}

export interface RawResponse {
  status: number;
  statusText: string;
  headers: RawHeader[];
  /** The body with any chunk framing removed. */
  body: string;
  /** The `Content-Encoding` the body was sent with, when it is not the identity encoding: the text is then compressed bytes. */
  compressedWith: string | null;
}

export interface RawExchange {
  requestId: string;
  /** The request's `name` tag, when the script set one. */
  name: string | null;
  request: RawRequest;
  response: RawResponse | null;
}

export interface DebugLogCounts {
  lines: number;
  debugRecords: number;
  /** Records of every other source, console output among them: dropped unread. */
  droppedRecords: number;
  unreadableLines: number;
  oversizedRecords: number;
}

export interface DebugLogCollector {
  onStderrLine(line: string): void;
  exchanges(): RawExchange[];
  counts(): DebugLogCounts;
  /** True once a request beyond `maxExchanges` was seen: the run should be cut off. */
  limitReached(): boolean;
}

function headerValue(headers: readonly RawHeader[], name: string): string | null {
  const lower = name.toLowerCase();
  return headers.find((header) => header.name.toLowerCase() === lower)?.value ?? null;
}

/** Splits a record's text into its start line, headers and body (everything after the first blank line). */
function splitRecord(text: string): { startLine: string; headers: RawHeader[]; body: string } | null {
  const normal = text.replace(/\r\n/g, "\n");
  const firstBreak = normal.indexOf("\n");
  if (firstBreak < 0) return null;
  const startLine = normal.slice(0, firstBreak);
  const rest = normal.slice(firstBreak + 1);
  const blank = rest.indexOf("\n\n");
  const headText = blank < 0 ? rest : rest.slice(0, blank);
  // k6 adds one newline after the body; remove exactly that one.
  const rawBody = blank < 0 ? "" : rest.slice(blank + 2);
  const body = rawBody.endsWith("\n") ? rawBody.slice(0, -1) : rawBody;
  const headers: RawHeader[] = [];
  for (const line of headText.split("\n")) {
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
  }
  return { startLine, headers, body };
}

/** Removes HTTP chunk framing; returns the text unchanged when it is not well-formed framing. */
export function decodeChunked(framed: string): string {
  const bytes = Buffer.from(framed, "utf8");
  const parts: Buffer[] = [];
  let at = 0;
  const lineEnd = (from: number): number => bytes.indexOf(0x0a, from);
  for (;;) {
    const end = lineEnd(at);
    if (end < 0) return framed;
    const sizeText = bytes.subarray(at, end).toString("utf8").replace(/\r$/, "").split(";")[0].trim();
    if (!/^[0-9a-fA-F]+$/.test(sizeText)) return framed;
    const size = Number.parseInt(sizeText, 16);
    at = end + 1;
    if (size === 0) return Buffer.concat(parts).toString("utf8");
    if (at + size > bytes.length) return framed;
    parts.push(bytes.subarray(at, at + size));
    at += size;
    if (bytes[at] === 0x0d) at += 1;
    if (bytes[at] === 0x0a) at += 1;
  }
}

function parseRequest(text: string): RawRequest | null {
  const parts = splitRecord(text);
  if (!parts) return null;
  const line = /^([A-Za-z]+) (\S+) HTTP\/\d(?:\.\d)?$/.exec(parts.startLine);
  if (!line) return null;
  return { method: line[1].toUpperCase(), host: headerValue(parts.headers, "host") ?? "", target: line[2], headers: parts.headers, body: parts.body };
}

function parseResponse(text: string): RawResponse | null {
  const parts = splitRecord(text);
  if (!parts) return null;
  const line = /^HTTP\/\d(?:\.\d)? (\d{3})(?: (.*))?$/.exec(parts.startLine);
  if (!line) return null;
  const transfer = headerValue(parts.headers, "transfer-encoding")?.toLowerCase() ?? "";
  const encoding = headerValue(parts.headers, "content-encoding")?.trim().toLowerCase() ?? "";
  return {
    status: Number(line[1]),
    statusText: (line[2] ?? "").trim(),
    headers: parts.headers,
    body: transfer.includes("chunked") ? decodeChunked(parts.body) : parts.body,
    compressedWith: encoding === "" || encoding === "identity" ? null : encoding,
  };
}

export function createDebugLogCollector(options: { maxExchanges: number }): DebugLogCollector {
  const exchanges: RawExchange[] = [];
  const byId = new Map<string, RawExchange>();
  const counts: DebugLogCounts = { lines: 0, debugRecords: 0, droppedRecords: 0, unreadableLines: 0, oversizedRecords: 0 };
  let limitReached = false;

  return {
    onStderrLine(line) {
      counts.lines += 1;
      if (line.length > MAX_DEBUG_RECORD_CHARS) {
        // Not parsed: too large to hold. A response this large leaves its request listed with no response.
        counts.oversizedRecords += 1;
        return;
      }
      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        counts.unreadableLines += 1;
        return;
      }
      if (typeof record !== "object" || record === null) {
        counts.unreadableLines += 1;
        return;
      }
      const fields = record as Record<string, unknown>;
      if (fields.source !== "http-debug" || typeof fields.msg !== "string" || typeof fields.request_id !== "string") {
        counts.droppedRecords += 1;
        return;
      }
      counts.debugRecords += 1;
      const requestId = fields.request_id;
      if (fields.msg.startsWith("Request:\n")) {
        if (exchanges.length >= options.maxExchanges) {
          limitReached = true;
          return;
        }
        const request = parseRequest(fields.msg.slice("Request:\n".length));
        if (!request) return;
        const exchange: RawExchange = { requestId, name: typeof fields.name === "string" && fields.name !== "" ? fields.name : null, request, response: null };
        exchanges.push(exchange);
        byId.set(requestId, exchange);
        return;
      }
      if (fields.msg.startsWith("Response:\n")) {
        const exchange = byId.get(requestId);
        if (!exchange) return;
        exchange.response = parseResponse(fields.msg.slice("Response:\n".length));
      }
    },
    exchanges: () => exchanges,
    counts: () => ({ ...counts }),
    limitReached: () => limitReached,
  };
}
