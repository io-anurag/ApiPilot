import { describe, expect, it } from "vitest";
import { chainOutcomeShares, formatClockUtc, formatResponseText } from "../../src/components/liveRun/liveRunViewModel";

describe("formatClockUtc", () => {
  it("adds the second of the run to the start and shows UTC clock time", () => {
    expect(formatClockUtc("2026-10-12T13:35:10.000Z", 0)).toBe("13:35:10");
    expect(formatClockUtc("2026-10-12T13:35:10.000Z", 75)).toBe("13:36:25");
  });

  it("shows a dash when the start is not a date", () => {
    expect(formatClockUtc("not a date", 3)).toBe("—");
  });
});

describe("chainOutcomeShares", () => {
  it("is all passed when nothing failed", () => {
    expect(chainOutcomeShares(100, 0)).toEqual({ passed: 100, failed: 0 });
  });

  it("keeps a small failure rate visible", () => {
    const shares = chainOutcomeShares(94_114, 45);
    expect(shares.failed).toBe(2);
    expect(shares.passed).toBe(98);
  });

  it("shows the real share for a large failure rate", () => {
    expect(chainOutcomeShares(100, 40)).toEqual({ passed: 60, failed: 40 });
  });

  it("is empty before any request", () => {
    expect(chainOutcomeShares(0, 0)).toEqual({ passed: 0, failed: 0 });
  });
});

describe("formatResponseText", () => {
  it("indents a JSON body", () => {
    expect(formatResponseText('{"error":{"code":"X"}}', "application/json; charset=utf-8", false)).toBe(JSON.stringify({ error: { code: "X" } }, null, 2));
  });

  it("leaves text, a cut-short body and invalid JSON as received", () => {
    expect(formatResponseText("plain", "text/plain", false)).toBe("plain");
    expect(formatResponseText('{"a":', "application/json", true)).toBe('{"a":');
    expect(formatResponseText("not json", "application/json", false)).toBe("not json");
    expect(formatResponseText('{"a":1}', null, false)).toBe('{"a":1}');
  });
});
