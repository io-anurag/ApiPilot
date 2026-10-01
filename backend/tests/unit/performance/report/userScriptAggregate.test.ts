import { describe, expect, it } from "vitest";
import { parseMetricsLine } from "../../../../src/performance/k6/metricsStream";
import { createUserScriptAggregate, displayNameOf, OTHER_REQUESTS } from "../../../../src/performance/report/userScriptAggregate";
import { basicLines, longSoakLines, unnamedManyLines, USER_STREAM_START_MS } from "../../../fixtures/userScripts/ndjsonBuilder";

/** AP-034 FR-031 to FR-034 (research R14; tasks T023). */

function aggregate(lines: string[], plannedDurationMs: number | null = null) {
  const aggregator = createUserScriptAggregate({ plannedDurationMs, startedAtMs: USER_STREAM_START_MS });
  for (const line of lines) aggregator.add(parseMetricsLine(line, { acceptAllMetrics: true }));
  return aggregator;
}

describe("display names (FR-032)", () => {
  it("uses the k6 name as given, and method, host and path for an unnamed request", () => {
    expect(displayNameOf({ name: "GET /orders", url: "GET /orders", method: "GET" })).toEqual({ displayName: "GET /orders", named: true });
    expect(displayNameOf({ name: "http://a.test/items/${}?y=2", url: "http://a.test/items/${}?y=2", method: "GET" })).toEqual({ displayName: "GET a.test/items/${}", named: false });
    expect(displayNameOf({ name: "http://u:p@a.test:8080/c/1?t=x#f", url: "http://u:p@a.test:8080/c/1?t=x#f", method: "GET" })).toEqual({
      displayName: "GET a.test:8080/c/1",
      named: false,
    });
    expect(displayNameOf({ url: "https://a.test/c?q=1", method: "POST" })).toEqual({ displayName: "POST a.test/c", named: false });
  });
});

describe("createUserScriptAggregate", () => {
  it("groups named requests, counts failures k6's way and keeps statuses, phases and writes", () => {
    const result = aggregate(basicLines()).toResult(USER_STREAM_START_MS + 10_000);
    expect(result.requestGroups.map((group) => group.displayName)).toEqual(["GET /orders", "POST /orders", "POST /log"]);
    const post = result.requestGroups[1];
    expect(post).toMatchObject({ requests: 10, failures: 2, failureRatePercent: 20, statusesReceived: [{ status: 201, count: 8 }, { status: 500, count: 2 }] });
    expect(post.writes).toEqual([{ method: "POST", sent: 10, succeeded: 8 }]);
    expect(post.phaseTimings.map((timing) => timing.phase)).toEqual(["blocked", "connecting", "tls-handshaking", "sending", "waiting", "receiving"]);
    expect(post.latencySummaryMs).toEqual({ min: 40, mean: 44.5, max: 49 });
    expect(result.totals).toMatchObject({ requests: 30, failures: 2, iterations: 10, dataSentBytes: 1_000, dataReceivedBytes: 10_000 });
    expect(result.otherRequests).toBeNull();
  });

  it("summarises checks, groups, custom metrics, script thresholds and hosts", () => {
    const result = aggregate(basicLines()).toResult(USER_STREAM_START_MS + 10_000);
    expect(result.checks).toEqual([
      { name: "list is 200", passes: 10, fails: 0 },
      { name: "created", passes: 8, fails: 2 },
    ]);
    expect(result.groups.map((group) => group.name)).toEqual(["::orders"]);
    expect(result.customMetrics.map((metric) => `${metric.name}:${metric.type}`)).toEqual(["order_errors:rate", "order_latency:trend", "orders_created:counter", "queue_depth:gauge"]);
    expect(result.customMetrics.find((metric) => metric.name === "order_errors")).toMatchObject({ percentTrue: 20, samples: 10 });
    expect(result.customMetrics.find((metric) => metric.name === "queue_depth")).toMatchObject({ last: 12, min: 3, max: 12 });
    expect(result.scriptThresholds).toEqual([{ metric: "http_req_duration", expressions: ["p(95)<500"] }]);
    expect(result.scriptThresholdsOutcome).toBe("not-evaluated");
    // Named requests are counted by address: k6 replaces their url tag with the name.
    expect(result.hostsReceived).toEqual([
      { origin: "127.0.0.1", requests: 20, source: "ip" },
      { origin: "203.0.113.10", requests: 10, source: "ip" },
    ]);
    expect(aggregate(unnamedManyLines()).toResult(USER_STREAM_START_MS + 2_000).hostsReceived).toEqual([{ origin: "http://127.0.0.1:4600", requests: 130, source: "url" }]);
  });

  it("caps request groups at 100 in first-appearance order and combines the rest, with no query or user info", () => {
    const result = aggregate(unnamedManyLines()).toResult(USER_STREAM_START_MS + 2_000);
    expect(result.requestGroups).toHaveLength(100);
    expect(result.requestGroups[0].displayName).toBe("GET 127.0.0.1:4600/customers/0");
    expect(result.requestGroups[99].displayName).toBe("GET 127.0.0.1:4600/customers/99");
    expect(result.otherRequests).toMatchObject({ displayName: OTHER_REQUESTS, combinedNames: 30, requests: 30 });
    const serialized = JSON.stringify(result);
    for (const fragment of ["token=abc", "user:pw", "#frag", "?"]) expect(serialized).not.toContain(fragment);
  });

  it("doubles its bucket width to stay within 200 buckets when the duration is unknown", () => {
    const result = aggregate(longSoakLines()).toResult(USER_STREAM_START_MS + 2_500_000);
    expect(result.timeline.points.length).toBeLessThanOrEqual(200);
    expect(result.timeline.bucketMs).toBe(20_000);
    expect(result.timeline.points.reduce((total, point) => total + point.requests, 0)).toBe(500);
    expect(result.requestGroups[0].timeline.reduce((total, point) => total + point.requests, 0)).toBe(500);
  });

  it("uses AP-029's bucket width when a load profile gives the planned duration", () => {
    expect(aggregate(basicLines(), 60_000).toResult(USER_STREAM_START_MS + 10_000).timeline.bucketMs).toBe(5_000);
  });

  it("reports progress and gives the same result for the same stream", () => {
    const first = aggregate(basicLines());
    expect(first.progress(USER_STREAM_START_MS + 4_000)).toEqual({ elapsedMs: 4_000, currentVirtualUsers: 2, requestsSoFar: 30, failuresSoFar: 2 });
    expect(JSON.stringify(aggregate(basicLines()).toResult(USER_STREAM_START_MS + 10_000))).toBe(JSON.stringify(first.toResult(USER_STREAM_START_MS + 10_000)));
  });
});
