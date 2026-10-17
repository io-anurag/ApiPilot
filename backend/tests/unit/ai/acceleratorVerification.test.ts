import { describe, expect, it } from "vitest";
import {
  ACCELERATOR_CANARY_INPUT,
  ACCELERATOR_CANARY_MAX_NEW_TOKENS,
  ACCELERATOR_CANARY_VERSION,
  evaluateCanaryReply,
} from "../../../src/ai/acceleratorVerification";

describe("accelerator verification canary (specs/055-accelerator-canary-check)", () => {
  it("pins the versioned canary definition", () => {
    // Changing any of these changes behavior: bump the version and re-run the opt-in real-model test.
    expect(ACCELERATOR_CANARY_VERSION).toBe(1);
    expect(ACCELERATOR_CANARY_MAX_NEW_TOKENS).toBe(12);
    expect(ACCELERATOR_CANARY_INPUT).toBe('Reply with exactly: {"candidates":[]}');
  });

  describe("evaluateCanaryReply", () => {
    it.each([
      ["an empty candidate list", '{"candidates":[]}'],
      ["a non-empty candidate list", '{"candidates":[{"rationale":"x"}]}'],
      ["a pretty-printed reply", '{\n  "candidates": []\n}'],
      ["a reply padded with whitespace", '  {"candidates":[]}\n'],
    ])("passes %s", (_name, reply) => {
      expect(evaluateCanaryReply(reply)).toEqual({ passed: true });
    });

    it.each([
      ["an empty string", ""],
      ["only whitespace", "   "],
      ["plain text", "not json"],
      ["an empty object (what a healthy 0.5B model answered to a minimal prompt)", "{}"],
      ["a top-level array", "[]"],
      ["null", "null"],
      ["a JSON string", '"text"'],
      ["a null candidates property", '{"candidates":null}'],
      ["an object candidates property", '{"candidates":{}}'],
      ["a string candidates property", '{"candidates":"none"}'],
      ["valid JSON that ignores the requested shape", '{"category":"409"}'],
      ["a valid reply followed by a stray brace", '{"candidates":[]}\n}'],
      ["garbage text that begins like JSON", '{"Trader please twots, dez'],
    ])("rejects %s as an unusable reply", (_name, reply) => {
      expect(evaluateCanaryReply(reply)).toEqual({
        passed: false,
        failureCategory: "unusable-reply",
      });
    });

    it("never throws, whatever the reply", () => {
      for (const reply of ["\u0000", "{".repeat(10_000), "\uD800", '{"candidates":[]}'.repeat(500)]) {
        expect(() => evaluateCanaryReply(reply)).not.toThrow();
      }
    });
  });
});
