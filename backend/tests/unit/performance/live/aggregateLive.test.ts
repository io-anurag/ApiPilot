import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseMetricsLine, type MetricsPoint } from "../../../../src/performance/k6/metricsStream";
import type { LiveStepInfo } from "../../../../src/performance/live/liveStepInfo";
import { createAggregate } from "../../../../src/performance/report/aggregate";
import type { RunLayout } from "../../../../src/performance/report/runLayout";
import { createUserScriptAggregate } from "../../../../src/performance/report/userScriptAggregate";

/**
 * AP-045: the live structures fed from real k6 captures (tests/fixtures/live), through both
 * aggregates. The captures are secrets-free: a local mock target, a fake `?token=` query and, in
 * the user-script capture, a named and an unnamed request.
 */

const fixture = (name: string) => readFileSync(path.join(__dirname, "../../../fixtures/live", name), "utf-8").split("\n").filter((line) => line.trim() !== "");

function pointsOf(name: string, acceptAllMetrics = false): MetricsPoint[] {
  return fixture(name).flatMap((line) => {
    const parsed = parseMetricsLine(line, { acceptAllMetrics });
    return parsed.kind === "point" ? [parsed.point] : [];
  });
}

const layout: RunLayout = {
  kind: "run-layout",
  journeys: [
    {
      id: "j1",
      steps: [
        { stepId: "s1", journeyId: "j1", operationKey: "s1", method: "GET", expected: [{ code: "200", source: "user" }], captureNames: [], checks: [] },
        { stepId: "s2", journeyId: "j1", operationKey: "s2", method: "GET", expected: [{ code: "200", source: "user" }], captureNames: [], checks: [] },
      ],
    },
  ],
  thresholds: [],
};

const steps = new Map<string, LiveStepInfo>([
  ["s1", { chainId: "j1", chainName: "Orders", stepName: "List orders", method: "GET", path: "/orders/{{id}}" }],
  ["s2", { chainId: "j1", chainName: "Orders", stepName: "Broken", method: "GET", path: "/bad" }],
]);

function chainRun() {
  const points = pointsOf("chain-run.ndjson");
  const start = Math.min(...points.map((point) => point.timeMs));
  const aggregate = createAggregate(layout, 10_000, start, { steps });
  for (const point of points) aggregate.ingest(point);
  return { aggregate, start };
}

function userScriptRun() {
  const points = pointsOf("user-script-run.ndjson", true);
  const start = Math.min(...points.map((point) => point.timeMs));
  const aggregate = createUserScriptAggregate({ plannedDurationMs: null, startedAtMs: start });
  for (const point of points) aggregate.add({ kind: "point", point });
  return { aggregate, start };
}

describe("live parts from a real chain capture", () => {
  it("counts every request and the unexpected ones, with totals equal to the run's own progress", () => {
    const { aggregate, start } = chainRun();
    const parts = aggregate.liveParts(start + 3_000);
    const progress = aggregate.progress(start + 3_000);
    expect(parts.totals).toEqual({ requests: progress.requestsSoFar, failures: progress.failuresSoFar });
    expect(parts.totals.requests).toBe(4);
    expect(parts.totals.failures).toBe(2);
    expect(parts.series.points.reduce((sum, p) => sum + p.requests, 0)).toBe(4);
    expect(parts.series.points.reduce((sum, p) => sum + p.failures, 0)).toBe(2);
    expect(parts.chains).toEqual([{ id: "j1", label: "Orders", requests: 4, failures: 2 }]);
    expect(parts.latency).not.toBeNull();
  });

  it("builds the latest requests from each duration point's own tags and the plan's path templates", () => {
    const { aggregate, start } = chainRun();
    const { recent } = aggregate.liveParts(start + 3_000);
    expect(recent).toHaveLength(4);
    expect(recent[0]).toMatchObject({ chain: "Broken", method: "GET", path: "/bad", status: 500, failed: true });
    expect(recent.find((entry) => entry.chain === "List orders")).toMatchObject({ path: "/orders/{{id}}", status: 200, failed: false });
  });
});

describe("live parts from a real user-script capture", () => {
  it("counts every request and k6's own failures", () => {
    const { aggregate, start } = userScriptRun();
    const parts = aggregate.liveParts(start + 3_000);
    expect(parts.totals).toEqual({ requests: aggregate.requestCount, failures: 2 });
    expect(parts.series.points.reduce((sum, p) => sum + p.requests, 0)).toBe(4);
    expect(parts.series.points.reduce((sum, p) => sum + p.failures, 0)).toBe(2);
    expect(parts.chains).toEqual([]);
  });

  it("names a named request by its name and an unnamed one by host and path", () => {
    const { aggregate, start } = userScriptRun();
    const { recent } = aggregate.liveParts(start + 3_000);
    expect(recent.find((entry) => entry.chain === "List orders")).toMatchObject({ method: "GET", path: "", status: 200, failed: false });
    expect(recent.find((entry) => entry.chain === "127.0.0.1:18089")).toMatchObject({ method: "GET", path: "/bad", status: 500, failed: true });
  });
});

describe("the two kinds agree on the shape of a live view", () => {
  it("gives ordered, unique points with requests at or above failures and the same field set", () => {
    for (const { aggregate, start } of [chainRun(), userScriptRun()]) {
      const parts = aggregate.liveParts(start + 3_000);
      const seconds = parts.series.points.map((point) => point.second);
      expect(seconds).toEqual([...new Set(seconds)].sort((a, b) => a - b));
      expect(parts.totals.requests).toBeGreaterThanOrEqual(parts.totals.failures);
      for (const point of parts.series.points) {
        expect(Object.keys(point).sort()).toEqual(["failures", "latencyMs", "requests", "second", "virtualUsers"]);
        expect(point.requests).toBeGreaterThanOrEqual(point.failures);
      }
      expect(Object.keys(parts.recent[0]!).sort()).toEqual(["chain", "durationMs", "failed", "method", "path", "second", "status"]);
    }
  });

  it("stores the whole run's series for the finished result", () => {
    for (const { aggregate, start } of [chainRun(), userScriptRun()]) {
      const stored = aggregate.storedLiveSeries(start + 3_000);
      expect(stored.bucketSeconds).toBe(1);
      expect(stored.points.reduce((sum, point) => sum + point.requests, 0)).toBe(4);
    }
  });
});
