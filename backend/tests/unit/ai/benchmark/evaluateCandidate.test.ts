import { describe, expect, it } from "vitest";
import type {
  AIProvider,
  BenchmarkCandidateResult,
  InferenceRequest,
} from "@apipilot/shared-domain";
import {
  WARMUP_INPUT,
  evaluateCandidate,
  selectBest,
} from "../../../../src/ai/benchmark/evaluateCandidate";
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
      const content = request.input === WARMUP_INPUT ? "pong" : replies[request.input];
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
    // The first request is the untimed warm-up, covered separately below.
    expect(seen.slice(1).map((r) => [r.input, r.expectedOutputFormat, r.maxOutputTokens])).toEqual([
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

describe("evaluateCandidate warm-up (specs/013 T026)", () => {
  const workloads = [workload("a", (c) => c === "ok"), workload("b", (c) => c === "ok")];

  it("loads the model with an untimed warm-up request before any workload, so load time is not charged to a workload", async () => {
    const seen: InferenceRequest[] = [];
    const result = await evaluateCandidate(
      { modelId: "m", dtype: "fp32" },
      scriptedProvider({ "input-a": "ok", "input-b": "ok" }, seen),
      workloads,
      () => 1,
    );

    expect(seen.map((r) => r.input)).toEqual([WARMUP_INPUT, "input-a", "input-b"]);
    expect(seen[0].maxOutputTokens).toBe(1);
    expect(result.structuredOutputSuccessRate).toBe(1);
    expect(result.loadMs).toBeGreaterThanOrEqual(0);
  });

  it("averages latency over the workloads only", async () => {
    let clock = 0;
    const provider = scriptedProvider({ "input-a": "ok", "input-b": "ok" });
    const original = provider.infer.bind(provider);
    provider.infer = async (request) => {
      clock += request.input === WARMUP_INPUT ? 100_000 : 10;
      return original(request);
    };
    const result = await evaluateCandidate(
      { modelId: "m", dtype: "fp32" },
      provider,
      workloads,
      () => 1,
      () => clock,
    );

    expect(result.loadMs).toBe(100_000);
    expect(result.averageLatencyMs).toBe(10);
  });

  it("reports the average reply length, which separates a slow model from a long reply", async () => {
    const result = await evaluateCandidate(
      { modelId: "m", dtype: "fp32" },
      scriptedProvider({ "input-a": "12345678", "input-b": "1234" }),
      workloads,
      () => 1,
    );
    expect(result.averageOutputChars).toBe(6);
  });

  it("throws when the warm-up fails, because a model that cannot load has no results to compare", async () => {
    const provider = scriptedProvider({ "input-a": "ok", "input-b": "ok" });
    provider.infer = async (request) => ({
      contractVersion: 1,
      requestId: request.requestId,
      status: "error",
      errorCategory: "LOAD_FAILED",
      errorMessage: "no weights",
      modelId: "m",
      provider: "mock",
      durationMs: 0,
    });

    await expect(
      evaluateCandidate({ modelId: "m", dtype: "fp32" }, provider, workloads, () => 1),
    ).rejects.toThrow(/warm-up/i);
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

  describe("when no candidate produced a usable reply", () => {
    const none = [result("a", "fp32", 0, 10), result("b", "q8", 0, 5), result("c", "fp32", 0, 1)];

    it("selects nothing on merit: it retains the configured model and says it is not an endorsement", () => {
      const best = selectBest(none, "b");
      expect(best.qualified).toBe(false);
      expect(best.modelId).toBe("b");
      expect(best.rationale).toMatch(/no candidate/i);
      expect(best.rationale).toMatch(/retained/i);
      expect(best.rationale).toMatch(/not an endorsement/i);
      expect(best.rationale).not.toMatch(/highest/i);
    });

    it("falls back to the best-ranked candidate when the configured model was not evaluated, still unqualified", () => {
      const best = selectBest(none, "not-evaluated");
      expect(best.qualified).toBe(false);
      expect(none.map((r) => r.modelId)).toContain(best.modelId);
    });

    it("reports a candidate with any usable reply as qualified", () => {
      const best = selectBest([result("a", "fp32", 0, 1), result("b", "fp32", 0.34, 99)], "a");
      expect(best.qualified).toBe(true);
      expect(best.modelId).toBe("b");
    });
  });
});
