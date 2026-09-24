import { describe, expect, it } from "vitest";
import { confidenceLabel, formatConfidence } from "../../src/utils/confidenceLabel";

describe("confidenceLabel (AP-031 clarification 2026-09-23)", () => {
  it("labels 0.5 up to below 0.75 as Moderate and 0.75 and above as High", () => {
    expect(confidenceLabel(0.5)).toBe("Moderate");
    expect(confidenceLabel(0.74)).toBe("Moderate");
    expect(confidenceLabel(0.75)).toBe("High");
    expect(confidenceLabel(1)).toBe("High");
  });

  it("shows the exact value next to the label", () => {
    expect(formatConfidence(0.62)).toBe("Moderate (0.62)");
    expect(formatConfidence(0.8)).toBe("High (0.80)");
  });
});
