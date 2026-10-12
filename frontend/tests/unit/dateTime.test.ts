import { describe, expect, it } from "vitest";
import { formatDateTimeUtc, formatTimeUtc } from "../../src/dateTime";

/** One format for every date and time on screen: UTC, fixed, independent of the browser's locale. */
describe("dateTime", () => {
  it("shows an ISO moment as UTC date and time", () => {
    expect(formatDateTimeUtc("2026-10-12T13:32:53.000Z")).toBe("2026-10-12 13:32:53 UTC");
    expect(formatTimeUtc("2026-10-12T13:32:53.000Z")).toBe("13:32:53 UTC");
  });

  it("converts an offset to UTC rather than keeping the offset", () => {
    expect(formatDateTimeUtc("2026-10-12T19:02:53+05:30")).toBe("2026-10-12 13:32:53 UTC");
  });

  it("takes an epoch in milliseconds", () => {
    expect(formatTimeUtc(Date.parse("2026-10-12T00:00:09.000Z"))).toBe("00:00:09 UTC");
  });

  it("returns a value that is not a date as it came", () => {
    expect(formatDateTimeUtc("not a date")).toBe("not a date");
    expect(formatTimeUtc("")).toBe("");
  });
});
