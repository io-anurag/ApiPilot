import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AIProvider,
  AIScenarioCandidate,
  InferenceResponse,
} from "@apipilot/shared-domain";
import { AIProviderError } from "../../../src/ai/errors";
import { enhanceTestModel } from "../../../src/testDesign/enhanceTestModel";
import { generateTestModel } from "../../../src/testDesign/generateTestModel";
import { aiScenarioApiModel } from "../../fixtures/testDesign/aiScenarioDesignerFixtures";

/**
 * Degradation coverage for specs/005-ai-test-scenario-designer FR-007, FR-011, FR-012, FR-015 and
 * US4/AC1-AC3. Handling is per candidate: an invalid candidate is rejected or marked non-executable
 * while valid ones in the same response are retained, and the deterministic baseline is always
 * returned unchanged (reaffirmed over an all-or-nothing policy for T044).
 */

const baseline = generateTestModel(aiScenarioApiModel);

const validCandidate: AIScenarioCandidate = {
  candidateId: "valid-1",
  operationPath: "/accounts",
  operationMethod: "POST",
  category: "invalid-format",
  targetLocation: "body",
  targetField: "email",
  request: { pathParameters: {}, queryParameters: {}, headers: {}, body: { email: "bad" } },
  assertions: [{ type: "status-code", expectedStatusCode: "409" }],
  rationale: "Exercise a malformed email value.",
  confidence: 0.8,
  assumptions: [],
};

function respond(content: string): AIProvider["infer"] {
  return async (request): Promise<InferenceResponse> => ({
    contractVersion: 1,
    requestId: request.requestId,
    status: "success",
    content,
    modelId: "degradation-model",
    provider: "mock",
    durationMs: 0,
  });
}

function providerWith(infer: AIProvider["infer"]): AIProvider {
  return {
    mode: "mock",
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    getInputBudget: async () => undefined,
    infer,
  };
}

const candidatesResponse = (candidates: unknown[]): string =>
  JSON.stringify({ responseVersion: 1, candidates });

const noOutcomes = { added: [], deduplicated: [], rejected: [], nonExecutable: [] };

afterEach(() => vi.restoreAllMocks());

describe("enhanceTestModel degradation (specs/005 FR-015, US4/AC1-AC2)", () => {
  it("has a non-empty deterministic baseline to preserve", () => {
    expect(baseline.scenarios.length).toBeGreaterThan(0);
  });

  it.each([
    [
      "the provider is unavailable",
      async () => ({
        contractVersion: 1 as const,
        requestId: "r",
        status: "error" as const,
        errorCategory: "PROVIDER_UNAVAILABLE" as const,
        errorMessage: "internal detail",
        modelId: "m",
        provider: "mock" as const,
        durationMs: 0,
      }),
      "unavailable",
    ],
    [
      "the provider times out",
      async () => ({
        contractVersion: 1 as const,
        requestId: "r",
        status: "error" as const,
        errorCategory: "TIMEOUT" as const,
        errorMessage: "internal detail",
        modelId: "m",
        provider: "mock" as const,
        durationMs: 0,
      }),
      "timeout",
    ],
    [
      "the provider throws as unavailable",
      async () => {
        throw new AIProviderError("PROVIDER_UNAVAILABLE", "internal detail");
      },
      "unavailable",
    ],
    ["the content is not JSON", respond("this is not json"), "invalid-response"],
    ["the content is empty", respond(""), "invalid-response"],
    [
      "the response version is unsupported",
      respond(JSON.stringify({ responseVersion: 99, candidates: [] })),
      "invalid-response",
    ],
    [
      "a candidate is not an object",
      respond(candidatesResponse([1])),
      "invalid-response",
    ],
  ])(
    "returns the baseline unchanged with no AI candidates when %s",
    async (_name, infer, outcome) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const result = await enhanceTestModel(
        aiScenarioApiModel,
        baseline,
        providerWith(infer as AIProvider["infer"]),
      );

      expect(result.aiProviderOutcome).toBe(outcome);
      expect(result.enhancedTestModel).toEqual(baseline);
      expect(result.aiCandidates).toEqual(noOutcomes);
      expect(result.aiErrorCategory).toBeDefined();
      expect(result.aiErrorMessage).toContain("deterministic scenarios were preserved");
      expect(result.aiErrorMessage).not.toContain("internal detail");
    },
  );
});

describe("enhanceTestModel partially valid responses (specs/005 FR-007, FR-011, FR-012, US4/AC2)", () => {
  it("keeps the valid candidate and reports every other candidate under its own outcome", async () => {
    const result = await enhanceTestModel(
      aiScenarioApiModel,
      baseline,
      providerWith(
        respond(
          candidatesResponse([
            validCandidate,
            { ...validCandidate, candidateId: "bad-confidence", confidence: 3 },
            { ...validCandidate, candidateId: undefined },
            { ...validCandidate, candidateId: "valid-1", rationale: "duplicate id" },
            { ...validCandidate, candidateId: "unknown-field", targetField: "nope" },
            { ...validCandidate, candidateId: "unknown-op", operationPath: "/missing" },
            {
              ...validCandidate,
              candidateId: "invented-status",
              assertions: [{ type: "status-code", expectedStatusCode: "418" }],
            },
          ]),
        ),
      ),
    );

    expect(result.aiProviderOutcome).toBe("success");
    expect(result.aiCandidates.added.map((item) => item.candidate.candidateId)).toEqual([
      "valid-1",
    ]);
    expect(
      result.aiCandidates.rejected.map((item) => item.findings.map((f) => f.code)),
    ).toEqual([["low-confidence"], ["invalid-candidate-id"], ["duplicate"]]);
    expect(
      result.aiCandidates.nonExecutable.map((item) => [
        item.candidate.candidateId,
        item.findings.map((f) => f.code),
      ]),
    ).toEqual([
      ["unknown-field", ["field-not-found"]],
      ["unknown-op", ["operation-not-found"]],
      ["invented-status", ["undocumented-status-code"]],
    ]);
    expect(result.aiCandidates.nonExecutable.every((i) => i.findings.every((f) => !f.executable)))
      .toBe(true);
  });

  it("returns every deterministic scenario unchanged and in order, plus only the valid candidate", async () => {
    const result = await enhanceTestModel(
      aiScenarioApiModel,
      baseline,
      providerWith(
        respond(
          candidatesResponse([
            { ...validCandidate, candidateId: "unknown-op", operationPath: "/missing" },
            validCandidate,
          ]),
        ),
      ),
    );

    const scenarios = result.enhancedTestModel.scenarios;
    expect(scenarios.slice(0, baseline.scenarios.length)).toEqual(baseline.scenarios);
    expect(scenarios).toHaveLength(baseline.scenarios.length + 1);
    expect(scenarios[scenarios.length - 1].provenance.source).toBe("AI");
  });

  it("adds nothing when every candidate is invalid, and still reports success with the baseline intact", async () => {
    const result = await enhanceTestModel(
      aiScenarioApiModel,
      baseline,
      providerWith(
        respond(
          candidatesResponse([
            { ...validCandidate, candidateId: "unknown-op", operationPath: "/missing" },
            { ...validCandidate, candidateId: "bad-category", category: "business-rule" },
          ]),
        ),
      ),
    );

    expect(result.aiProviderOutcome).toBe("success");
    expect(result.enhancedTestModel).toEqual(baseline);
    expect(result.aiCandidates.added).toEqual([]);
    expect(result.aiCandidates.rejected).toHaveLength(1);
    expect(result.aiCandidates.nonExecutable).toHaveLength(1);
  });

  it("adds nothing for a valid response that proposes no candidates (US4/AC3)", async () => {
    const result = await enhanceTestModel(
      aiScenarioApiModel,
      baseline,
      providerWith(respond(candidatesResponse([]))),
    );

    expect(result.aiProviderOutcome).toBe("success");
    expect(result.enhancedTestModel).toEqual(baseline);
    expect(result.aiCandidates).toEqual(noOutcomes);
  });
});
