import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBulkDecision } from "../../src/hooks/useBulkDecision";

describe("useBulkDecision", () => {
  it("sends one call when the target array is at or below the batch size", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useBulkDecision({ batchSize: 2 }));

    await act(async () => {
      await result.current.run(["a", "b"], submit);
    });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(["a", "b"]);
    expect(result.current.status).toBe("done");
    expect(result.current.total).toBe(2);
    expect(result.current.processed).toBe(2);
    expect(result.current.succeeded).toBe(2);
    expect(result.current.failed).toEqual([]);
  });

  it("splits a larger target array into ordered, contiguous chunks and reports progress between calls", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useBulkDecision({ batchSize: 2 }));

    await act(async () => {
      await result.current.run(["a", "b", "c", "d", "e"], submit);
    });

    expect(submit).toHaveBeenCalledTimes(3);
    expect(submit).toHaveBeenNthCalledWith(1, ["a", "b"]);
    expect(submit).toHaveBeenNthCalledWith(2, ["c", "d"]);
    expect(submit).toHaveBeenNthCalledWith(3, ["e"]);
    expect(result.current.total).toBe(5);
    expect(result.current.processed).toBe(5);
    expect(result.current.succeeded).toBe(5);
  });

  it("aggregates per-item outcomes individually when the submit function returns them", async () => {
    const submit = vi.fn().mockResolvedValue({
      ok: true,
      perItem: [
        { id: "a", applied: true },
        { id: "b", applied: false, message: "stale revision" },
      ],
    });
    const { result } = renderHook(() => useBulkDecision({ batchSize: 5 }));

    await act(async () => {
      await result.current.run(["a", "b"], submit);
    });

    expect(result.current.succeeded).toBe(1);
    expect(result.current.failed).toEqual([{ id: "b", message: "stale revision" }]);
  });

  it("treats an entire chunk as failed when submit reports a chunk-level error", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: false, message: "unknown_workflow_id" });
    const { result } = renderHook(() => useBulkDecision({ batchSize: 5 }));

    await act(async () => {
      await result.current.run(["w1", "w2"], submit);
    });

    expect(result.current.succeeded).toBe(0);
    expect(result.current.failed).toEqual([
      { id: "w1", message: "unknown_workflow_id" },
      { id: "w2", message: "unknown_workflow_id" },
    ]);
    expect(result.current.status).toBe("done");
  });
});
