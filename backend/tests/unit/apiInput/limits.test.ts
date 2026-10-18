import { describe, expect, it } from "vitest";
import {
  DEFAULT_INPUT_LIMITS,
  InvalidInputConfigurationError,
  loadInputLimits,
} from "../../../src/apiInput/limits";
import { validateInputConfiguration } from "../../../src/config";

describe("loadInputLimits", () => {
  it("uses the documented defaults when nothing is set", () => {
    expect(loadInputLimits({})).toEqual({ harMaxEntries: 5000, maxBodyBytes: 1_048_576, maxJsonDepth: 128 });
    expect(loadInputLimits({})).toEqual(DEFAULT_INPUT_LIMITS);
  });

  it("treats empty and whitespace values as unset", () => {
    expect(loadInputLimits({ INPUT_HAR_MAX_ENTRIES: "  ", INPUT_MAX_BODY_BYTES: "" })).toEqual(DEFAULT_INPUT_LIMITS);
  });

  it("reads each override", () => {
    expect(
      loadInputLimits({ INPUT_HAR_MAX_ENTRIES: "10", INPUT_MAX_BODY_BYTES: "2048", INPUT_MAX_JSON_DEPTH: "16" }),
    ).toEqual({ harMaxEntries: 10, maxBodyBytes: 2048, maxJsonDepth: 16 });
  });

  it.each(["0", "-5", "1.5", "abc", "Infinity", "NaN"])("rejects the invalid value %s and names the variable", (value) => {
    expect(() => loadInputLimits({ INPUT_HAR_MAX_ENTRIES: value })).toThrow(InvalidInputConfigurationError);
    expect(() => loadInputLimits({ INPUT_MAX_JSON_DEPTH: value })).toThrow(/INPUT_MAX_JSON_DEPTH/);
  });
});

describe("validateInputConfiguration", () => {
  it("accepts an empty environment and a valid one", () => {
    expect(() => validateInputConfiguration({})).not.toThrow();
    expect(() => validateInputConfiguration({ INPUT_MAX_BODY_BYTES: "4096" })).not.toThrow();
  });

  it("fails startup validation on a malformed value", () => {
    expect(() => validateInputConfiguration({ INPUT_MAX_BODY_BYTES: "lots" })).toThrow(/INPUT_MAX_BODY_BYTES/);
  });
});
