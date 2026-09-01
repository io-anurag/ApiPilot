import { describe, expect, it } from "vitest";
import type { TestScenario } from "@apipilot/shared-domain";
import { deduplicate } from "../../../src/testDesign/deduplicate";

function scenario(overrides: Partial<TestScenario>): TestScenario {
  return {
    id: overrides.id ?? Math.random().toString(36),
    operationPath: "/widgets",
    operationMethod: "POST",
    category: "invalid-type",
    request: {
      pathParameters: {},
      queryParameters: {},
      headers: {},
      body: { name: "a" },
    },
    assertions: [{ type: "status-code", expectedStatusCode: "400" }],
    provenance: {
      source: "RULE",
      rule: "rule-a",
      description: "d",
      duplicateOfRules: [],
    },
    ...overrides,
  };
}

describe("deduplicate", () => {
  it("merges scenarios with identical request+assertions within the same operation", () => {
    const a = scenario({
      id: "a",
      provenance: {
        source: "RULE",
        rule: "rule-a",
        description: "d",
        duplicateOfRules: [],
      },
    });
    const b = scenario({
      id: "b",
      provenance: {
        source: "RULE",
        rule: "rule-b",
        description: "d",
        duplicateOfRules: [],
      },
    });

    const result = deduplicate([a, b]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
    expect(result[0].provenance.duplicateOfRules).toEqual(["rule-b"]);
  });

  it("does not merge identical-looking requests across different operations", () => {
    const a = scenario({ id: "a", operationPath: "/widgets" });
    const b = scenario({ id: "b", operationPath: "/gadgets" });

    const result = deduplicate([a, b]);

    expect(result).toHaveLength(2);
  });

  it("does not merge requests that differ", () => {
    const a = scenario({
      id: "a",
      request: {
        pathParameters: {},
        queryParameters: {},
        headers: {},
        body: { name: "a" },
      },
    });
    const b = scenario({
      id: "b",
      request: {
        pathParameters: {},
        queryParameters: {},
        headers: {},
        body: { name: "b" },
      },
    });

    const result = deduplicate([a, b]);

    expect(result).toHaveLength(2);
  });

  it("retains deterministic scenarios first and records AI duplicate provenance", () => {
    const deterministic = scenario({
      id: "rule",
      provenance: {
        source: "RULE",
        rule: "rule-a",
        description: "d",
        duplicateOfRules: [],
      },
    });
    const ai = scenario({
      id: "ai",
      provenance: {
        source: "AI",
        aiCandidateId: "candidate-1",
        description: "semantic duplicate",
        duplicateOfRules: [],
        duplicateOfAICandidates: [],
        aiModel: "model",
        aiProvider: "mock",
        aiRationale: "same request",
        aiConfidence: 1,
        aiAssumptions: [],
      },
    });

    const result = deduplicate([deterministic, ai]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("rule");
    expect(result[0].provenance.duplicateOfAICandidates).toEqual(["candidate-1"]);
  });
});
