import type { DebugNoResponseReason } from "@apipilot/shared-domain";

/**
 * Sends one request of a Debug run (specs/039-chain-debug-run research R4). The first in-process
 * outbound HTTP client in the backend, so it is small and strict: a per-request timeout, a cap on how
 * much of a response is read, redirects followed by hand (up to 10, as k6 does) with a host check on
 * every hop, and no retries. It sits behind the `Sender` interface so tests use a fake and never the
 * network. It never logs, and it holds nothing after it returns.
 */

export const REQUEST_TIMEOUT_MS = 30_000;
export const READ_CAP_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 10;

export interface SendInput {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  timeoutMs: number;
  signal: AbortSignal;
  /** Whether a request to this URL (the first or a redirect hop) is to an allowed host. */
  allowUrl: (url: URL) => boolean;
}

export type SendResult =
  | {
      kind: "response";
      status: number;
      statusText: string;
      headers: [string, string][];
      contentType: string | null;
      body: Uint8Array;
      /** The body was longer than `READ_CAP_BYTES` and only the first part was read. */
      bodyTruncated: boolean;
      durationMs: number;
      /** The URLs followed before this response, in order. */
      redirects: string[];
      /** The host a redirect pointed to that is not allowed; the redirect was not followed. */
      redirectBlockedTo?: string;
    }
  | { kind: "no-response"; reason: DebugNoResponseReason; durationMs: number; redirects: string[] };

export interface Sender {
  send(input: SendInput): Promise<SendResult>;
}

const STRIPPED_ON_CROSS_ORIGIN = ["authorization", "cookie", "proxy-authorization", "www-authenticate"];
const CONTENT_HEADERS = ["content-type", "content-length", "content-encoding", "content-language", "content-location"];

function reasonOf(error: unknown, outerSignal: AbortSignal): DebugNoResponseReason {
  if (outerSignal.aborted) return "aborted";
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
  const code = cause?.code ?? "";
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return "refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT") return "timeout";
  return "error";
}

async function readCapped(response: Response, cap: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = cap - total;
    if (value.length > room) {
      if (room > 0) chunks.push(value.subarray(0, room));
      total += Math.max(room, 0);
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, truncated };
}

/** `fetch`, with a deadline, manual redirects and a read cap. */
export function createFetchSender(fetchImpl: typeof fetch = fetch, nowMs: () => number = Date.now): Sender {
  return {
    async send(input) {
      const startedAt = nowMs();
      const redirects: string[] = [];
      let method = input.method;
      let body = input.body;
      let headers = { ...input.headers };
      let url = new URL(input.url);
      if (body !== null && (method === "GET" || method === "HEAD")) return { kind: "no-response", reason: "unsupported-request", durationMs: 0, redirects };
      const signal = AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)]);
      try {
        for (let hop = 0; ; hop++) {
          const response = await fetchImpl(url, { method, headers, body, redirect: "manual", signal });
          const location = response.headers.get("location");
          const redirecting = [301, 302, 303, 307, 308].includes(response.status) && location !== null;
          if (redirecting && hop < MAX_REDIRECTS) {
            const next = new URL(location, url);
            if (!input.allowUrl(next)) {
              const read = await readCapped(response, READ_CAP_BYTES);
              return finish(response, read, startedAt, nowMs, redirects, next.host);
            }
            await response.body?.cancel();
            redirects.push(next.toString());
            if (next.origin !== url.origin) headers = withoutHeaders(headers, STRIPPED_ON_CROSS_ORIGIN);
            if (response.status === 303 || ((response.status === 301 || response.status === 302) && method !== "GET" && method !== "HEAD")) {
              method = method === "HEAD" ? "HEAD" : "GET";
              body = null;
              headers = withoutHeaders(headers, CONTENT_HEADERS);
            }
            url = next;
            continue;
          }
          const read = await readCapped(response, READ_CAP_BYTES);
          return finish(response, read, startedAt, nowMs, redirects);
        }
      } catch (error) {
        return { kind: "no-response", reason: reasonOf(error, input.signal), durationMs: nowMs() - startedAt, redirects };
      }
    },
  };
}

function withoutHeaders(headers: Record<string, string>, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !names.includes(name.toLowerCase())));
}

function finish(response: Response, read: { bytes: Uint8Array; truncated: boolean }, startedAt: number, nowMs: () => number, redirects: string[], blockedHost?: string): SendResult {
  const headers: [string, string][] = [];
  response.headers.forEach((value, name) => headers.push([name, value]));
  return {
    kind: "response",
    status: response.status,
    statusText: response.statusText,
    headers,
    contentType: response.headers.get("content-type"),
    body: read.bytes,
    bodyTruncated: read.truncated,
    durationMs: nowMs() - startedAt,
    redirects,
    ...(blockedHost === undefined ? {} : { redirectBlockedTo: blockedHost }),
  };
}
