import { describe, expect, it } from "vitest";
import { InvalidAIConfigurationError, loadConfig, validateAIConfiguration } from "../../src/config";

describe("loadConfig", () => {
  it("defaults debugLogRealClientIp to false when unset", () => {
    expect(loadConfig({}).debugLogRealClientIp).toBe(false);
  });

  it("enables debugLogRealClientIp only for the exact value \"true\"", () => {
    expect(loadConfig({ DEBUG_LOG_REAL_CLIENT_IP: "true" }).debugLogRealClientIp).toBe(true);
    expect(loadConfig({ DEBUG_LOG_REAL_CLIENT_IP: "TRUE" }).debugLogRealClientIp).toBe(false);
    expect(loadConfig({ DEBUG_LOG_REAL_CLIENT_IP: "1" }).debugLogRealClientIp).toBe(false);
  });
});

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
