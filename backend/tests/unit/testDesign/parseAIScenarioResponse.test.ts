import { describe, expect, it } from "vitest";
import { parseAIScenarioResponse } from "../../../src/testDesign/parseAIScenarioResponse";
import type { InferenceResponse } from "@apipilot/shared-domain";

function response(content: string): InferenceResponse {
  return {
    contractVersion: 1,
    requestId: "request-1",
    status: "success",
    content,
    modelId: "test-model",
    provider: "mock",
    durationMs: 1,
  };
}

describe("parseAIScenarioResponse", () => {
  it("accepts a valid candidate document surrounded by model prose", () => {
    const parsed = parseAIScenarioResponse(
      response(
        'Here is the JSON you requested:\n{"responseVersion":3,"candidates":[]}\nHope this helps.',
      ),
    );

    expect(parsed).toEqual({ responseVersion: 3, candidates: [] });
  });

  it("finds the valid response after an incomplete JSON example in model prose", () => {
    const parsed = parseAIScenarioResponse(
      response(
        'Example: {"candidates":[\nActual response: {"responseVersion":3,"candidates":[]}. Done.',
      ),
    );

    expect(parsed).toEqual({ responseVersion: 3, candidates: [] });
  });

  it("does not accept an incomplete JSON object hidden in surrounding prose", () => {
    expect(() =>
      parseAIScenarioResponse(response('I could not finish: {"candidates":[')),
    ).toThrow("AI response was not valid JSON");
  });

  it("normalizes a direct candidate object from a small local model", () => {
    const parsed = parseAIScenarioResponse(
      response(
        JSON.stringify({
          candidateId: "candidate-1",
          operationPath: "/items",
          operationMethod: "GET",
          category: "positive",
          request: { pathParameters: {}, queryParameters: {}, headers: {} },
          assertions: [],
          rationale: "Checks the documented operation.",
          confidence: 0.8,
          assumptions: [],
        }),
      ),
    );

    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]).toMatchObject({ candidateId: "candidate-1" });
  });

  it("normalizes an array of candidate objects from a small local model", () => {
    const parsed = parseAIScenarioResponse(
      response(
        JSON.stringify([
          {
            candidateId: "candidate-1",
            operationPath: "/items",
            operationMethod: "GET",
            category: "positive",
            request: { pathParameters: {}, queryParameters: {}, headers: {} },
            assertions: [],
            rationale: "Checks the documented operation.",
            confidence: 0.8,
            assumptions: [],
          },
        ]),
      ),
    );

    expect(parsed.candidates).toHaveLength(1);
  });
});
