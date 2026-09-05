import { describe, expect, it } from "vitest";
import type { InferenceResponse } from "@apipilot/shared-domain";
import {
  aiScenarioApiModel,
  aiScenarioBaseline,
} from "../../fixtures/testDesign/aiScenarioDesignerFixtures";
import {
  AI_SCENARIO_MAX_OUTPUT_TOKENS,
  buildAIScenarioRequest,
} from "../../../src/testDesign/aiScenarioPrompt";
import { parseAIScenarioResponse } from "../../../src/testDesign/parseAIScenarioResponse";

describe("AI scenario prompt and response contract", () => {
  it("constructs a versioned JSON request from normalized models", () => {
    const request = buildAIScenarioRequest(
      "request-1",
      aiScenarioApiModel,
      aiScenarioBaseline,
    );
    const prompt = JSON.parse(request.input) as Record<string, unknown>;

    expect(request.expectedOutputFormat).toBe("json");
    // A generous-enough bound that a multi-field candidate (request, assertions, rationale,
    // assumptions) doesn't get truncated mid-JSON — LocalProvider's own unset-default (256)
    // was enough for at most one small candidate and always failed strict JSON parsing above
    // that (regression: AI enhancement failing with INVALID_RESPONSE on every real request).
    expect(request.maxOutputTokens).toBe(AI_SCENARIO_MAX_OUTPUT_TOKENS);
    expect(prompt.responseVersion).toBe(1);
    expect(prompt.apiModel).toEqual(aiScenarioApiModel);
    expect(prompt.deterministicTestModel).toEqual(aiScenarioBaseline);
  });

  it("parses only the supported structured response shape", () => {
    const response: InferenceResponse = {
      contractVersion: 1,
      requestId: "request-1",
      status: "success",
      content: JSON.stringify({ responseVersion: 1, candidates: [] }),
      modelId: "model-1",
      provider: "mock",
      durationMs: 0,
    };

    expect(parseAIScenarioResponse(response)).toEqual({
      responseVersion: 1,
      candidates: [],
    });
  });

  it("does not include raw provider content in malformed-response errors", () => {
    const response: InferenceResponse = {
      contractVersion: 1,
      requestId: "request-1",
      status: "success",
      content: "not-json-with-sensitive-content",
      modelId: "model-1",
      provider: "mock",
      durationMs: 0,
    };

    expect(() => parseAIScenarioResponse(response)).toThrow("valid JSON");
    expect(() => parseAIScenarioResponse(response)).not.toThrow("sensitive-content");
  });
});
