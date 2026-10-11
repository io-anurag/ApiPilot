import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePerformancePath } from "../../src/hooks/usePerformancePath";

describe("usePerformancePath (R7: in memory)", () => {
  it("starts closed, opens on a picked source and reports a draft", () => {
    const { result } = renderHook(() => usePerformancePath());
    expect(result.current.visible).toBe(false);
    expect(result.current.draft).toBe(false);
    act(() => result.current.pick("specification", true, ["a", "b"]));
    expect(result.current.visible).toBe(true);
    expect(result.current.draft).toBe(true);
    expect(result.current.state).toMatchObject({ step: "operations", selection: ["a", "b"] });
  });

  it("parks on leave, keeps the selection and resumes on the same step", () => {
    const { result } = renderHook(() => usePerformancePath());
    act(() => result.current.pick("specification", true, ["a", "b"]));
    act(() => result.current.setSelection(["a"]));
    act(() => result.current.leave());
    expect(result.current.visible).toBe(false);
    expect(result.current.draft).toBe(true);
    act(() => result.current.resume());
    expect(result.current.visible).toBe(true);
    expect(result.current.state).toMatchObject({ step: "operations", selection: ["a"] });
  });

  it("moves through the steps and stops at the ends", () => {
    const { result } = renderHook(() => usePerformancePath());
    act(() => result.current.pick("specification", true, ["a"]));
    act(() => result.current.planCreated("p1"));
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.state.step).toBe("run");
    act(() => result.current.next());
    expect(result.current.state.step).toBe("run");
    act(() => result.current.go("load"));
    expect(result.current.state.step).toBe("load");
    act(() => result.current.leave());
    expect(result.current.visible).toBe(false);
    expect(result.current.draft).toBe(false);
  });

  it("discards a draft", () => {
    const { result } = renderHook(() => usePerformancePath());
    act(() => result.current.pick("collection", false, []));
    act(() => result.current.leave());
    act(() => result.current.discard());
    expect(result.current.draft).toBe(false);
    expect(result.current.state.source).toBeNull();
  });
});
