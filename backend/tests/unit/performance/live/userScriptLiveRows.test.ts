import { describe, expect, it } from "vitest";
import { parseMetricsLine } from "../../../../src/performance/k6/metricsStream";
import { createUserScriptAggregate, LIVE_REQUEST_ROWS, type UserScriptAggregate } from "../../../../src/performance/report/userScriptAggregate";
import { USER_STREAM_START_MS, userRequest, type UserRequestInput } from "../../../fixtures/userScripts/ndjsonBuilder";

/** AP-051: the live dashboard's Requests list and Total / By request graph of a Run k6 Script run. */

const BASE = "http://127.0.0.1:18089";

function feed(aggregate: UserScriptAggregate, inputs: UserRequestInput[]): void {
  for (const input of inputs) {
    for (const line of userRequest(input)) {
      const parsed = parseMetricsLine(line, { acceptAllMetrics: true });
      if (parsed.kind === "point") aggregate.add({ kind: "point", point: parsed.point });
    }
  }
}

const aggregateOf = () => createUserScriptAggregate({ plannedDurationMs: null, startedAtMs: USER_STREAM_START_MS });
const named = (name: string, atMs: number, status = 200): UserRequestInput => ({ url: `${BASE}/${name}`, name, method: "GET", status, durationMs: 5, atMs });

describe("a script run's request rows", () => {
  it("lists each request name with its requests and failures, in order of first appearance", () => {
    const aggregate = aggregateOf();
    feed(aggregate, [named("List", 100), named("Create", 200, 422), named("List", 300), named("Create", 400, 201), named("Create", 500, 500)]);
    expect(aggregate.liveParts(USER_STREAM_START_MS + 1_000).chains).toEqual([
      { id: "List", label: "List", requests: 2, failures: 0 },
      { id: "Create", label: "Create", requests: 3, failures: 2 },
    ]);
  });

  it("shows the first twenty names, then one Other requests row that adds up the rest", () => {
    const aggregate = aggregateOf();
    feed(aggregate, Array.from({ length: LIVE_REQUEST_ROWS + 5 }, (_unused, n) => named(`r${n}`, 100 + n, n % 2 === 0 ? 200 : 500)));
    const rows = aggregate.liveParts(USER_STREAM_START_MS + 1_000).chains;
    expect(rows).toHaveLength(LIVE_REQUEST_ROWS + 1);
    expect(rows[0]).toMatchObject({ label: "r0" });
    expect(rows.at(-1)).toMatchObject({ id: "other", label: "Other requests", requests: 5 });
    expect(rows.reduce((sum, row) => sum + row.requests, 0)).toBe(LIVE_REQUEST_ROWS + 5);
  });

  it("adds up to the run's totals, and is the same for the same points", () => {
    const inputs = [named("A", 100), named("B", 200, 500), named("C", 300), named("A", 400)];
    const first = aggregateOf();
    const second = aggregateOf();
    feed(first, inputs);
    feed(second, inputs);
    const parts = first.liveParts(USER_STREAM_START_MS + 1_000);
    expect(parts.chains.reduce((sum, row) => sum + row.requests, 0)).toBe(parts.totals.requests);
    expect(parts.chains.reduce((sum, row) => sum + row.failures, 0)).toBe(parts.totals.failures);
    expect(second.liveParts(USER_STREAM_START_MS + 1_000).chains).toEqual(parts.chains);
  });

  it("is not part of the stored result", () => {
    const aggregate = aggregateOf();
    feed(aggregate, [named("A", 100)]);
    expect(JSON.stringify(aggregate.toResult(USER_STREAM_START_MS + 2_000))).not.toContain('"chains"');
  });
});

describe("a script run's graph by request", () => {
  it("has no breakdown for a single request name", () => {
    const aggregate = aggregateOf();
    feed(aggregate, [named("Only", 100), named("Only", 1_100)]);
    const { series } = aggregate.liveParts(USER_STREAM_START_MS + 2_000);
    expect(series.groups).toBeUndefined();
    expect(series.points.every((point) => point.byGroup === undefined)).toBe(true);
  });

  it("breaks requests down by the first three names and one Other requests line", () => {
    const aggregate = aggregateOf();
    feed(aggregate, [named("A", 100), named("B", 200), named("C", 300), named("D", 400), named("E", 500), named("A", 1_100)]);
    const { series } = aggregate.liveParts(USER_STREAM_START_MS + 2_000);
    expect(series.groups).toEqual([
      { id: "g1", label: "A" },
      { id: "g2", label: "B" },
      { id: "g3", label: "C" },
      { id: "other", label: "Other requests" },
    ]);
    expect(series.points[0]!.byGroup).toEqual({ g1: 1, g2: 1, g3: 1, other: 2 });
    expect(series.points[1]!.byGroup).toEqual({ g1: 1, g2: 0, g3: 0, other: 0 });
    const total = series.points.reduce((sum, point) => sum + Object.values(point.byGroup!).reduce((a, b) => a + b, 0), 0);
    expect(total).toBe(series.points.reduce((sum, point) => sum + point.requests, 0));
  });

  it("starts a group the moment its name first appears, with zero before it", () => {
    const aggregate = aggregateOf();
    feed(aggregate, [named("A", 100), named("B", 2_100)]);
    const { series } = aggregate.liveParts(USER_STREAM_START_MS + 3_000);
    expect(series.groups!.map((group) => group.label)).toEqual(["A", "B"]);
    expect(series.points[0]!.byGroup).toEqual({ g1: 1, g2: 0 });
    expect(series.points[2]!.byGroup).toEqual({ g1: 0, g2: 1 });
  });

  it("names an unnamed request by method, host and path, never its query", () => {
    const aggregate = aggregateOf();
    feed(aggregate, [
      { url: `${BASE}/a?token=SECRET-TOKEN`, method: "GET", status: 200, durationMs: 5, atMs: 100 },
      { url: `${BASE}/b?token=SECRET-TOKEN`, method: "POST", status: 200, durationMs: 5, atMs: 200 },
    ]);
    const parts = aggregate.liveParts(USER_STREAM_START_MS + 1_000);
    expect(parts.series.groups!.map((group) => group.label)).toEqual(["GET 127.0.0.1:18089/a", "POST 127.0.0.1:18089/b"]);
    expect(JSON.stringify(parts)).not.toContain("SECRET-TOKEN");
  });
});
