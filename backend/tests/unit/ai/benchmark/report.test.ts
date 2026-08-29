import { describe, expect, it } from "vitest";
import { buildBenchmarkReport } from "../../../../src/ai/benchmark/report";

describe("buildBenchmarkReport", () => {
  const candidates = [
    { modelId: "model-a", structuredOutputSuccessRate: 0.9, averageLatencyMs: 500 },
    { modelId: "model-b", structuredOutputSuccessRate: 0.8, averageLatencyMs: 300 },
  ];

  it("builds a report when selectedModelId matches one of the candidates", () => {
    const report = buildBenchmarkReport({
      workloadSetId: "test-set",
      candidates,
      selectedModelId: "model-a",
      selectionRationale: "Highest structured-output success rate",
    });

    expect(report.selectedModelId).toBe("model-a");
    expect(report.candidates).toHaveLength(2);
    expect(new Date(report.runAt).toISOString()).toBe(report.runAt);
  });

  it("throws when selectedModelId does not match any evaluated candidate", () => {
    expect(() =>
      buildBenchmarkReport({
        workloadSetId: "test-set",
        candidates,
        selectedModelId: "model-z",
        selectionRationale: "invalid",
      }),
    ).toThrow(/must match/);
  });
});
