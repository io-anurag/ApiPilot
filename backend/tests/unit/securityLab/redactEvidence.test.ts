import { describe, expect, it } from "vitest";
import { EVIDENCE_BODY_EXCERPT_BYTES } from "../../../src/securityLab/config";
import { SELECTED_RESPONSE_HEADERS, selectResponseHeaders } from "../../../src/securityLab/evidence/excerpt";
import { buildEvidenceRecord } from "../../../src/securityLab/evidence/redactEvidence";
import type { OutboundRequest, SendOutcome } from "../../../src/securityLab/execution/types";
import {
  ALL_SECRETS,
  SECRET_API_KEY,
  SECRET_BASIC_PASSWORD,
  SECRET_BASIC_USER,
  SECRET_BEARER_TOKEN,
  SECRET_COOKIE_VALUE,
  SECRET_ERROR_TEXT,
  SECRET_JSON_TOKEN,
  SECRET_PASSWORD_FIELD,
  SECRET_SHAPED_RESPONSE_FIELD,
  assertNoSecrets,
} from "../../fixtures/securityLab/secretCorpus";

/** The credential values a run resolves for its identities, in every form the sender puts on the wire. */
const RESOLVED = [SECRET_BEARER_TOKEN, SECRET_API_KEY, SECRET_BASIC_USER, SECRET_BASIC_PASSWORD, Buffer.from(`${SECRET_BASIC_USER}:${SECRET_BASIC_PASSWORD}`).toString("base64"), SECRET_ERROR_TEXT];

function outcome(overrides: Partial<SendOutcome> = {}): SendOutcome {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    bodyText: "{}",
    truncated: false,
    durationMs: 12,
    destination: { host: "127.0.0.1", port: 4700, addressClass: "loopback", verdict: "allowed" },
    redirects: [],
    requestsSent: 1,
    ...overrides,
  };
}

const request = (overrides: Partial<OutboundRequest> = {}): OutboundRequest => ({ method: "GET", url: "http://127.0.0.1:4700/orders", headers: {}, ...overrides });

function record(req: OutboundRequest, out: SendOutcome, secrets: readonly string[] = RESOLVED) {
  return buildEvidenceRecord({ index: 0, sentAt: "2026-01-01T00:00:00.000Z", request: req, outcome: out, secrets });
}

describe("evidence is redacted when it is constructed (R14, FR-048, SC-009)", () => {
  it("removes every seeded secret from a request and a response that carry them all", () => {
    const evidence = record(
      request({
        method: "POST",
        url: `http://127.0.0.1:4700/orders?api_key=${SECRET_API_KEY}&limit=5&note=${SECRET_ERROR_TEXT}`,
        headers: {
          authorization: `Bearer ${SECRET_BEARER_TOKEN}`,
          cookie: `sid=${SECRET_COOKIE_VALUE}`,
          "x-api-key": SECRET_API_KEY,
          "x-trace": `trace-${SECRET_BASIC_PASSWORD}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ username: SECRET_BASIC_USER, password: SECRET_PASSWORD_FIELD, token: SECRET_JSON_TOKEN, comment: `my key is ${SECRET_API_KEY}`, quantity: 2 }),
      }),
      outcome({
        status: 500,
        headers: { "content-type": "application/json", "set-cookie": `sid=${SECRET_COOKIE_VALUE}`, "x-debug": SECRET_BEARER_TOKEN, "www-authenticate": `Bearer realm="${SECRET_ERROR_TEXT}"` },
        bodyText: JSON.stringify({ error: `bad credential ${SECRET_ERROR_TEXT}`, access_token: SECRET_JSON_TOKEN, password: SECRET_PASSWORD_FIELD, note: SECRET_SHAPED_RESPONSE_FIELD, detail: `Basic ${Buffer.from(`${SECRET_BASIC_USER}:${SECRET_BASIC_PASSWORD}`).toString("base64")}` }),
        redirects: [{ to: `http://127.0.0.1:4700/next/${SECRET_API_KEY}`, verdict: "followed" }],
      }),
    );
    assertNoSecrets("evidence record", JSON.stringify(evidence), ALL_SECRETS);
  });

  it("keeps what is not secret, so the evidence stays useful", () => {
    const evidence = record(
      request({ method: "POST", url: "http://127.0.0.1:4700/orders?limit=5", headers: { "content-type": "application/json", "x-trace": "t-1" }, body: JSON.stringify({ quantity: 2, sku: "A-1" }) }),
      outcome({ status: 201, bodyText: JSON.stringify({ id: 7, status: "created" }), headers: { "content-type": "application/json", server: "sample/1.0" } }),
    );
    expect(evidence).toMatchObject({
      index: 0,
      sentAt: "2026-01-01T00:00:00.000Z",
      durationMs: 12,
      method: "POST",
      urlRedacted: "http://127.0.0.1:4700/orders?limit=5",
      requestHeadersRedacted: { "content-type": "application/json", "x-trace": "t-1" },
      responseStatus: 201,
      responseHeadersSelected: { "content-type": "application/json", server: "sample/1.0" },
      destination: { host: "127.0.0.1", port: 4700, addressClass: "loopback", verdict: "allowed" },
      truncated: false,
    });
    expect(JSON.parse(evidence.requestBodyExcerpt as string)).toEqual({ quantity: 2, sku: "A-1" });
    expect(JSON.parse(evidence.responseBodyExcerpt as string)).toEqual({ id: 7, status: "created" });
  });

  it("masks a resolved credential by literal match wherever it appears, even where no name or shape would reveal it", () => {
    const odd = "sl-seed-odd-position-9f8e7d6c5b4a";
    const evidence = record(
      request({ url: `http://127.0.0.1:4700/x/${odd}/y`, headers: { "x-forwarded-note": `prefix-${odd}-suffix` }, body: `plain text ${odd}` }),
      outcome({ bodyText: `echo: ${odd}`, headers: { server: `srv ${odd}` }, redirects: [{ to: `http://127.0.0.1:4700/${odd}`, verdict: "blocked", reason: "host_not_allowed" }] }),
      [odd],
    );
    expect(JSON.stringify(evidence)).not.toContain(odd);
  });

  it("never stores a response header outside the fixed set, and never Set-Cookie", () => {
    const evidence = record(request(), outcome({ headers: { "content-type": "text/plain", "set-cookie": "a=1", "x-internal-token": "t", "x-powered-by": "x", server: "s", allow: "GET" } }));
    expect(Object.keys(evidence.responseHeadersSelected).sort()).toEqual(["allow", "content-type", "server"]);
    expect(SELECTED_RESPONSE_HEADERS).not.toContain("set-cookie");
  });

  it("bounds a long body, flags truncation and never exposes a value that redaction hid", () => {
    const big = JSON.stringify({ items: "x".repeat(EVIDENCE_BODY_EXCERPT_BYTES * 3), password: SECRET_PASSWORD_FIELD });
    const evidence = record(request(), outcome({ bodyText: big }));
    expect((evidence.responseBodyExcerpt as string).length).toBeLessThanOrEqual(EVIDENCE_BODY_EXCERPT_BYTES);
    expect(evidence.truncated).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain(SECRET_PASSWORD_FIELD);
  });

  it("keeps the sender's own truncation flag, so a capped read is never reported as complete", () => {
    expect(record(request(), outcome({ truncated: true })).truncated).toBe(true);
  });

  it("records a blocked destination with its reason, and a blocked redirect without any query", () => {
    const evidence = record(
      request(),
      outcome({
        status: 302,
        destination: { host: "127.0.0.1", port: 4700, addressClass: "loopback", verdict: "allowed" },
        redirects: [{ to: "http://evil.test/steal", verdict: "blocked", reason: "host_not_allowed" }],
      }),
    );
    expect(evidence.redirects).toEqual([{ toRedacted: "http://evil.test/steal", verdict: "blocked", reason: "host_not_allowed" }]);
    const blocked = record(request(), outcome({ status: undefined, destination: { host: "10.0.0.5", port: 80, addressClass: "private", verdict: "blocked", reason: "restricted_address_blocked" }, error: { category: "blocked" } }));
    expect(blocked.destination).toEqual({ host: "10.0.0.5", port: 80, addressClass: "private", verdict: "blocked", reason: "restricted_address_blocked" });
    expect(blocked.error).toEqual({ category: "blocked" });
    expect(blocked.responseStatus).toBeUndefined();
  });

  it("omits what was not sent or received", () => {
    const evidence = record(request(), outcome({ bodyText: "", status: undefined, error: { category: "timeout" } }));
    expect(evidence.requestBodyExcerpt).toBeUndefined();
    expect(evidence.responseBodyExcerpt).toBeUndefined();
    expect(evidence.error).toEqual({ category: "timeout" });
  });
});

describe("selectResponseHeaders", () => {
  it("bounds a long value and redacts a sensitive one", () => {
    const selected = selectResponseHeaders({ server: "s".repeat(1000), "www-authenticate": `Bearer ${SECRET_BEARER_TOKEN}` }, [SECRET_BEARER_TOKEN]);
    expect(selected.server.length).toBeLessThanOrEqual(301);
    expect(JSON.stringify(selected)).not.toContain(SECRET_BEARER_TOKEN);
  });
});
