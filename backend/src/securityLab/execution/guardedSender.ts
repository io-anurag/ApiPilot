import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { EvidenceErrorCategory } from "@apipilot/shared-domain";
import { MAX_REDIRECT_HOPS, RESPONSE_READ_CAP_BYTES } from "../config";
import { BLOCK_REASONS, classifyAddress, describeBlockReason, evaluateDestination, normalizeHost, selectAllowedAddress, type BlockReason, type DestinationVerdict } from "./destinationPolicy";
import type { AddressResolver, DestinationRecord, OutboundRequest, RedirectRecord, SendOptions, SendOutcome, Sender } from "./types";

/**
 * The only code in Security Lab that opens a connection (specs/057 research R10, contracts/execution-safety-rules.md
 * section 2). It enforces the destination policy at the one place it cannot be bypassed: the socket's `lookup`.
 * Every candidate address a name resolves to is judged there, and the connection goes only to an allowed one, so the
 * address that was checked is the address that is connected to. A re-resolution is judged again because each
 * connection performs its own lookup, which is what closes the check-then-connect window DNS rebinding relies on.
 *
 * Redirects are never followed by the library. A 3xx with a `Location` is judged as a brand-new destination and
 * followed only if allowed, at most `MAX_REDIRECT_HOPS` times, dropping credentials on a cross-origin hop and
 * counting each hop against the request budget. Proxy environment variables are ignored (a fresh agent per request
 * is used, and none is configured), certificate verification is on unless the profile is local and relaxes it, and a
 * response is read only up to a byte cap. The sender never throws: every failure is a category on the outcome.
 */

export const systemAddressResolver: AddressResolver = async (hostname) => {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_DROPPED = ["authorization", "cookie", "proxy-authorization"];

interface HopResult {
  readonly status?: number;
  readonly headers: Record<string, string>;
  readonly bodyText: string;
  readonly truncated: boolean;
  readonly error?: EvidenceErrorCategory;
  readonly destination: DestinationRecord;
}

const originOf = (url: URL) => `${url.protocol}//${url.host}`;
const bareHost = (url: URL) => (url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname);
const portOf = (url: URL) => (url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port));
/** Origin and path only, so no query, fragment or userinfo can leave in a record. */
const safeTarget = (url: URL) => `${url.origin}${url.pathname}`;

function categoryOf(error: unknown): EvidenceErrorCategory {
  const code = (error as NodeJS.ErrnoException | undefined)?.code ?? "";
  if (code === "SL_BLOCKED") return "blocked";
  if (code === "SL_TIMEOUT" || code === "ETIMEDOUT") return "timeout";
  if (code === "SL_ABORTED" || code === "ABORT_ERR") return "aborted";
  if (code.startsWith("ERR_TLS") || code.startsWith("CERT_") || code.includes("SELF_SIGNED") || code.includes("UNABLE_TO_VERIFY") || code === "ERR_SSL_WRONG_VERSION_NUMBER") return "tls";
  return "connect";
}

function blockedOutcomeFor(url: URL, verdict: Extract<DestinationVerdict, { allowed: false }>, startedAt: number): SendOutcome {
  return {
    headers: {},
    bodyText: "",
    truncated: false,
    durationMs: Date.now() - startedAt,
    destination: { host: verdict.host ?? bareHost(url), port: verdict.port ?? portOf(url), ...(verdict.addressClass ? { addressClass: verdict.addressClass } : {}), verdict: "blocked", reason: verdict.reason },
    redirects: [],
    requestsSent: 0,
    error: { category: "blocked" },
  };
}

export function createGuardedSender(resolve: AddressResolver = systemAddressResolver): Sender {
  function hop(url: URL, method: string, headers: Record<string, string>, body: string | undefined, options: SendOptions, deadline: number): Promise<HopResult> {
    return new Promise<HopResult>((settle) => {
      const host = normalizeHost(bareHost(url));
      const literal = isIP(host) !== 0;
      let connectedClass = literal ? classifyAddress(host) : undefined;
      let blockReason: string | undefined;
      let finished = false;
      const deadlineTimer: { handle?: NodeJS.Timeout } = {};
      let request: http.ClientRequest | undefined;
      let failure: EvidenceErrorCategory | undefined;

      const destination = (): DestinationRecord => ({
        host,
        port: portOf(url),
        ...(connectedClass ? { addressClass: connectedClass } : {}),
        verdict: blockReason ? "blocked" : "allowed",
        ...(blockReason ? { reason: blockReason } : {}),
      });
      const finish = (result: Omit<HopResult, "destination">) => {
        if (finished) return;
        finished = true;
        if (deadlineTimer.handle) clearTimeout(deadlineTimer.handle);
        options.signal?.removeEventListener("abort", onAbort);
        settle({ ...result, destination: destination() });
      };
      const fail = (category: EvidenceErrorCategory) => {
        failure ??= category;
        request?.destroy(Object.assign(new Error(category), { code: category === "timeout" ? "SL_TIMEOUT" : "SL_ABORTED" }));
        finish({ headers: {}, bodyText: "", truncated: false, error: category });
      };
      const onAbort = () => fail("aborted");

      if (options.signal?.aborted) return fail("aborted");
      const remaining = deadline - Date.now();
      if (remaining <= 0) return fail("timeout");
      deadlineTimer.handle = setTimeout(() => fail("timeout"), remaining);
      options.signal?.addEventListener("abort", onAbort, { once: true });

      const lookup = (name: string, lookupOptions: { all?: boolean }, callback: (error: Error | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void) => {
        resolve(name)
          .then((candidates) => {
            const chosen = selectAllowedAddress(options.policy, url, candidates);
            if (!chosen.allowed) {
              blockReason = chosen.verdict.allowed ? "restricted_address_blocked" : chosen.verdict.reason;
              connectedClass = chosen.verdict.allowed ? undefined : chosen.verdict.addressClass;
              callback(Object.assign(new Error("destination blocked"), { code: "SL_BLOCKED" }));
              return;
            }
            connectedClass = classifyAddress(chosen.address);
            const family = isIP(chosen.address);
            if (lookupOptions.all) callback(null, [{ address: chosen.address, family }]);
            else callback(null, chosen.address, family);
          })
          .catch((error: unknown) => callback(error instanceof Error ? error : new Error("name resolution failed")));
      };

      const library = url.protocol === "https:" ? https : http;
      try {
        request = library.request(
          {
            hostname: bareHost(url),
            port: portOf(url),
            path: `${url.pathname}${url.search}`,
            method,
            headers: body === undefined ? headers : { ...headers, "content-length": String(Buffer.byteLength(body)) },
            agent: false,
            lookup: lookup as http.RequestOptions["lookup"],
            ...(url.protocol === "https:" ? { rejectUnauthorized: options.tlsPolicy !== "relaxed-local", ...(literal ? {} : { servername: bareHost(url) }) } : {}),
          },
          (response) => {
            const chunks: Buffer[] = [];
            let size = 0;
            let truncated = false;
            const done = () => {
              const responseHeaders: Record<string, string> = {};
              for (const [name, value] of Object.entries(response.headers)) {
                if (value !== undefined) responseHeaders[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
              }
              finish({ status: response.statusCode, headers: responseHeaders, bodyText: Buffer.concat(chunks).toString("utf8"), truncated });
            };
            response.on("data", (chunk: Buffer) => {
              if (truncated) return;
              const room = RESPONSE_READ_CAP_BYTES - size;
              if (chunk.length > room) {
                chunks.push(chunk.subarray(0, room));
                size += room;
                truncated = true;
                response.destroy();
                done();
                return;
              }
              chunks.push(chunk);
              size += chunk.length;
            });
            response.on("end", done);
            response.on("error", () => finish({ headers: {}, bodyText: "", truncated: false, error: failure ?? "connect" }));
            response.on("close", done);
          },
        );
      } catch {
        return finish({ headers: {}, bodyText: "", truncated: false, error: "connect" });
      }
      request.on("error", (error) => {
        finish({ headers: {}, bodyText: "", truncated: false, error: failure ?? categoryOf(error) });
      });
      if (body !== undefined) request.write(body);
      request.end();
    });
  }

  return {
    async send(request: OutboundRequest, options: SendOptions): Promise<SendOutcome> {
      const startedAt = Date.now();
      const deadline = startedAt + options.timeoutMs;
      let current: URL;
      try {
        current = new URL(request.url);
      } catch {
        return blockedOutcomeFor(new URL("http://invalid.invalid"), { allowed: false, reason: "scheme_not_allowed" }, startedAt);
      }

      let method = request.method;
      let headers: Record<string, string> = { ...request.headers };
      let body = request.body;
      const redirects: RedirectRecord[] = [];
      let requestsSent = 0;
      let first: DestinationRecord | undefined;

      for (let hops = 0; ; hops += 1) {
        const verdict = evaluateDestination(options.policy, current);
        if (!verdict.allowed) return blockedOutcomeFor(current, verdict, startedAt);

        const result = await hop(current, method, headers, body, options, deadline);
        requestsSent += 1;
        first ??= result.destination;
        const outcome = (): SendOutcome => ({
          ...(result.status === undefined ? {} : { status: result.status }),
          headers: result.headers,
          bodyText: result.bodyText,
          truncated: result.truncated,
          durationMs: Date.now() - startedAt,
          destination: first as DestinationRecord,
          redirects,
          requestsSent,
          ...(result.error ? { error: { category: result.error } } : {}),
        });

        const location = result.headers.location;
        if (result.error || result.status === undefined || !REDIRECT_STATUSES.has(result.status) || location === undefined) return outcome();

        const block = (reason: string): SendOutcome => {
          redirects.push({ to: (() => { try { return safeTarget(new URL(location, current)); } catch { return "unparseable"; } })(), verdict: "blocked", reason });
          return outcome();
        };
        if (hops >= MAX_REDIRECT_HOPS) return block("redirect_hop_limit");
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return block("redirect_target_invalid");
        }
        const nextVerdict = evaluateDestination(options.policy, next);
        if (!nextVerdict.allowed) {
          redirects.push({ to: safeTarget(next), verdict: "blocked", reason: nextVerdict.reason });
          return outcome();
        }
        if (!options.reserveHop()) return block("budget_exhausted");

        if (originOf(next) !== originOf(current)) headers = Object.fromEntries(Object.entries(headers).filter(([name]) => !CROSS_ORIGIN_DROPPED.includes(name.toLowerCase())));
        if (result.status === 303 || ((result.status === 301 || result.status === 302) && method === "POST")) {
          method = method === "HEAD" ? "HEAD" : "GET";
          body = undefined;
          headers = Object.fromEntries(Object.entries(headers).filter(([name]) => !["content-type", "content-length"].includes(name.toLowerCase())));
        }
        redirects.push({ to: safeTarget(next), verdict: "followed" });
        current = next;
      }
    },
  };
}

const REDIRECT_REASONS: Readonly<Record<string, string>> = {
  redirect_hop_limit: `The response redirected more than ${MAX_REDIRECT_HOPS} times, so the redirect was not followed.`,
  redirect_target_invalid: "The redirect named a location that is not a valid URL, so it was not followed.",
  budget_exhausted: "The request budget was used up, so the redirect was not followed.",
};

/** The sentence recorded for a destination or redirect the policy refused. */
export function describeBlock(reason: string | undefined): string {
  if (reason === undefined) return "The destination was blocked.";
  if (reason in REDIRECT_REASONS) return REDIRECT_REASONS[reason];
  if ((BLOCK_REASONS as readonly string[]).includes(reason)) return describeBlockReason(reason as BlockReason);
  return `The destination was blocked (${reason}).`;
}
