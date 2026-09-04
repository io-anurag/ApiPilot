import { describe, expect, it } from "vitest";
import type { InferenceResponse } from "@apipilot/shared-domain";
import { parseAIDependencyResponse } from "../../../src/dependencies/parseAIDependencyResponse";

function response(content: string): InferenceResponse {
  return {
    contractVersion: 1,
    requestId: "dep-1",
    status: "success",
    content,
    modelId: "test-model",
    provider: "mock",
    durationMs: 0,
  };
}

describe("parseAIDependencyResponse", () => {
  it("parses a valid JSON candidate list", () => {
    const parsed = parseAIDependencyResponse(
      response(
        JSON.stringify({
          responseVersion: 1,
          candidates: [
            {
              candidateId: "c1",
              producer: { operationPath: "/accounts", operationMethod: "POST", field: "accountId" },
              consumer: {
                operationPath: "/transfers",
                operationMethod: "POST",
                field: "accountRef",
                location: "body",
              },
              rationale: "semantically related",
              confidence: 0.9,
            },
          ],
        }),
      ),
    );
    expect(parsed.candidates).toHaveLength(1);
  });

  it("throws on malformed JSON rather than crashing silently", () => {
    expect(() => parseAIDependencyResponse(response("not json"))).toThrow();
  });

  it("throws when the payload is not the expected shape (missing candidates array)", () => {
    expect(() => parseAIDependencyResponse(response(JSON.stringify({ responseVersion: 1 })))).toThrow();
  });

  it("throws when a provider error response is passed through", () => {
    const errorResponse: InferenceResponse = {
      contractVersion: 1,
      requestId: "dep-1",
      status: "error",
      errorCategory: "TIMEOUT",
      errorMessage: "timed out",
      modelId: "test-model",
      provider: "mock",
      durationMs: 0,
    };
    expect(() => parseAIDependencyResponse(errorResponse)).toThrow();
  });
});
