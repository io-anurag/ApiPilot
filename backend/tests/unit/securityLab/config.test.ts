import { describe, expect, it } from "vitest";
import {
  InvalidSecurityLabConfigurationError,
  PROFILE_DEFAULTS,
  loadSecurityLabLimits,
  validateSecurityLabConfiguration,
} from "../../../src/securityLab/config";

describe("Security Lab configuration", () => {
  it("uses the documented ceilings, caps and profile defaults when nothing is set", () => {
    expect(loadSecurityLabLimits({})).toEqual({
      ceilings: { maxRequests: 500, maxConcurrency: 4, timeoutMs: 30_000, maxRepeat: 50 },
      retention: { maxScenarios: 20_000, maxRuns: 500 },
    });
    expect(PROFILE_DEFAULTS).toEqual({ maxRequests: 100, maxConcurrency: 1, timeoutMs: 10_000 });
  });

  it("reads a configured value and treats a blank value as unset", () => {
    const limits = loadSecurityLabLimits({
      SECURITY_LAB_MAX_REQUESTS_CEILING: "250",
      SECURITY_LAB_MAX_CONCURRENCY_CEILING: "  ",
    });
    expect(limits.ceilings.maxRequests).toBe(250);
    expect(limits.ceilings.maxConcurrency).toBe(4);
  });

  it.each([
    ["SECURITY_LAB_MAX_REQUESTS_CEILING", "0"],
    ["SECURITY_LAB_MAX_REQUESTS_CEILING", "5001"],
    ["SECURITY_LAB_MAX_CONCURRENCY_CEILING", "17"],
    ["SECURITY_LAB_TIMEOUT_MS_CEILING", "999"],
    ["SECURITY_LAB_MAX_REPEAT_CEILING", "51"],
    ["SECURITY_LAB_MAX_RETAINED_SCENARIOS", "10"],
    ["SECURITY_LAB_MAX_RETAINED_RUNS", "abc"],
    ["SECURITY_LAB_MAX_RETAINED_RUNS", "1.5"],
  ])("refuses %s=%s, naming the variable", (variable, value) => {
    expect(() => validateSecurityLabConfiguration({ [variable]: value })).toThrow(InvalidSecurityLabConfigurationError);
    expect(() => validateSecurityLabConfiguration({ [variable]: value })).toThrow(variable);
  });
});
