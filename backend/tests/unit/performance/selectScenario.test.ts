import type { TestScenario } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { selectPerformanceScenario } from "../../../src/performance/plan/selectScenario";

/** FR-002, FR-003, FR-005 (research D4, tasks T023). */

function scenario(id: string, overrides: Partial<TestScenario> = {}, source: "RULE" | "AI" = "RULE"): TestScenario {
  const provenance =
    source === "RULE"
      ? { source: "RULE" as const, rule: "positive", description: id, duplicateOfRules: [] }
      : {
          source: "AI" as const,
          description: id,
          duplicateOfRules: [],
          duplicateOfAICandidates: [],
          aiModel: "m",
          aiProvider: "mock" as const,
          aiRationale: "r",
          aiConfidence: 0.9,
          aiAssumptions: [],
        };
  return {
    id,
    operationPath: "/orders",
    operationMethod: "POST",
    category: "positive",
    request: { pathParameters: {}, queryParameters: {}, headers: {} },
    assertions: [],
    provenance,
    ...overrides,
  };
}

const operation = { path: "/orders", method: "post" };

describe("selectPerformanceScenario", () => {
  it("never uses a negative scenario, and omits an operation that has no positive one", () => {
    const negative = scenario("a", { category: "missing-required" });
    expect(selectPerformanceScenario([negative], operation)).toEqual({ omitted: "no-positive-scenario" });
  });

  it("uses the only positive scenario", () => {
    const result = selectPerformanceScenario([scenario("x"), scenario("n", { category: "invalid-type" })], operation);
    expect(result).toMatchObject({ scenario: { id: "x" }, reason: "only-positive", tieBrokenByLowestId: false });
  });

  it("prefers a rule-generated scenario over an AI-enhanced one, whatever the ids", () => {
    const result = selectPerformanceScenario([scenario("a-ai", {}, "AI"), scenario("z-rule")], operation);
    expect(result).toMatchObject({ scenario: { id: "z-rule" }, reason: "rule-generated", tieBrokenByLowestId: false });
  });

  it("takes an AI-enhanced scenario only when no rule-generated one exists", () => {
    const result = selectPerformanceScenario([scenario("b", {}, "AI"), scenario("a", {}, "AI")], operation);
    expect(result).toMatchObject({ scenario: { id: "a" }, reason: "ai-enhanced-no-rule-alternative", tieBrokenByLowestId: true });
  });

  it("breaks ties by code-unit order, not locale order", () => {
    // localeCompare would put "a" before "B"; code units put "B" (0x42) first.
    const result = selectPerformanceScenario([scenario("a"), scenario("B")], operation);
    expect(result).toMatchObject({ scenario: { id: "B" }, tieBrokenByLowestId: true });
  });

  it("matches the operation by path and method only", () => {
    const other = scenario("other", { operationPath: "/orders/{id}", operationMethod: "GET" });
    expect(selectPerformanceScenario([other], operation)).toEqual({ omitted: "no-positive-scenario" });
  });
});
