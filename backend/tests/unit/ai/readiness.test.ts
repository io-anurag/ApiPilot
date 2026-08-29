import { describe, expect, it } from "vitest";
import { ReadinessTracker } from "../../../src/ai/readiness";

describe("ReadinessTracker", () => {
  it("starts in the not-loaded state", () => {
    const tracker = new ReadinessTracker();
    expect(tracker.getState().state).toBe("not-loaded");
  });

  it("transitions not-loaded -> loading -> ready", () => {
    const tracker = new ReadinessTracker();

    tracker.markLoading(false);
    expect(tracker.getState().state).toBe("loading");

    tracker.markReady({ modelId: "m1", acceleratorRequested: false, acceleratorActive: false });
    const state = tracker.getState();
    expect(state.state).toBe("ready");
    expect(state.modelId).toBe("m1");
  });

  it("requires a non-empty reason when transitioning to unavailable", () => {
    const tracker = new ReadinessTracker();

    tracker.markUnavailable({ reason: "model cache is corrupted" });

    const state = tracker.getState();
    expect(state.state).toBe("unavailable");
    expect(state.reason).toBeTruthy();
  });

  it("never auto-transitions back to loading after a failure without an explicit reset", () => {
    const tracker = new ReadinessTracker();

    tracker.markUnavailable({ reason: "load failed" });
    expect(tracker.getState().state).toBe("unavailable");
    // Repeated reads must not silently change state on their own.
    expect(tracker.getState().state).toBe("unavailable");

    tracker.reset();
    expect(tracker.getState().state).toBe("not-loaded");
  });
});
