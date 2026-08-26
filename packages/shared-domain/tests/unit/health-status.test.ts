import { describe, expect, it } from "vitest";
import { createHealthStatus } from "../../src/index";

describe("createHealthStatus", () => {
  it("returns status ok and an ISO-8601 timestamp", () => {
    const fixedDate = new Date("2026-08-26T12:00:00.000Z");

    const result = createHealthStatus(fixedDate);

    expect(result.status).toBe("ok");
    expect(result.timestamp).toBe("2026-08-26T12:00:00.000Z");
  });

  it("defaults to the current time when no date is provided", () => {
    const before = Date.now();

    const result = createHealthStatus();

    const parsed = Date.parse(result.timestamp);
    expect(parsed).toBeGreaterThanOrEqual(before);
  });
});
