import { describe, expect, it } from "vitest";
import { LineSplitter, parseMetricsLine, type MetricsPoint } from "../../../src/performance/k6/metricsStream";
import { classifyFailure, createAggregate, timelineBucketMs } from "../../../src/performance/report/aggregate";
import { LatencyHistogram } from "../../../src/performance/report/histogram";
import { journeyFixture, planFixture, stepFixture } from "../../fixtures/performance/builders";
import { check, counter, httpReq, iteration, metricDeclaration, STREAM_START_MS, tokenRefreshReq, vus } from "../../fixtures/performance/ndjson";

/** research D11, D12, D14, D25 (tasks T057, T058). */

function points(lines: string[]): MetricsPoint[] {
  return lines.flatMap((line) => {
    const parsed = parseMetricsLine(line);
    return parsed.kind === "point" ? [parsed.point] : [];
  });
}

const create = stepFixture({ id: "s-create", operationKey: "POST /orders", method: "POST", path: "/orders", expectedStatuses: [{ code: "201", source: "specification" }] });
const read = stepFixture({ id: "s-read", operationKey: "GET /orders/{orderId}", method: "GET", path: "/orders/{orderId}", expectedStatuses: [{ code: "2XX", source: "user" }, { code: "401", source: "user" }] });
const status = stepFixture({ id: "s-status", operationKey: "GET /status" });
const plan = planFixture({
  journeys: [journeyFixture({ id: "j1", steps: [create, read] }), journeyFixture({ id: "j2", steps: [status] })],
});

describe("metrics stream", () => {
  it("parses k6 point lines and ignores declarations and unknown metrics", () => {
    const [request] = httpReq({ step: "s", journey: "j", status: 200, method: "GET", durationMs: 12, atMs: 1000 });
    expect(parseMetricsLine(request)).toEqual({
      kind: "point",
      point: { metric: "http_reqs", timeMs: STREAM_START_MS + 1000, value: 1, tags: { step: "s", journey: "j", status: "200", method: "GET" } },
    });
    expect(parseMetricsLine(metricDeclaration("http_reqs", "counter")).kind).toBe("ignored");
    expect(parseMetricsLine(JSON.stringify({ type: "Point", metric: "data_sent", data: { time: "2026-09-27T12:00:00Z", value: 1, tags: {} } })).kind).toBe("ignored");
    expect(parseMetricsLine("   ").kind).toBe("blank");
    expect(parseMetricsLine("{not json").kind).toBe("unreadable");
    expect(parseMetricsLine(JSON.stringify({ type: "Point", metric: "http_reqs", data: { time: "nope", value: 1 } })).kind).toBe("unreadable");
  });

  it("joins lines split across chunks", () => {
    const splitter = new LineSplitter();
    expect(splitter.push('{"a":1}\n{"b')).toEqual(['{"a":1}']);
    expect(splitter.push('":2}\n')).toEqual(['{"b":2}']);
    expect(splitter.push('{"c":3}')).toEqual([]);
    expect(splitter.flush()).toEqual(['{"c":3}']);
  });
});

describe("latency histogram", () => {
  it("reads p50/p90/p95/p99 within 1% of the exact nearest-rank values, deterministically", () => {
    const distributions = [
      Array.from({ length: 1000 }, (_, i) => i + 1),
      Array.from({ length: 997 }, (_, i) => 5 + ((i * 7919) % 997) * 0.37),
      Array.from({ length: 2000 }, (_, i) => (i % 10 === 0 ? 900 + i : 20 + (i % 13))),
    ];
    for (const values of distributions) {
      const histogram = new LatencyHistogram();
      for (const value of values) histogram.add(value);
      const sorted = [...values].sort((a, b) => a - b);
      for (const p of [50, 90, 95, 99]) {
        const exact = sorted[Math.ceil((p / 100) * sorted.length) - 1];
        const measured = histogram.percentile(p)!;
        expect(Math.abs(measured - exact) / exact).toBeLessThanOrEqual(0.01);
      }
      const again = new LatencyHistogram();
      for (const value of values) again.add(value);
      expect(again.percentiles()).toEqual(histogram.percentiles());
    }
    expect(new LatencyHistogram().percentiles()).toBeNull();
  });
});

describe("failure classification (FR-012a, D14)", () => {
  const expected = [{ code: "2XX", source: "user" as const }, { code: "401", source: "user" as const }];
  it("never counts an expected status as a failure, even 401", () => {
    expect(classifyFailure(204, undefined, expected)).toBeNull();
    expect(classifyFailure(401, undefined, expected)).toBeNull();
  });
  it("gives each failure exactly one category", () => {
    expect(classifyFailure(403, undefined, expected)).toBe("authentication");
    expect(classifyFailure(429, undefined, expected)).toBe("rate-limited");
    expect(classifyFailure(0, "1050", expected)).toBe("timeout");
    expect(classifyFailure(0, "1211", expected)).toBe("connection-error");
    expect(classifyFailure(0, undefined, expected)).toBe("connection-error");
    expect(classifyFailure(500, undefined, expected)).toBe("unexpected-status");
    expect(classifyFailure(401, undefined, [{ code: "200", source: "specification" }])).toBe("authentication");
  });
});

describe("aggregate", () => {
  function run(lines: string[], plannedDurationMs = 60_000) {
    const aggregate = createAggregate(plan, plannedDurationMs, STREAM_START_MS);
    for (const point of points(lines)) aggregate.ingest(point);
    return aggregate;
  }

  it("counts requests, failures, checks, write requests and journeys cut short (FR-036, FR-036a, D25)", () => {
    const aggregate = run([
      vus(3, 0),
      ...httpReq({ step: "s-create", journey: "j1", status: 201, method: "POST", durationMs: 50, atMs: 100 }),
      check({ step: "s-create", journey: "j1", passed: true, atMs: 100 }),
      ...httpReq({ step: "s-read", journey: "j1", status: 401, method: "GET", durationMs: 20, atMs: 200 }),
      ...httpReq({ step: "s-create", journey: "j1", status: 500, method: "POST", durationMs: 70, atMs: 6_100 }),
      check({ step: "s-create", journey: "j1", passed: false, atMs: 6_100 }),
      JSON.stringify({ type: "Point", metric: "checks", data: { time: new Date(STREAM_START_MS + 6_100).toISOString(), value: 0, tags: { step: "s-create", journey: "j1", check: "extraction" } } }),
      counter("apipilot_cut_short", { step: "s-create", journey: "j1" }, 6_100),
      counter("apipilot_not_attempted", { step: "s-read", journey: "j1", reason: "cut-short" }, 6_100),
      counter("apipilot_missing_data", { step: "s-status", journey: "j2", variable: "baseUrl" }, 6_200),
      ...httpReq({ step: "s-status", journey: "j2", status: 0, method: "GET", durationMs: 60_000, atMs: 6_300, errorCode: 1050 }),
      ...httpReq({ step: "s-status", journey: "j2", status: 429, method: "GET", durationMs: 5, atMs: 11_000 }),
      iteration(6_400),
      iteration(11_500),
    ]);
    const result = aggregate.toResult(STREAM_START_MS + 20_000);
    expect(result.totals).toMatchObject({ requests: 5, errors: 3, iterations: 2, journeysCutShort: 1, errorRatePercent: 60 });
    const [createResult, readResult, statusResult] = result.steps;
    expect(createResult).toMatchObject({
      requests: 2,
      errorRatePercent: 50,
      errorsByStatus: [{ status: "500", count: 1 }],
      errorsByCategory: [{ category: "extraction-failed", count: 1 }, { category: "unexpected-status", count: 1 }],
      checkPassRatePercent: 33.33,
    });
    expect(readResult).toMatchObject({ requests: 1, errorRatePercent: 0, notAttempted: { missingData: 0, dependencyNotAttempted: 1 } });
    expect(statusResult).toMatchObject({
      errorsByStatus: [{ status: "0", count: 1 }, { status: "429", count: 1 }],
      errorsByCategory: [{ category: "rate-limited", count: 1 }, { category: "timeout", count: 1 }],
      notAttempted: { missingData: 1, dependencyNotAttempted: 0 },
      missingVariables: ["baseUrl"],
    });
    expect(result.journeys[0]).toMatchObject({ runsCutShort: 1, cutShortAtStepId: "s-create" });
    expect(result.writeRequests).toEqual([{ operationKey: "POST /orders", method: "POST", sent: 2, succeeded: 1 }]);
    expect(result.firstFailure).toEqual({ offsetMs: 5_000, stepId: "s-create" });
    expect(result.firstRateLimitedOffsetMs).toBe(10_000);
  });

  it("keeps token refreshes out of every step and counts them (FR-015, SC-013)", () => {
    const aggregate = run([
      counter("apipilot_token_refresh", { outcome: "no-lifetime" }, 0),
      ...tokenRefreshReq({ atMs: 3_000, status: 200 }),
      ...tokenRefreshReq({ atMs: 3_500, status: 200 }),
      ...tokenRefreshReq({ atMs: 12_000, status: 500 }),
    ]);
    const result = aggregate.toResult(STREAM_START_MS + 20_000);
    expect(result.totals.requests).toBe(0);
    expect(result.steps.every((step) => step.requests === 0)).toBe(true);
    expect(result.tokenRefreshes).toEqual({ count: 3, failed: 1, lifetimeStated: false, bucketOffsetsMs: [0, 10_000] });
    expect(aggregate.progress(STREAM_START_MS + 20_000).tokenRefreshesSoFar).toBe(3);
  });

  it("reports running progress that ends equal to the result's totals (FR-030)", () => {
    const aggregate = run([
      vus(4, 0),
      ...httpReq({ step: "s-create", journey: "j1", status: 500, method: "POST", durationMs: 50, atMs: 100 }),
      counter("apipilot_cut_short", { step: "s-create", journey: "j1" }, 100),
      counter("apipilot_not_attempted", { step: "s-read", journey: "j1", reason: "cut-short" }, 100),
    ]);
    const progress = aggregate.progress(STREAM_START_MS + 2_000);
    const result = aggregate.toResult(STREAM_START_MS + 2_000);
    expect(progress).toMatchObject({ elapsedMs: 2_000, currentVirtualUsers: 4, requestsSoFar: 1, failuresSoFar: 1, journeysCutShortSoFar: 1 });
    expect(progress.steps).toEqual([
      { stepId: "s-create", requests: 1, failures: 1, notSent: { missingData: 0, dependencyNotAttempted: 0 } },
      { stepId: "s-read", requests: 0, failures: 0, notSent: { missingData: 0, dependencyNotAttempted: 1 } },
      { stepId: "s-status", requests: 0, failures: 0, notSent: { missingData: 0, dependencyNotAttempted: 0 } },
    ]);
    expect(progress.requestsSoFar).toBe(result.totals.requests);
    expect(progress.failuresSoFar).toBe(result.totals.errors);
  });

  it("buckets the timeline at max(5 s, planned/200) with at most about 200 points", () => {
    expect(timelineBucketMs(60_000)).toBe(5_000);
    expect(timelineBucketMs(4 * 3_600_000)).toBe(72_000);
    const lines = Array.from({ length: 400 }, (_, i) => httpReq({ step: "s-status", journey: "j2", status: 200, method: "GET", durationMs: 10, atMs: i * 36_000 })).flat();
    const result = run(lines, 4 * 3_600_000).toResult(STREAM_START_MS + 4 * 3_600_000);
    expect(result.timeline.bucketMs).toBe(72_000);
    expect(result.timeline.points.length).toBeLessThanOrEqual(201);
  });

  it("uses constant memory in the request count (D11)", () => {
    const sizeFor = (count: number) => {
      const aggregate = createAggregate(plan, 60_000, STREAM_START_MS);
      for (let i = 0; i < count; i++) {
        // Both sizes span the same minute, so only the request count differs.
        for (const point of points(httpReq({ step: "s-status", journey: "j2", status: 200, method: "GET", durationMs: 5 + (i % 50), atMs: (i % 1_000) * 60 }))) aggregate.ingest(point);
      }
      return JSON.stringify(aggregate.toResult(STREAM_START_MS + 60_000)).length;
    };
    expect(sizeFor(100_000)).toBeLessThan(sizeFor(1_000) + 200);
  });
});
