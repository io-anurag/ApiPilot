import { describe, expect, it } from "vitest";
import type {
  AIProvider,
  BenchmarkCandidateResult,
  InferenceRequest,
} from "@apipilot/shared-domain";
import { evaluateCandidate, selectBest } from "../../../../src/ai/benchmark/evaluateCandidate";
import type { BenchmarkWorkload } from "../../../../src/ai/benchmark/workloads";

function workload(id: string, usable: (content: string | undefined) => boolean): BenchmarkWorkload {
  return {
    id,
    input: `input-${id}`,
    expectedOutputFormat: "json",
    maxOutputTokens: 123,
    isUsable: usable,
  };
}

function scriptedProvider(
  replies: Record<string, string | undefined>,
  seen: InferenceRequest[] = [],
): AIProvider {
  return {
    mode: "mock",
    getReadiness: () => ({
      state: "ready",
      acceleratorRequested: false,
      acceleratorActive: false,
      updatedAt: new Date(0).toISOString(),
    }),
    getInputBudget: async () => undefined,
    infer: async (request) => {
      seen.push(request);
      const content = replies[request.input];
      return {
        contractVersion: 1,
        requestId: request.requestId,
        status: content === undefined ? "error" : "success",
        content,
        errorCategory: content === undefined ? "TIMEOUT" : undefined,
        modelId: "m",
        provider: "mock",
        durationMs: 0,
      };
    },
  };
}

describe("evaluateCandidate", () => {
  const workloads = [workload("a", (c) => c === "ok"), workload("b", (c) => c === "ok")];

  it("records the dtype the candidate was run with as its own field", async () => {
    const result = await evaluateCandidate(
      { modelId: "model-x", dtype: "q8" },
      scriptedProvider({ "input-a": "ok", "input-b": "ok" }),
      workloads,
      () => 100,
    );

    expect(result).toMatchObject({
      modelId: "model-x",
      dtype: "q8",
      structuredOutputSuccessRate: 1,
    });
    expect(result.notes).toBeUndefined();
  });

  it("scores the fraction of workloads judged usable, counting a provider error as a failure", async () => {
    const result = await evaluateCandidate(
      { modelId: "model-x", dtype: "fp32" },
      scriptedProvider({ "input-a": "ok", "input-b": undefined }),
      workloads,
      () => 100,
    );
    expect(result.structuredOutputSuccessRate).toBe(0.5);
  });

  it("sends each workload's own prompt, output format and output allowance to the provider", async () => {
    const seen: InferenceRequest[] = [];
    await evaluateCandidate(
      { modelId: "model-x", dtype: "fp32" },
      scriptedProvider({ "input-a": "ok", "input-b": "ok" }, seen),
      workloads,
      () => 100,
    );
    expect(seen.map((r) => [r.input, r.expectedOutputFormat, r.maxOutputTokens])).toEqual([
      ["input-a", "json", 123],
      ["input-b", "json", 123],
    ]);
  });

  it("reports the peak of the sampled memory and a non-negative average latency", async () => {
    const samples = [100, 300, 200];
    const result = await evaluateCandidate(
      { modelId: "model-x", dtype: "fp32" },
      scriptedProvider({ "input-a": "ok", "input-b": "ok" }),
      workloads,
      () => samples.shift() ?? 0,
    );
    expect(result.peakMemoryMb).toBe(300);
    expect(result.averageLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("keeps two dtypes of the same model apart as separate results", async () => {
    const fp32 = await evaluateCandidate(
      { modelId: "m", dtype: "fp32" },
      scriptedProvider({ "input-a": "ok", "input-b": "ok" }),
      workloads,
      () => 1,
    );
    const q8 = await evaluateCandidate(
      { modelId: "m", dtype: "q8" },
      scriptedProvider({}),
      workloads,
      () => 1,
    );
    expect([fp32.dtype, q8.dtype]).toEqual(["fp32", "q8"]);
    expect(fp32.structuredOutputSuccessRate).toBeGreaterThan(q8.structuredOutputSuccessRate);
  });
});

describe("selectBest", () => {
  const result = (
    modelId: string,
    dtype: BenchmarkCandidateResult["dtype"],
    rate: number,
    latency: number,
  ): BenchmarkCandidateResult => ({
    modelId,
    dtype,
    structuredOutputSuccessRate: rate,
    averageLatencyMs: latency,
  });

  it("prefers the higher success rate, then the lower latency", () => {
    expect(
      selectBest([result("a", "fp32", 0.5, 10), result("b", "fp32", 1, 900)]).modelId,
    ).toBe("b");
    expect(
      selectBest([result("a", "fp32", 1, 900), result("b", "q8", 1, 100)]).modelId,
    ).toBe("b");
  });

  it("names the winning dtype in its rationale, so the same model at two dtypes is unambiguous", () => {
    const best = selectBest([result("m", "q8", 1, 400), result("m", "fp32", 1, 100)]);
    expect(best.modelId).toBe("m");
    expect(best.dtype).toBe("fp32");
    expect(best.rationale).toContain("dtype=fp32");
  });

  it("does not mutate its input", () => {
    const input = [result("a", "fp32", 0.2, 5), result("b", "fp32", 0.9, 5)];
    selectBest(input);
    expect(input.map((r) => r.modelId)).toEqual(["a", "b"]);
  });

  it("refuses to choose when no candidate was evaluated", () => {
    expect(() => selectBest([])).toThrow(/no candidate/i);
  });
});
