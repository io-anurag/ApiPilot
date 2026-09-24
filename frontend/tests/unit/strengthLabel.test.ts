import { describe, expect, it } from "vitest";
import { strengthLabel } from "../../src/utils/strengthLabel";

describe("strengthLabel (AP-031 clarification 2026-09-24)", () => {
  it("labels a rule's fixed strength with no number", () => {
    expect(strengthLabel("high")).toBe("High");
    expect(strengthLabel("moderate")).toBe("Moderate");
  });
});
