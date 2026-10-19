import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSecurityRun } from "../../../src/hooks/useSecurityRun";
import * as client from "../../../src/services/securityLabClient";
import { runDetail, scenarioResult } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  fetchRun: vi.fn(),
}));

const fetchRun = vi.mocked(client.fetchRun);
type Reply = Awaited<ReturnType<typeof client.fetchRun>>;

const running = (finished = 0): Reply => ({ ok: true, data: runDetail({ run: { status: "in-progress" }, results: finished ? [scenarioResult()] : [] }) });
const done = (status: "completed" | "cancelled" | "failed" = "completed"): Reply => ({ ok: true, data: runDetail({ run: { status }, results: [scenarioResult()] }) });
const failure = (error = "network_error"): Reply => ({ ok: false, error, message: `${error} message`, status: error === "run_not_found" ? 404 : 0, details: {} });

const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers();
  fetchRun.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("useSecurityRun (T105)", () => {
  it("reads the run at once, then once a second, and passes the run id to the client", async () => {
    fetchRun.mockResolvedValue(running());
    const { result } = renderHook(() => useSecurityRun("run-1"));
    await tick(0);
    expect(fetchRun).toHaveBeenCalledTimes(1);
    expect(fetchRun.mock.calls[0][0]).toBe("run-1");
    expect(result.current.detail?.run.status).toBe("in-progress");
    expect(result.current.polling).toBe(true);
    await tick(999);
    expect(fetchRun).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(fetchRun).toHaveBeenCalledTimes(2);
    await tick(3000);
    expect(fetchRun).toHaveBeenCalledTimes(5);
  });

  it.each(["completed", "cancelled", "failed"] as const)("stops polling when the run is %s", async (status) => {
    fetchRun.mockResolvedValueOnce(running()).mockResolvedValueOnce(running(1)).mockResolvedValue(done(status));
    const { result } = renderHook(() => useSecurityRun("run-1"));
    await tick(0);
    await tick(1000);
    await tick(1000);
    expect(result.current.detail?.run.status).toBe(status);
    expect(result.current.polling).toBe(false);
    const calls = fetchRun.mock.calls.length;
    await tick(10_000);
    expect(fetchRun).toHaveBeenCalledTimes(calls);
  });

  it("stops at once when the first reply is already final", async () => {
    fetchRun.mockResolvedValue(done());
    const { result } = renderHook(() => useSecurityRun("run-1"));
    await tick(0);
    expect(result.current.polling).toBe(false);
    await tick(5000);
    expect(fetchRun).toHaveBeenCalledTimes(1);
  });

  it("never overlaps reads: the next is scheduled only after the previous settled", async () => {
    let release!: (reply: Reply) => void;
    fetchRun.mockReturnValueOnce(new Promise<Reply>((resolve) => (release = resolve)));
    fetchRun.mockResolvedValue(running());
    renderHook(() => useSecurityRun("run-1"));
    await tick(0);
    await tick(5000); // far longer than the interval while the first read is still pending
    expect(fetchRun).toHaveBeenCalledTimes(1);
    release(running());
    await tick(0);
    expect(fetchRun).toHaveBeenCalledTimes(1);
    await tick(1000);
    expect(fetchRun).toHaveBeenCalledTimes(2);
  });

  it("shows a failed read as an error, keeps the last results and keeps trying, and clears the error on success", async () => {
    fetchRun.mockResolvedValueOnce(running(1)).mockResolvedValueOnce(failure()).mockResolvedValue(running(1));
    const { result } = renderHook(() => useSecurityRun("run-1"));
    await tick(0);
    expect(result.current.detail?.results).toHaveLength(1);
    await tick(1000);
    expect(result.current.error).toEqual({ code: "network_error", message: "network_error message" });
    expect(result.current.detail?.results).toHaveLength(1);
    expect(result.current.polling).toBe(true);
    await tick(1000);
    expect(result.current.error).toBeNull();
  });

  it("stops on run_not_found and resumes on retry", async () => {
    fetchRun.mockResolvedValueOnce(failure("run_not_found")).mockResolvedValue(running());
    const { result } = renderHook(() => useSecurityRun("run-1"));
    await tick(0);
    expect(result.current.error?.code).toBe("run_not_found");
    expect(result.current.polling).toBe(false);
    await tick(5000);
    expect(fetchRun).toHaveBeenCalledTimes(1);
    act(() => result.current.retry());
    await tick(0);
    expect(fetchRun).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.polling).toBe(true);
  });

  it("reads again at once on refreshNow while waiting, without a second read in flight", async () => {
    fetchRun.mockResolvedValue(running());
    const { result } = renderHook(() => useSecurityRun("run-1"));
    await tick(0);
    act(() => result.current.refreshNow());
    await tick(0);
    expect(fetchRun).toHaveBeenCalledTimes(2);
    await tick(1000);
    expect(fetchRun).toHaveBeenCalledTimes(3);
  });

  it("does nothing without a run id, and starts afresh when the id changes", async () => {
    fetchRun.mockResolvedValue(running());
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useSecurityRun(id), { initialProps: { id: null as string | null } });
    await tick(3000);
    expect(fetchRun).not.toHaveBeenCalled();
    expect(result.current.polling).toBe(false);
    rerender({ id: "run-1" });
    await tick(0);
    expect(result.current.detail?.run.id).toBe("run-1");
    fetchRun.mockResolvedValue({ ok: true, data: runDetail({ run: { id: "run-2" } }) });
    rerender({ id: "run-2" });
    expect(result.current.detail).toBeNull();
    await tick(0);
    expect(result.current.detail?.run.id).toBe("run-2");
  });

  it("stops polling and aborts the read on unmount", async () => {
    fetchRun.mockResolvedValue(running());
    const { unmount } = renderHook(() => useSecurityRun("run-1"));
    await tick(0);
    const signal = (fetchRun.mock.calls[0][1] as { signal: AbortSignal }).signal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
    await tick(10_000);
    expect(fetchRun).toHaveBeenCalledTimes(1);
  });

  it("honours a different interval", async () => {
    fetchRun.mockResolvedValue(running());
    renderHook(() => useSecurityRun("run-1", 250));
    await tick(0);
    await tick(1000);
    expect(fetchRun).toHaveBeenCalledTimes(5);
  });
});
