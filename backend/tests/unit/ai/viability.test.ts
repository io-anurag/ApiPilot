import { describe, expect, it } from "vitest";
import { estimateViability } from "../../../src/ai/viability";

describe("estimateViability", () => {
  it("refuses the measured defect with injected q8 rates", () => {
    const estimate = estimateViability({
      promptTokens: 5_845,
      maxOutputTokens: 1_024,
      rates: { prefillMsPerToken: 2, decodeMsPerToken: 2_000 },
      budgetMs: 300_000,
      safetyFactor: 1.5,
    });

    expect(estimate.projectedMs).toBe(2_059_690);
    expect(estimate.projectedMs / estimate.budgetMs).toBeCloseTo(6.87, 2);
    expect(estimate.viable).toBe(false);
  });

  it("admits a projection that is over budget but within the safety factor", () => {
    const estimate = estimateViability({
      promptTokens: 100,
      maxOutputTokens: 10,
      rates: { prefillMsPerToken: 10, decodeMsPerToken: 10 },
      budgetMs: 1_000,
      safetyFactor: 1.5,
    });

    expect(estimate.projectedMs).toBe(1_100);
    expect(estimate.viable).toBe(true);
  });

  it("is pure and deterministic for identical inputs", () => {
    const input = {
      promptTokens: 321,
      maxOutputTokens: 192,
      rates: { prefillMsPerToken: 42, decodeMsPerToken: 180 },
      budgetMs: 120_000,
      safetyFactor: 1.5,
    } as const;

    expect(estimateViability(input)).toEqual(estimateViability(input));
  });
});
