import { describe, expect, it } from "vitest";
import { InvalidAIConfigurationError, validateAIConfiguration } from "../../src/config";

describe("validateAIConfiguration", () => {
  it("accepts an omitted enhancement run budget", () => {
    expect(() => validateAIConfiguration({})).not.toThrow();
  });

  it.each(["0", "-1", "not-a-number", "Infinity"])(
    "rejects an invalid enhancement run budget: %s",
    (value) => {
      expect(() =>
        validateAIConfiguration({ AI_ENHANCEMENT_RUN_BUDGET_MS: value }),
      ).toThrow(InvalidAIConfigurationError);
    },
  );

  it("accepts a positive finite enhancement run budget", () => {
    expect(() =>
      validateAIConfiguration({ AI_ENHANCEMENT_RUN_BUDGET_MS: "300000" }),
    ).not.toThrow();
  });
});
