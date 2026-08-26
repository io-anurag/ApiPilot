import { describe, expect, it } from "vitest";
import { createVersionInfo } from "../../src/index";

describe("createVersionInfo", () => {
  it("returns the provided version and commit", () => {
    const result = createVersionInfo("0.1.0", "abc1234");

    expect(result).toEqual({ version: "0.1.0", commit: "abc1234" });
  });
});
