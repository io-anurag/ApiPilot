import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { useWorkflowSnapshot } from "../../src/hooks/useWorkflowSnapshot";

const WORKFLOW = { id: "wf-1", activeStageId: "analysis", stages: {} } as unknown as TestGenerationWorkflow;

function stub(response: () => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(response));
}

describe("useWorkflowSnapshot (AP-054)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the session's workflow once and becomes ready", async () => {
    stub(async () => ({ ok: true, status: 200, json: () => Promise.resolve({ workflow: WORKFLOW }) }));
    const { result } = renderHook(() => useWorkflowSnapshot());
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.workflow).toEqual(WORKFLOW);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("is ready with no workflow when the session has none", async () => {
    stub(async () => ({ ok: true, status: 204, json: () => Promise.resolve(null) }));
    const { result } = renderHook(() => useWorkflowSnapshot());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.workflow).toBeNull();
  });

  it("is ready with no workflow, and does not throw, when the read fails", async () => {
    stub(async () => {
      throw new Error("network down");
    });
    const { result } = renderHook(() => useWorkflowSnapshot());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.workflow).toBeNull();
  });

  it("takes the page's reports as newer than its own first read", async () => {
    let release: (value: unknown) => void = () => undefined;
    stub(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => useWorkflowSnapshot());
    const reported = { ...WORKFLOW, id: "wf-2" } as TestGenerationWorkflow;
    act(() => result.current.update(reported));
    expect(result.current.ready).toBe(true);
    await act(async () => {
      release({ ok: true, status: 200, json: () => Promise.resolve({ workflow: WORKFLOW }) });
    });
    expect(result.current.workflow?.id).toBe("wf-2");
  });

  it("keeps a stable update function", async () => {
    stub(async () => ({ ok: true, status: 204, json: () => Promise.resolve(null) }));
    const { result, rerender } = renderHook(() => useWorkflowSnapshot());
    const first = result.current.update;
    rerender();
    expect(result.current.update).toBe(first);
    await waitFor(() => expect(result.current.ready).toBe(true));
  });
});
