import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { LiveRunSnapshot } from "@apipilot/shared-domain";
import { fetchLiveRun, type LiveRunResult } from "../../src/services/liveRunClient";
import { useLiveRun } from "../../src/components/liveRun/useLiveRun";
import { livePoint, liveSnapshot } from "./liveRunFixtures";

vi.mock("../../src/services/liveRunClient", () => ({ fetchLiveRun: vi.fn() }));

/** AP-045 T014: the hook that polls one run's live figures. */

const fetchMock = vi.mocked(fetchLiveRun);
const ok = (snapshot: LiveRunSnapshot): LiveRunResult => ({ ok: true, snapshot });
const OPTIONS = { kind: "chain", runId: "run-1" } as const;

/** Lets the pending promise chain settle without moving the fake clock. */
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("useLiveRun", () => {
  it("is loading before the first reply, then live", async () => {
    fetchMock.mockResolvedValue(ok(liveSnapshot()));
    const { result } = renderHook(() => useLiveRun(OPTIONS));
    expect(result.current.status).toBe("loading");
    expect(result.current.snapshot).toBeNull();
    await settle();
    expect(result.current.status).toBe("live");
  });

  it("starts a fresh mount at since=0 without a bucket, which restores the run so far", async () => {
    fetchMock.mockResolvedValue(ok(liveSnapshot({ series: { fromSecond: 0, bucketSeconds: 1, points: [0, 1, 2, 3, 4].map((s) => livePoint(s)) }, nextSince: 5 })));
    const { result } = renderHook(() => useLiveRun(OPTIONS));
    await settle();
    expect(fetchMock).toHaveBeenCalledWith("chain", { runId: "run-1", collectionId: undefined }, { since: 0, bucket: undefined });
    expect(result.current.snapshot?.series.points.map((p) => p.second)).toEqual([0, 1, 2, 3, 4]);
  });

  it("uses nextSince as the cursor, sends the held bucket and merges points by second", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(liveSnapshot({ series: { fromSecond: 0, bucketSeconds: 1, points: [livePoint(0), livePoint(1, { requests: 1 })] }, nextSince: 1 })))
      .mockResolvedValue(ok(liveSnapshot({ series: { fromSecond: 0, bucketSeconds: 1, points: [livePoint(1, { requests: 9 }), livePoint(2)] }, nextSince: 2 })));
    const { result } = renderHook(() => useLiveRun(OPTIONS));
    await settle();
    await tick(1000);
    expect(fetchMock.mock.calls[1][2]).toEqual({ since: 1, bucket: 1 });
    const points = result.current.snapshot?.series.points ?? [];
    expect(points.map((p) => p.second)).toEqual([0, 1, 2]);
    expect(points[1].requests).toBe(9);
  });

  it("replaces its points when the bucket width changes", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(liveSnapshot({ series: { fromSecond: 0, bucketSeconds: 1, points: [0, 1, 2, 3].map((s) => livePoint(s)) }, nextSince: 4 })))
      .mockResolvedValue(ok(liveSnapshot({ thinned: true, series: { fromSecond: 0, bucketSeconds: 2, points: [livePoint(0, { requests: 20 }), livePoint(2, { requests: 20 })] }, nextSince: 4 })));
    const { result } = renderHook(() => useLiveRun(OPTIONS));
    await settle();
    await tick(1000);
    expect(result.current.snapshot?.series.bucketSeconds).toBe(2);
    expect(result.current.snapshot?.series.points.map((p) => p.second)).toEqual([0, 2]);
  });

  it("never has two polls in flight", async () => {
    let release: (value: LiveRunResult) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<LiveRunResult>((resolve) => { release = resolve; }));
    renderHook(() => useLiveRun(OPTIONS));
    await tick(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(ok(liveSnapshot()));
    await settle();
    await tick(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("goes stale after 10 s without a reply, keeps the last figures, and recovers", async () => {
    const now = vi.fn(() => 1_000);
    fetchMock.mockResolvedValueOnce(ok(liveSnapshot())).mockResolvedValue({ ok: false, error: "network_error", message: "down", retryable: true });
    const { result } = renderHook(() => useLiveRun({ ...OPTIONS, now }));
    await settle();
    expect(result.current.status).toBe("live");
    await tick(9_000);
    expect(result.current.status).toBe("live");
    await tick(2_000);
    expect(result.current.status).toBe("stale");
    expect(result.current.snapshot?.totals.requests).toBe(120);
    expect(result.current.lastGoodAt).toBe(1_000);
    now.mockReturnValue(20_000);
    fetchMock.mockResolvedValue(ok(liveSnapshot({ totals: { requests: 200, failures: 2 }, nextSince: 4 })));
    await tick(1_000);
    expect(result.current.status).toBe("live");
    expect(result.current.snapshot?.totals.requests).toBe(200);
    expect(result.current.lastGoodAt).toBe(20_000);
  });

  it.each(["completed", "cancelled", "failed"] as const)("stops polling on the final state %s", async (state) => {
    fetchMock.mockResolvedValue(ok(liveSnapshot({ state })));
    const { result } = renderHook(() => useLiveRun(OPTIONS));
    await settle();
    expect(result.current.status).toBe(state);
    await tick(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows an error, and stops, when the first reply is refused for good", async () => {
    fetchMock.mockResolvedValue({ ok: false, error: "run_not_found", message: "No such run", retryable: false });
    const { result } = renderHook(() => useLiveRun(OPTIONS));
    await settle();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toEqual({ code: "run_not_found", message: "No such run" });
    await tick(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps trying after a first reply that failed for a reason that may pass", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, error: "network_error", message: "down", retryable: true }).mockResolvedValue(ok(liveSnapshot()));
    const { result } = renderHook(() => useLiveRun(OPTIONS));
    await settle();
    expect(result.current.status).toBe("loading");
    await tick(1000);
    expect(result.current.status).toBe("live");
  });

  it("stops polling when unmounted", async () => {
    fetchMock.mockResolvedValue(ok(liveSnapshot()));
    const { unmount } = renderHook(() => useLiveRun(OPTIONS));
    await settle();
    unmount();
    await tick(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
