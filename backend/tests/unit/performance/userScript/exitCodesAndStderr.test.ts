import { describe, expect, it } from "vitest";
import { exitMeaningOf, settledStatusOf } from "../../../../src/performance/userScript/exitCodes";
import { createStderrFilter, MAX_K6_MESSAGE_CHARS } from "../../../../src/performance/userScript/stderrFilter";

/** AP-034 FR-029, FR-040 (research R13; tasks T021). */
describe("k6 exit codes", () => {
  it.each([
    [0, "completed", "completed", "completed"],
    [99, "script-thresholds-crossed", "completed", "completed"],
    [108, "aborted-by-script", "completed", "completed"],
    [110, "marked-failed-by-script", "completed", "completed"],
    [104, "invalid-config", "failed", "failed"],
    [107, "script-exception", "failed", "failed"],
    [1, "other", "completed", "failed"],
  ] as const)("exit %i means %s; with requests %s, without %s", (code, meaning, withRequests, withoutRequests) => {
    expect(exitMeaningOf(code)).toBe(meaning);
    expect(settledStatusOf(code, 5)).toBe(withRequests);
    expect(settledStatusOf(code, 0)).toBe(withoutRequests);
  });

  it("has no meaning for a killed process", () => {
    expect(exitMeaningOf(null)).toBeNull();
  });
});

describe("stderr filter", () => {
  const SECRET = "seeded-secret-value";

  it("drops console output, counts unreadable lines and keeps k6's errors", () => {
    const filter = createStderrFilter();
    filter.onLine(JSON.stringify({ level: "info", msg: SECRET, source: "console" }));
    filter.onLine(JSON.stringify({ level: "error", msg: SECRET, source: "console" }));
    filter.onLine("not json");
    filter.onLine(JSON.stringify({ level: "warning", msg: "a warning" }));
    filter.onLine(JSON.stringify({ level: "error", msg: "ReferenceError: x is not defined at file:///script.js:3:5(4)" }));
    expect(filter.keptErrorText()).toBe("ReferenceError: x is not defined at file:///script.js:3:5(4)");
    expect(filter.keptErrorText()).not.toContain(SECRET);
    expect(filter.counts()).toEqual({ lines: 5, consoleLines: 2, unreadableLines: 1 });
  });

  it("keeps at most 2,000 characters in total", () => {
    const filter = createStderrFilter();
    for (let i = 0; i < 5; i += 1) filter.onLine(JSON.stringify({ level: "error", msg: "x".repeat(900) }));
    expect(filter.keptErrorText()!.length).toBe(MAX_K6_MESSAGE_CHARS);
  });

  it("returns null when k6 printed no error", () => {
    expect(createStderrFilter().keptErrorText()).toBeNull();
  });
});
