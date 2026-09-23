import { describe, expect, it } from "vitest";
import { createInProgressRegistry } from "../../../src/failureAnalysis/inProgressRegistry";

function clock() {
  let current = new Date("2026-09-23T10:00:00.000Z");
  return {
    now: () => current,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

const target = { runId: "run-1", resultIndex: 2, requestName: "Create user" };

describe("inProgressRegistry (FR-016, research D10)", () => {
  it("allows one analysis per session, for any result", () => {
    const registry = createInProgressRegistry();
    expect(registry.tryBegin("s1", target)).toBe(true);
    expect(registry.tryBegin("s1", target)).toBe(false);
    expect(registry.tryBegin("s1", { ...target, resultIndex: 5 })).toBe(false);
  });

  it("keeps sessions independent", () => {
    const registry = createInProgressRegistry();
    expect(registry.tryBegin("s1", target)).toBe(true);
    expect(registry.tryBegin("s2", target)).toBe(true);
  });

  it("starts waiting for the AI and switches to generating with a fresh phase start", () => {
    const time = clock();
    const registry = createInProgressRegistry(time.now);
    registry.tryBegin("s1", target);
    expect(registry.get("s1")).toEqual({ ...target, phase: "waiting-for-ai", phaseStartedAt: "2026-09-23T10:00:00.000Z" });

    time.advance(5_000);
    registry.markGenerating("s1");
    expect(registry.get("s1")).toMatchObject({ phase: "generating", phaseStartedAt: "2026-09-23T10:00:05.000Z" });
  });

  it("clears the entry on end, and reports nothing for an idle session", () => {
    const registry = createInProgressRegistry();
    registry.tryBegin("s1", target);
    registry.end("s1");
    expect(registry.get("s1")).toBeUndefined();
    expect(registry.tryBegin("s1", target)).toBe(true);
  });
});
