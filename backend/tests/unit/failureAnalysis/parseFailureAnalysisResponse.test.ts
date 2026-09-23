import { describe, expect, it } from "vitest";
import type { InferenceResponse } from "@apipilot/shared-domain";
import { parseFailureAnalysisResponse } from "../../../src/failureAnalysis/parseFailureAnalysisResponse";
import { FAILURE_ANALYSIS_RESPONSE_VERSION } from "../../../src/failureAnalysis/failureAnalysisPrompt";
import { modelAnswer } from "../../fixtures/failureAnalysis/fixtures";

const ids = new Set(["E1", "E2", "E3"]);

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

function parse(content: string) {
  return parseFailureAnalysisResponse(response(content), ids);
}

describe("parseFailureAnalysisResponse (research D7)", () => {
  it("accepts a valid likely-cause answer", () => {
    expect(parse(modelAnswer())).toEqual({
      conclusion: { kind: "likely-cause", cause: "environment-issue", confidence: 0.72 },
      summary: "The service returned 500 because a dependency was unavailable.",
      investigationSteps: ["Check the database connection used by the service."],
      citedEvidenceIds: ["E1", "E2"],
    });
  });

  it("unwraps fenced or prose-wrapped JSON", () => {
    expect(parse(`\`\`\`json\n${modelAnswer()}\n\`\`\``).conclusion.kind).toBe("likely-cause");
    expect(parse(`Here is my analysis: ${modelAnswer()} Thanks.`).conclusion.kind).toBe("likely-cause");
  });

  it("treats a missing responseVersion as current and rejects a different one", () => {
    expect(parse(modelAnswer({ responseVersion: undefined })).conclusion.kind).toBe("likely-cause");
    expect(() => parse(modelAnswer({ responseVersion: FAILURE_ANALYSIS_RESPONSE_VERSION + 1 }))).toThrow(
      expect.objectContaining({ category: "INVALID_RESPONSE" }),
    );
  });

  it.each([
    ["an unknown cause", { cause: "gremlins" }],
    ["confidence above 1", { confidence: 1.2 }],
    ["confidence below 0", { confidence: -0.1 }],
    ["an empty summary", { summary: "  " }],
    ["non-array steps", { steps: "check it" }],
    ["zero steps with a cause", { steps: [] }],
    ["non-array evidence ids", { evidenceIds: "E1" }],
  ])("rejects %s as INVALID_RESPONSE", (_label, overrides) => {
    expect(() => parse(modelAnswer(overrides))).toThrow(expect.objectContaining({ category: "INVALID_RESPONSE" }));
  });

  it("rejects unparseable and empty answers as INVALID_RESPONSE", () => {
    expect(() => parse("I think it was the network")).toThrow(expect.objectContaining({ category: "INVALID_RESPONSE" }));
    expect(() => parse("")).toThrow(expect.objectContaining({ category: "INVALID_RESPONSE" }));
  });

  it("accepts zero steps for insufficient-evidence", () => {
    expect(parse(modelAnswer({ cause: "insufficient-evidence", steps: [] })).investigationSteps).toEqual([]);
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

  it("drops cited ids that are not in the evidence", () => {
    expect(parse(modelAnswer({ evidenceIds: ["E1", "E9", "E1"] })).citedEvidenceIds).toEqual(["E1"]);
  });

  it("applies the conclusion rules in order", () => {
    expect(parse(modelAnswer({ cause: "insufficient-evidence" })).conclusion).toEqual({
      kind: "insufficient-evidence",
      reason: "model-reported",
      confidence: 0.72,
    });
    expect(parse(modelAnswer({ confidence: 0.49 })).conclusion).toEqual({
      kind: "insufficient-evidence",
      reason: "below-confidence-threshold",
      confidence: 0.49,
    });
    expect(parse(modelAnswer({ confidence: 0.5 })).conclusion).toEqual({
      kind: "likely-cause",
      cause: "environment-issue",
      confidence: 0.5,
    });
    expect(parse(modelAnswer({ evidenceIds: ["E9"] })).conclusion).toEqual({
      kind: "insufficient-evidence",
      reason: "no-valid-evidence-cited",
      confidence: 0.72,
    });
  });

  it("never carries the rejected cause into an insufficient-evidence conclusion", () => {
    const conclusion = parse(modelAnswer({ confidence: 0.2, cause: "specification-mismatch" })).conclusion;
    expect(JSON.stringify(conclusion)).not.toContain("specification-mismatch");
  });

  it("rethrows a provider error with its category", () => {
    expect(() =>
      parseFailureAnalysisResponse(
        { ...response(""), status: "error", errorCategory: "TIMEOUT", content: undefined },
        ids,
      ),
    ).toThrow(expect.objectContaining({ category: "TIMEOUT" }));
  });
});
