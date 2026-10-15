import { describe, expect, it } from "vitest";
import { LIVE_RECENT_FAILURE_LIMIT } from "@apipilot/shared-domain";
import { parseMetricsLine } from "../../../../src/performance/k6/metricsStream";
import { buildSnapshot } from "../../../../src/performance/live/buildSnapshot";
import { createUserScriptAggregate, type UserScriptAggregate } from "../../../../src/performance/report/userScriptAggregate";
import { USER_STREAM_START_MS, userRequest, type UserRequestInput } from "../../../fixtures/userScripts/ndjsonBuilder";

/**
 * AP-052 (specs/052-user-script-recent-failures): the Recent failures sample of a Run k6 Script run. It is
 * built from the same k6 points as the latest requests, one entry a second for each request and status,
 * never holds a response (ApiPilot cannot see one), and is never part of the stored result.
 */

const BASE = "http://127.0.0.1:18089";

function feed(aggregate: UserScriptAggregate, inputs: UserRequestInput[], extraTags: Record<string, string> = {}): void {
  for (const input of inputs) {
    for (const line of userRequest(input)) {
      const parsed = parseMetricsLine(line, { acceptAllMetrics: true });
      if (parsed.kind === "point") aggregate.add({ kind: "point", point: { ...parsed.point, tags: { ...parsed.point.tags, ...extraTags } } });
    }
  }
}

function newAggregate(): UserScriptAggregate {
  return createUserScriptAggregate({ plannedDurationMs: null, startedAtMs: USER_STREAM_START_MS });
}

describe("Run k6 Script recent failures", () => {
  it("lists failed requests newest first, a named one by name and an unnamed one by host and path, with no response captured", () => {
    const aggregate = newAggregate();
    feed(aggregate, [
      { url: `${BASE}/ok`, method: "GET", status: 200, durationMs: 5, atMs: 100 },
      { url: `${BASE}/bad`, method: "GET", status: 500, durationMs: 7, atMs: 200 },
      { url: `${BASE}/orders`, name: "Create order", method: "POST", status: 422, durationMs: 9, atMs: 1_500 },
    ]);
    const { recentFailures } = aggregate.liveParts(USER_STREAM_START_MS + 3_000);
    expect(recentFailures).toEqual([
      { second: 1, chain: "Create order", method: "POST", path: "", status: 422, response: { kind: "not-captured", reason: "user-script" } },
      { second: 0, chain: "127.0.0.1:18089", method: "GET", path: "/bad", status: 500, response: { kind: "not-captured", reason: "user-script" } },
    ]);
  });

  it("follows k6's own verdict: a 404 the script marked expected is not a failure", () => {
    const aggregate = newAggregate();
    feed(aggregate, [{ url: `${BASE}/missing`, method: "GET", status: 404, durationMs: 4, atMs: 100, failed: false }]);
    expect(aggregate.liveParts(USER_STREAM_START_MS + 1_000).recentFailures).toEqual([]);
  });

  it("says no response arrived, with a null status, when the request got none", () => {
    const aggregate = newAggregate();
    feed(aggregate, [{ url: `${BASE}/down`, method: "GET", status: 0, durationMs: 1_000, atMs: 100 }]);
    const [failure] = aggregate.liveParts(USER_STREAM_START_MS + 1_000).recentFailures ?? [];
    expect(failure).toMatchObject({ method: "GET", path: "/down", status: null, response: { kind: "none-received" } });
  });

  it("keeps one entry a second for each request and status, while the counts stay exact", () => {
    const aggregate = newAggregate();
    feed(aggregate, [
      { url: `${BASE}/bad`, method: "GET", status: 500, durationMs: 5, atMs: 100 },
      { url: `${BASE}/bad`, method: "GET", status: 500, durationMs: 5, atMs: 200 },
      { url: `${BASE}/bad`, method: "GET", status: 500, durationMs: 5, atMs: 300 },
      { url: `${BASE}/bad`, method: "GET", status: 503, durationMs: 5, atMs: 400 },
      { url: `${BASE}/other`, method: "GET", status: 500, durationMs: 5, atMs: 500 },
      { url: `${BASE}/bad`, method: "GET", status: 500, durationMs: 5, atMs: 1_100 },
    ]);
    const parts = aggregate.liveParts(USER_STREAM_START_MS + 2_000);
    expect(parts.totals).toEqual({ requests: 6, failures: 6 });
    expect(parts.recentFailures!.map((failure) => [failure.second, failure.path, failure.status])).toEqual([
      [1, "/bad", 500],
      [0, "/other", 500],
      [0, "/bad", 503],
      [0, "/bad", 500],
    ]);
  });

  it("holds at most 15, newest first, for a long run of failures", () => {
    const aggregate = newAggregate();
    feed(
      aggregate,
      Array.from({ length: 40 }, (_unused, n) => ({ url: `${BASE}/bad`, method: "GET", status: 500, durationMs: 5, atMs: n * 1_000 })),
    );
    const { recentFailures } = aggregate.liveParts(USER_STREAM_START_MS + 41_000);
    expect(recentFailures).toHaveLength(LIVE_RECENT_FAILURE_LIMIT);
    expect(recentFailures![0]!.second).toBe(39);
    expect(recentFailures![14]!.second).toBe(25);
  });

  it("gives the same list for the same points", () => {
    const inputs: UserRequestInput[] = [
      { url: `${BASE}/bad`, method: "GET", status: 500, durationMs: 5, atMs: 100 },
      { url: `${BASE}/orders`, name: "Create order", method: "POST", status: 422, durationMs: 9, atMs: 1_500 },
    ];
    const first = newAggregate();
    const second = newAggregate();
    feed(first, inputs);
    feed(second, inputs);
    expect(second.liveParts(USER_STREAM_START_MS + 3_000).recentFailures).toEqual(first.liveParts(USER_STREAM_START_MS + 3_000).recentFailures);
  });

  it("carries nothing a request held beyond its name, host, path, method and status", () => {
    const aggregate = newAggregate();
    feed(
      aggregate,
      [{ url: "https://SECRET-USER:pw@host.test/orders/9?token=SECRET-TOKEN#SECRET-COOKIE", method: "POST", status: 500, durationMs: 11, atMs: 100 }],
      { authorization: "Bearer SECRET-HEADER", body: "SECRET-BODY", error: "Post https://host.test/orders/9?token=SECRET-TOKEN: boom" },
    );
    const { recentFailures } = aggregate.liveParts(USER_STREAM_START_MS + 1_000);
    expect(recentFailures).toHaveLength(1);
    expect(recentFailures![0]).toMatchObject({ chain: "host.test", path: "/orders/9" });
    const text = JSON.stringify(recentFailures);
    for (const secret of ["SECRET-USER", "SECRET-TOKEN", "SECRET-COOKIE", "SECRET-HEADER", "SECRET-BODY", "boom"]) expect(text).not.toContain(secret);
    expect(text).not.toContain("?");
  });

  it("is never part of the stored result", () => {
    const aggregate = newAggregate();
    feed(aggregate, [{ url: `${BASE}/bad`, method: "GET", status: 500, durationMs: 5, atMs: 100 }]);
    const stored = JSON.stringify(aggregate.toResult(USER_STREAM_START_MS + 2_000));
    expect(stored).not.toContain("recentFailures");
    expect(stored).not.toContain("not-captured");
  });

  it("reaches the live snapshot a route serves", () => {
    const aggregate = newAggregate();
    feed(aggregate, [{ url: `${BASE}/bad`, method: "GET", status: 500, durationMs: 5, atMs: 100 }]);
    const parts = aggregate.liveParts(USER_STREAM_START_MS + 1_000);
    const snapshot = buildSnapshot({ runId: "r1", kind: "user-script", state: "live", plannedDurationMs: null, plannedRequests: null, inFlight: null, ...parts }, { since: 0 });
    expect(snapshot.recentFailures).toHaveLength(1);
    expect(snapshot.recentFailures![0]).toMatchObject({ path: "/bad", status: 500, response: { kind: "not-captured" } });
  });
});
