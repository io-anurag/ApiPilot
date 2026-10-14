import { describe, expect, it } from "vitest";
import {
  AI_SCENARIO_MAX_OUTPUT_TOKENS,
  AI_SCENARIO_RESPONSE_VERSION,
} from "../../../../src/testDesign/aiScenarioPrompt";
import {
  ENHANCEMENT_WORKLOADS,
  WORKLOAD_SET_ID,
  buildEnhancementWorkloads,
  type BenchmarkWorkload,
} from "../../../../src/ai/benchmark/workloads";

/**
 * The benchmark must measure the task the product actually runs (specs/013-ai-enhancement-viability
 * T025, constitution XXII): contract-shaped prompts requesting structured scenario candidates, with
 * success judged by the same validation the enhancement pipeline applies.
 */
describe("enhancement benchmark workloads", () => {
  it("identifies the enhancement workload set, distinct from the generic AP-004 set", () => {
    expect(WORKLOAD_SET_ID).toBe("ap013-enhancement-v1");
    expect(WORKLOAD_SET_ID).not.toBe("ap004-representative-v1");
  });

  it("provides several uniquely named workloads", () => {
    expect(ENHANCEMENT_WORKLOADS.length).toBeGreaterThanOrEqual(3);
    const ids = ENHANCEMENT_WORKLOADS.map((workload) => workload.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses the real enhancement request: JSON output with the production output allowance", () => {
    for (const workload of ENHANCEMENT_WORKLOADS) {
      expect(workload.expectedOutputFormat).toBe("json");
      expect(workload.maxOutputTokens).toBe(AI_SCENARIO_MAX_OUTPUT_TOKENS);
    }
  });

  it("carries a contract-shaped prompt naming real operations", () => {
    for (const workload of ENHANCEMENT_WORKLOADS) {
      const prompt = JSON.parse(workload.input) as { operations?: { path: string }[] };
      expect(prompt.operations?.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic: building the set twice yields identical prompts", () => {
    expect(buildEnhancementWorkloads().map((w) => w.input)).toEqual(
      ENHANCEMENT_WORKLOADS.map((w) => w.input),
    );
  });

  describe("usability judgement", () => {
    const workload = ENHANCEMENT_WORKLOADS.find(
      (w) => w.id === "create-account",
    ) as BenchmarkWorkload;

    function candidate(overrides: Record<string, unknown> = {}) {
      return {
        candidateId: "c-1",
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
        ...overrides,
      };
    }
    const reply = (candidates: unknown[]) => JSON.stringify({ responseVersion: AI_SCENARIO_RESPONSE_VERSION, candidates });

    it("accepts a reply with at least one candidate the pipeline would retain", () => {
      expect(workload.isUsable(reply([candidate()]))).toBe(true);
    });

    it("still accepts it when other candidates are invalid, as the pipeline keeps the valid ones", () => {
      expect(
        workload.isUsable(
          reply([candidate({ candidateId: "bad", operationPath: "/nope" }), candidate()]),
        ),
      ).toBe(true);
    });

    it("rejects a reply whose only candidates reference things the specification lacks", () => {
      expect(workload.isUsable(reply([candidate({ targetField: "missing" })]))).toBe(false);
    });

    it("rejects an empty candidate list, so a model that always answers 'none' cannot win", () => {
      expect(workload.isUsable(reply([]))).toBe(false);
    });

    it.each([
      ["not JSON", "I think you should test the email field."],
      [
        "JSON with unquoted keys, the failure observed on the real model",
        '{ candidates: [ { candidateId: "c" } ] }',
      ],
      ["JSON of the wrong shape", JSON.stringify({ name: "x", count: 1 })],
      ["empty content", ""],
    ])("rejects %s", (_name, content) => {
      expect(workload.isUsable(content)).toBe(false);
    });

    it("rejects a reply declaring an unsupported response version", () => {
      expect(
        workload.isUsable(JSON.stringify({ responseVersion: 99, candidates: [candidate()] })),
      ).toBe(false);
    });

    it("rejects missing content", () => {
      expect(workload.isUsable(undefined)).toBe(false);
    });
  });
});
