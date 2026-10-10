import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useCoverage } from "../../../src/hooks/useCoverage";
import { fetchCoverage, type CoverageResult } from "../../../src/services/coverageClient";
import { snapshot } from "./coverageFixtures";

vi.mock("../../../src/services/coverageClient", () => ({ fetchCoverage: vi.fn() }));

const fetchMock = vi.mocked(fetchCoverage);
const named = (name: string): CoverageResult => ({
  ok: true,
  snapshot: snapshot({ specification: { name, revision: "r", operationCount: 1 } }),
});

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useCoverage", () => {
  it("does not request anything while inactive and loads when activated", async () => {
    fetchMock.mockResolvedValue(named("A"));
    const { result, rerender } = renderHook(({ active }) => useCoverage({}, active), { initialProps: { active: false } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.snapshot).toBeNull();
    rerender({ active: true });
    await waitFor(() => expect(result.current.snapshot?.specification.name).toBe("A"));
    expect(result.current.loading).toBe(false);
  });

  it("never lets a slow earlier reply overwrite a newer selection (FR-035)", async () => {
    let releaseFirst: (value: CoverageResult) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<CoverageResult>((resolve) => (releaseFirst = resolve)));
    fetchMock.mockResolvedValueOnce(named("Newer"));
    const { result, rerender } = renderHook(({ q }) => useCoverage({ q }, true), { initialProps: { q: "a" } });
    rerender({ q: "ab" });
    await waitFor(() => expect(result.current.snapshot?.specification.name).toBe("Newer"));
    await act(async () => {
      releaseFirst(named("Older"));
      await Promise.resolve();
    });
    expect(result.current.snapshot?.specification.name).toBe("Newer");
    expect(result.current.loading).toBe(false);
  });

  it("separates a missing specification from a failure and keeps the last snapshot on failure", async () => {
    fetchMock.mockResolvedValueOnce(named("A"));
    const { result } = renderHook(() => useCoverage({}, true));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());

    fetchMock.mockResolvedValueOnce({ ok: false, error: "network_error", message: "offline" });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.problem).toEqual({ kind: "error", message: "offline" }));
    expect(result.current.snapshot?.specification.name).toBe("A");

    fetchMock.mockResolvedValueOnce({ ok: false, error: "no_active_workflow", message: "none" });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.problem?.kind).toBe("no-workflow"));
    expect(result.current.snapshot).toBeNull();
  });

  it("clears an earlier problem after a successful reply", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, error: "network_error", message: "offline" });
    const { result } = renderHook(() => useCoverage({}, true));
    await waitFor(() => expect(result.current.problem).not.toBeNull());
    fetchMock.mockResolvedValueOnce(named("A"));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.problem).toBeNull());
  });
});
