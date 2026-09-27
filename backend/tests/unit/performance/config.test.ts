import { describe, expect, it } from "vitest";
import { defaultK6BinaryName, resolveK6BinaryPath } from "../../../src/performance/config";

describe("performance config (AP-029 research D22)", () => {
  it("reads a trimmed K6_BINARY_PATH", () => {
    expect(resolveK6BinaryPath({ K6_BINARY_PATH: "  /opt/k6/bin/k6  " })).toBe("/opt/k6/bin/k6");
  });

  it("treats an unset or blank K6_BINARY_PATH as 'use PATH'", () => {
    expect(resolveK6BinaryPath({})).toBeUndefined();
    expect(resolveK6BinaryPath({ K6_BINARY_PATH: "   " })).toBeUndefined();
  });

  it("looks up k6.exe on Windows and k6 elsewhere", () => {
    expect(defaultK6BinaryName("win32")).toBe("k6.exe");
    expect(defaultK6BinaryName("linux")).toBe("k6");
    expect(defaultK6BinaryName("darwin")).toBe("k6");
  });
});
