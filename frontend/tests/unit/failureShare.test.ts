import { describe, expect, it } from "vitest";
import { failureShare } from "../../src/components/liveRun/liveRunViewModel";

describe("failureShare", () => {
  it("is null before any request, not 0%", () => {
    expect(failureShare(0, 0)).toBeNull();
  });

  it("keeps one decimal for ordinary shares", () => {
    expect(failureShare(0, 1000)).toBe("0.0% of requests");
    expect(failureShare(17, 1000)).toBe("1.7% of requests");
  });

  it("never captions a non-zero failure count as 0.0%", () => {
    expect(failureShare(31, 125_770)).toBe("0.02% of requests");
    expect(failureShare(1, 1_000_000)).toBe("<0.01% of requests");
  });
});
