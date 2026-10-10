import { describe, expect, it } from "vitest";
import { createLiveSeries } from "../../../../src/performance/live/liveSeries";

describe("liveSeries", () => {
  it("counts requests and failures per second and zero-fills quiet seconds", () => {
    const series = createLiveSeries({ withVirtualUsers: true });
    series.recordRequest(0);
    series.recordRequest(0);
    series.recordFailure(0);
    series.recordRequest(3);
    const view = series.view(4);
    expect(view.bucketSeconds).toBe(1);
    expect(view.points.map((p) => [p.second, p.requests, p.failures])).toEqual([
      [0, 2, 1],
      [1, 0, 0],
      [2, 0, 0],
      [3, 1, 0],
      [4, 0, 0],
    ]);
  });

  it("carries virtual users forward and leaves them null until the first report", () => {
    const series = createLiveSeries({ withVirtualUsers: true });
    series.recordRequest(0);
    series.recordVirtualUsers(2, 5);
    const view = series.view(4);
    expect(view.points.map((p) => p.virtualUsers)).toEqual([null, null, 5, 5, 5]);
  });

  it("reports no virtual users for a kind that has none", () => {
    const series = createLiveSeries({ withVirtualUsers: false });
    series.recordVirtualUsers(0, 9);
    series.recordRequest(1);
    expect(series.view(1).points.every((p) => p.virtualUsers === null)).toBe(true);
  });

  it("merges neighbouring buckets instead of dropping them, keeping every total", () => {
    const series = createLiveSeries({ withVirtualUsers: true, maxPoints: 4 });
    for (let second = 0; second < 4; second += 1) {
      series.recordRequest(second);
      if (second % 2 === 0) series.recordFailure(second);
    }
    series.recordVirtualUsers(1, 3);
    series.recordVirtualUsers(2, 7);
    expect(series.view(3).bucketSeconds).toBe(1);
    series.recordRequest(5);
    const view = series.view(5);
    expect(view.bucketSeconds).toBe(2);
    expect(view.points.map((p) => p.second)).toEqual([0, 2, 4]);
    expect(view.points.reduce((sum, p) => sum + p.requests, 0)).toBe(5);
    expect(view.points.reduce((sum, p) => sum + p.failures, 0)).toBe(2);
    expect(view.points.map((p) => p.virtualUsers)).toEqual([3, 7, 7]);
  });

  it("never holds more than the maximum number of points, however long the run", () => {
    const series = createLiveSeries({ withVirtualUsers: true, maxPoints: 100 });
    for (let second = 0; second < 5_000; second += 7) series.recordRequest(second);
    const view = series.view(5_000);
    expect(view.points.length).toBeLessThanOrEqual(100);
    expect(view.points.reduce((sum, p) => sum + p.requests, 0)).toBe(Math.ceil(5_000 / 7));
  });

  it("is deterministic for the same input", () => {
    const run = () => {
      const series = createLiveSeries({ withVirtualUsers: true, maxPoints: 8 });
      for (let second = 0; second < 40; second += 3) series.recordRequest(second);
      return series.view(40);
    };
    expect(run()).toEqual(run());
  });

  it("keeps the mean duration of the requests that completed in each bucket, null where none did", () => {
    const series = createLiveSeries({ withVirtualUsers: false });
    series.recordLatency(0, 10);
    series.recordLatency(0, 30);
    series.recordLatency(2, 5);
    expect(series.view(2).points.map((p) => p.latencyMs)).toEqual([20, null, 5]);
  });

  it("keeps the mean exactly when buckets are merged", () => {
    const series = createLiveSeries({ withVirtualUsers: false, maxPoints: 4 });
    series.recordLatency(0, 10);
    series.recordLatency(1, 30);
    series.recordLatency(2, 50);
    series.recordLatency(5, 70);
    const view = series.view(5);
    expect(view.bucketSeconds).toBe(2);
    expect(view.points.map((p) => p.latencyMs)).toEqual([20, 50, 70]);
  });

  it("breaks requests down by group when there are two to eight groups, and not otherwise", () => {
    const groups = [{ id: "a", label: "A" }, { id: "b", label: "B" }];
    const series = createLiveSeries({ withVirtualUsers: false, groups });
    series.recordRequest(0, "a");
    series.recordRequest(0, "b");
    series.recordRequest(0, "b");
    series.recordRequest(1, "unknown");
    const view = series.view(1);
    expect(view.groups).toEqual(groups);
    expect(view.points.map((p) => p.byGroup)).toEqual([{ a: 1, b: 2 }, { a: 0, b: 0 }]);
    expect(view.points.map((p) => p.requests)).toEqual([3, 1]);
    expect(createLiveSeries({ withVirtualUsers: false, groups: [groups[0]!] }).view(0).groups).toBeUndefined();
    const many = Array.from({ length: 9 }, (_, n) => ({ id: `g${n}`, label: `G${n}` }));
    expect(createLiveSeries({ withVirtualUsers: false, groups: many }).view(0).points[0]!.byGroup).toBeUndefined();
  });

  it("adds group counts when buckets are merged", () => {
    const series = createLiveSeries({ withVirtualUsers: false, maxPoints: 4, groups: [{ id: "a", label: "A" }, { id: "b", label: "B" }] });
    series.recordRequest(0, "a");
    series.recordRequest(1, "a");
    series.recordRequest(1, "b");
    series.recordRequest(5, "b");
    expect(series.view(5).points.map((p) => p.byGroup)).toEqual([{ a: 2, b: 1 }, { a: 0, b: 0 }, { a: 0, b: 1 }]);
  });
});
