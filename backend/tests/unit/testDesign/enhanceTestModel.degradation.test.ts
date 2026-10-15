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
    // An undocumented status code costs the candidate its assertion, not its place
    // (specs/005 amendment 2026-10-15).
    expect(result.aiCandidates.added.map((item) => item.candidate.candidateId)).toEqual([
      "valid-1",
      "invented-status",
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
    ]);
    expect(result.aiCandidates.nonExecutable.every((i) => i.findings.every((f) => !f.executable)))
      .toBe(true);
  });

  describe("an undocumented status code removes the assertion, not the candidate (specs/005 amendment 2026-10-15)", () => {
    const inventedStatus = { type: "status-code", expectedStatusCode: "418" } as const;
    const documentedStatus = validCandidate.assertions[0];

    async function enhance(candidates: unknown[]) {
      return enhanceTestModel(
        aiScenarioApiModel,
        baseline,
        providerWith(respond(candidatesResponse(candidates))),
      );
    }

    it("keeps the candidate, drops only the undocumented assertion, and records it on the result and provenance", async () => {
      const result = await enhance([
        { ...validCandidate, assertions: [documentedStatus, inventedStatus] },
      ]);

      expect(result.aiCandidates.nonExecutable).toEqual([]);
      expect(result.aiCandidates.added).toHaveLength(1);
      const [added] = result.aiCandidates.added;
      expect(added.candidate.assertions).toEqual([documentedStatus]);
      expect(added.strippedAssertions).toEqual([
        { assertion: inventedStatus, reason: "undocumented-status-code" },
      ]);
      const scenario = result.enhancedTestModel.scenarios.find((s) => s.id === added.scenarioId);
      expect(scenario?.assertions).toEqual([documentedStatus]);
      expect(scenario?.provenance).toMatchObject({
        source: "AI",
        aiStrippedAssertions: [
          { assertion: inventedStatus, reason: "undocumented-status-code" },
        ],
      });
    });

    it("keeps a candidate whose every assertion was removed, with an empty assertion set", async () => {
      const result = await enhance([{ ...validCandidate, assertions: [inventedStatus] }]);

      expect(result.aiCandidates.added).toHaveLength(1);
      expect(result.aiCandidates.added[0].candidate.assertions).toEqual([]);
      const scenario = result.enhancedTestModel.scenarios.find(
        (s) => s.id === result.aiCandidates.added[0].scenarioId,
      );
      expect(scenario?.assertions).toEqual([]);
    });

    it("removes a schema assertion carried on the undocumented code", async () => {
      const result = await enhance([
        {
          ...validCandidate,
          assertions: [
            { type: "schema-conformance", expectedStatusCode: "418", expectedSchema: { type: "object", required: [], properties: {} } },
          ],
        },
      ]);

      expect(result.aiCandidates.nonExecutable).toEqual([]);
      expect(result.aiCandidates.added[0].candidate.assertions).toEqual([]);
      expect(result.aiCandidates.added[0].strippedAssertions).toHaveLength(1);
    });

    it("still makes a schema mismatch under a documented code non-executable", async () => {
      const result = await enhance([
        {
          ...validCandidate,
          assertions: [
            { type: "schema-conformance", expectedStatusCode: "409", expectedSchema: { type: "object", required: ["invented"], properties: {} } },
          ],
        },
      ]);

      expect(result.aiCandidates.added).toEqual([]);
      expect(result.aiCandidates.nonExecutable[0].findings.map((f) => f.code)).toEqual([
        "schema-not-found",
      ]);
    });

    it("does not keep a candidate merely because its assertion was also removed", async () => {
      const result = await enhance([
        { ...validCandidate, targetField: "nope", assertions: [inventedStatus] },
      ]);

      expect(result.aiCandidates.added).toEqual([]);
      expect(result.aiCandidates.nonExecutable).toHaveLength(1);
      const [item] = result.aiCandidates.nonExecutable;
      // Reported as the model sent it, with every finding it had.
      expect(item.candidate.assertions).toEqual([inventedStatus]);
      expect(item.findings.map((f) => f.code).sort()).toEqual([
        "field-not-found",
        "undocumented-status-code",
      ]);
    });

    it("deduplicates on the retained assertions, so candidates differing only in a removed assertion are equivalent", async () => {
      const result = await enhance([
        { ...validCandidate, candidateId: "a", assertions: [documentedStatus] },
        { ...validCandidate, candidateId: "b", assertions: [documentedStatus, inventedStatus] },
      ]);

      expect(result.aiCandidates.added.map((item) => item.candidate.candidateId)).toEqual(["a"]);
      expect(result.aiCandidates.deduplicated.map((item) => item.candidate.candidateId)).toEqual(["b"]);
    });

    it("produces the same result for the same provider output (FR-013)", async () => {
      const candidates = [{ ...validCandidate, assertions: [inventedStatus, documentedStatus] }];
      expect(await enhance(candidates)).toEqual(await enhance(candidates));
    });

    it("leaves a candidate with only documented assertions free of stripping metadata", async () => {
      const result = await enhance([validCandidate]);

      expect(result.aiCandidates.added[0]).not.toHaveProperty("strippedAssertions");
      const scenario = result.enhancedTestModel.scenarios.find(
        (s) => s.id === result.aiCandidates.added[0].scenarioId,
      );
      expect(scenario?.provenance).not.toHaveProperty("aiStrippedAssertions");
    });
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
