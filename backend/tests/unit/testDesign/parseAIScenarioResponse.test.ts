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
        'Here is the JSON you requested:\n{"responseVersion":5,"candidates":[]}\nHope this helps.',
      ),
    );

    expect(parsed).toEqual({ responseVersion: 5, candidates: [] });
  });

  it("finds the valid response after an incomplete JSON example in model prose", () => {
    const parsed = parseAIScenarioResponse(
      response(
        'Example: {"candidates":[\nActual response: {"responseVersion":5,"candidates":[]}. Done.',
      ),
    );

    expect(parsed).toEqual({ responseVersion: 5, candidates: [] });
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

  describe("omitted empty request maps (specs/013 T072)", () => {
    const candidate = (request: unknown) => ({
      candidateId: "c1",
      operationPath: "/orders/{orderId}",
      operationMethod: "GET",
      category: "invalid-format",
      request,
      assertions: [],
      rationale: "r",
      confidence: 0.5,
      assumptions: [],
    });
    const parse = (candidates: unknown[]) =>
      parseAIScenarioResponse(
        response(JSON.stringify({ responseVersion: 5, candidates })),
      ).candidates as { request: Record<string, unknown> }[];

    it("treats an omitted pathParameters, queryParameters or headers map as empty", () => {
      const [parsed] = parse([candidate({ pathParameters: { orderId: "x" } })]);
      expect(parsed.request).toEqual({
        pathParameters: { orderId: "x" },
        queryParameters: {},
        headers: {},
      });
    });

    it("treats a null map as empty, and a missing request body as still absent", () => {
      const [parsed] = parse([candidate({ pathParameters: null, queryParameters: { a: 1 } })]);
      expect(parsed.request).toEqual({
        pathParameters: {},
        queryParameters: { a: 1 },
        headers: {},
      });
      expect("body" in parsed.request).toBe(false);
    });

    it("leaves a map that is present but not an object alone, so it is still rejected as malformed", () => {
      const [parsed] = parse([candidate({ pathParameters: "x", queryParameters: [], headers: {} })]);
      expect(parsed.request.pathParameters).toBe("x");
      expect(parsed.request.queryParameters).toEqual([]);
    });

    it("never invents a request: a candidate without a request object is left as it was", () => {
      const [parsed] = parse([{ ...candidate(undefined), request: undefined }]);
      expect(parsed.request).toBeUndefined();
    });

    it("applies to a lone candidate the model emitted without the enclosing document", () => {
      const parsed = parseAIScenarioResponse(
        response(JSON.stringify(candidate({ pathParameters: { orderId: "x" } }))),
      );
      expect((parsed.candidates[0] as { request: Record<string, unknown> }).request.headers).toEqual({});
    });

    it("does not alter the provider's response object", () => {
      const raw = { responseVersion: 5, candidates: [candidate({ pathParameters: {} })] };
      const input = response(JSON.stringify(raw));
      const before = input.content;
      parseAIScenarioResponse(input);
      expect(input.content).toBe(before);
    });
  });
});
