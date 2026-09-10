import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forceExpireForTest,
  getStatus,
  onExpire,
  resetRegistryForTest,
  sweepForTest,
  touch,
} from "../../../src/session/sessionRegistry";

describe("sessionRegistry", () => {
  beforeEach(() => {
    resetRegistryForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a never-seen session id as absent", () => {
    expect(getStatus("never-seen")).toBe("absent");
  });

  it("touch() creates a live entry on first use", () => {
    touch("s1");
    expect(getStatus("s1")).toBe("live");
  });

  it("the sweep tombstones an entry idle for over 60 minutes", () => {
    vi.useFakeTimers();
    touch("idle-session");

    vi.advanceTimersByTime(61 * 60 * 1000);
    sweepForTest();

    expect(getStatus("idle-session")).toBe("expired");
  });

  it("the sweep leaves an active entry (touched within the window) alone", () => {
    vi.useFakeTimers();
    touch("active-session");

    vi.advanceTimersByTime(30 * 60 * 1000);
    touch("active-session"); // still active — refreshes lastActivityAt
    vi.advanceTimersByTime(45 * 60 * 1000);
    sweepForTest();

    // 45 minutes since the last touch is under the 60-minute idle window.
    expect(getStatus("active-session")).toBe("live");
  });

  it("forceExpireForTest immediately tombstones a session without waiting on the sweep", () => {
    touch("s2");
    forceExpireForTest("s2");
    expect(getStatus("s2")).toBe("expired");
  });

  it("forceExpireForTest works even for a session that was never touched", () => {
    forceExpireForTest("s3");
    expect(getStatus("s3")).toBe("expired");
  });

  it("notifies onExpire listeners exactly once per expiry", () => {
    const notified: string[] = [];
    onExpire((sessionId) => notified.push(sessionId));

    touch("s4");
    forceExpireForTest("s4");

    expect(notified).toEqual(["s4"]);
  });

  it("resetRegistryForTest clears every entry", () => {
    touch("s5");
    resetRegistryForTest();
    expect(getStatus("s5")).toBe("absent");
  });
});
