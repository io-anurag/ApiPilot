import { describe, expect, it } from "vitest";
import type { FailureAnalysisConclusion, InferenceResponse } from "@apipilot/shared-domain";
import { parseFailureAnalysisResponse } from "../../../src/failureAnalysis/parseFailureAnalysisResponse";
import { FAILURE_ANALYSIS_RESPONSE_VERSION } from "../../../src/failureAnalysis/failureAnalysisPrompt";
import { modelAnswer } from "../../fixtures/failureAnalysis/fixtures";

const ids = new Set(["E1", "E2", "E3"]);

const environment: FailureAnalysisConclusion = {
  kind: "likely-cause",
  cause: "environment-issue",
  strength: "high",
  ruleId: "no-response",
  decidingEvidenceIds: ["E1"],
};
const insufficient: FailureAnalysisConclusion = { kind: "insufficient-evidence", reason: "no-rule-matched" };

function response(content: string): InferenceResponse {
  return {
    contractVersion: 1,
    requestId: "failure-test",
    status: "success",
    content,
    modelId: "test-model",
    provider: "local",
    durationMs: 1,
  };
}

function parse(content: string, conclusion: FailureAnalysisConclusion = environment) {
  return parseFailureAnalysisResponse(response(content), ids, conclusion);
}

const invalid = expect.objectContaining({ category: "INVALID_RESPONSE" });

describe("parseFailureAnalysisResponse v4 (research D16)", () => {
  it("accepts a valid explanation answer", () => {
    expect(parse(modelAnswer())).toEqual({
      summary: "The request failed and the recorded evidence points at where to look next.",
      investigationSteps: ["Check the database connection used by the service."],
      citedEvidenceIds: ["E1", "E2"],
    });
  });

  it("unwraps fenced or prose-wrapped JSON", () => {
    expect(parse(`\`\`\`json\n${modelAnswer()}\n\`\`\``).summary).toContain("recorded evidence");
    expect(parse(`Here is my explanation: ${modelAnswer()} Thanks.`).summary).toContain("recorded evidence");
  });

  it("treats a missing responseVersion as current and rejects a different one", () => {
    expect(parse(modelAnswer({ responseVersion: undefined })).citedEvidenceIds).toEqual(["E1", "E2"]);
    expect(() => parse(modelAnswer({ responseVersion: FAILURE_ANALYSIS_RESPONSE_VERSION + 1 }))).toThrow(invalid);
  });

  it.each([
    ["an empty summary", { summary: "  " }],
    ["a missing summary", { summary: undefined }],
    ["non-array steps", { steps: "check it" }],
    ["zero steps", { steps: [] }],
    ["steps written as objects (evaluation.md run 1)", { steps: [{ stepNumber: 1, description: "Check it." }] }],
    ["non-array evidence ids", { evidenceIds: "E1" }],
  ])("rejects %s as INVALID_RESPONSE", (_label, overrides) => {
    expect(() => parse(modelAnswer(overrides))).toThrow(invalid);
  });

  it("rejects unparseable and empty answers as INVALID_RESPONSE", () => {
    expect(() => parse("I think it was the network")).toThrow(invalid);
    expect(() => parse("")).toThrow(invalid);
  });

  it("drops cited ids that are not in the evidence, and rejects an answer citing none that are (FR-008)", () => {
    expect(parse(modelAnswer({ evidenceIds: ["E1", "E9", "E1"] })).citedEvidenceIds).toEqual(["E1"]);
    expect(() => parse(modelAnswer({ evidenceIds: ["E9"] }))).toThrow(invalid);
    expect(() => parse(modelAnswer({ evidenceIds: [] }))).toThrow(invalid);
  });

  it("truncates the summary at a word boundary and caps steps", () => {
    const parsed = parse(
      modelAnswer({
        summary: `${"word ".repeat(120)}end`,
        steps: ["a", "b", "c", "d", "x".repeat(300)],
      }),
    );
    expect(parsed.summary.length).toBeLessThanOrEqual(400);
    expect(parsed.summary.endsWith("…")).toBe(true);
    expect(parsed.investigationSteps).toEqual(["a", "b", "c"]);
  });

  describe("contradiction check (FR-008)", () => {
    it("accepts text naming the rule-decided cause", () => {
      expect(parse(modelAnswer({ summary: "This looks like an environment issue: nothing answered." })).summary).toContain(
        "environment issue",
      );
    });

    it.each([
      ["a summary naming a specification mismatch", { summary: "This is a specification mismatch." }],
      ["a summary using another cause's key", { summary: "Classified as downstream-service-issue." }],
      ["a step naming a downstream service", { steps: ["Check the downstream service first."] }],
      ["a negated mention of another cause", { summary: "It is not a specification mismatch." }],
    ])("rejects %s under an environment-issue conclusion", (_label, overrides) => {
      expect(() => parse(modelAnswer(overrides))).toThrow(invalid);
    });

    it("rejects any cause phrase when no rule matched", () => {
      expect(() => parse(modelAnswer({ summary: "Probably an environment issue." }), insufficient)).toThrow(invalid);
      expect(parse(modelAnswer(), insufficient).summary).toContain("recorded evidence");
    });

    it("matches cause phrases case-insensitively", () => {
      expect(() => parse(modelAnswer({ summary: "SPECIFICATION MISMATCH suspected." }))).toThrow(invalid);
    });
  });

  it("rethrows a provider error with its category", () => {
    expect(() =>
      parseFailureAnalysisResponse(
        { ...response(""), status: "error", errorCategory: "TIMEOUT", content: undefined },
        ids,
        environment,
      ),
    ).toThrow(expect.objectContaining({ category: "TIMEOUT" }));
  });
});
