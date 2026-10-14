import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forceExpireForTest,
  getExpiryReason,
  getStatus,
  markActive,
  markLostToRestart,
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

  it("records the expiry reason: inactivity for an idle eviction, backend-restart for a lost-to-restart id", () => {
    touch("idle");
    forceExpireForTest("idle");
    markLostToRestart("restarted");

    expect(getExpiryReason("idle")).toBe("inactivity");
    expect(getExpiryReason("restarted")).toBe("backend-restart");
    expect(getStatus("restarted")).toBe("expired");
  });

  it("has no expiry reason for a live or never-seen session", () => {
    touch("live");
    expect(getExpiryReason("live")).toBeUndefined();
    expect(getExpiryReason("never-seen")).toBeUndefined();
  });

  it("markLostToRestart does not notify onExpire listeners, so persisted per-session data is kept", () => {
    const notified: string[] = [];
    onExpire((sessionId) => notified.push(sessionId));

    markLostToRestart("s6");

    expect(notified).not.toContain("s6");
  });

  it("markActive clears a restart tombstone", () => {
    markLostToRestart("s7");
    markActive("s7");

    expect(getStatus("s7")).toBe("live");
    expect(getExpiryReason("s7")).toBeUndefined();
  });

  it("resetRegistryForTest clears every entry", () => {
    touch("s5");
    resetRegistryForTest();
    expect(getStatus("s5")).toBe("absent");
  });
});
