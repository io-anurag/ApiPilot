import { describe, expect, it } from "vitest";
import { explainFailure } from "../../../src/testGenerationWorkflow/failureExplanation";

/**
 * The user-facing account of a non-success AI enhancement run
 * (specs/013-ai-enhancement-viability/contracts/failure-explanation.md,
 * specs/014-ai-batching-policy contracts/run-budget.md).
 *
 * FR-021/FR-024 forbid an explanation from leaking an internal category literal, an implementation
 * constant name, or a raw millisecond value — the message this mapping replaced leaked all three at
 * once ("AI enhancement was skipped (TIMEOUT): Inference exceeded the configured timeout of
 * 300000ms."), so the prohibition is asserted for every branch rather than only the new one.
 */
describe("explainFailure", () => {
  const ALL_CAUSES = [
    "TIMEOUT",
    "NOT_READY",
    "LOAD_FAILED",
    "PROVIDER_UNAVAILABLE",
    "INVALID_RESPONSE",
    "INVALID_REQUEST",
    "cancelled",
    "not-viable",
    "run-budget-exhausted",
  ] as const;

  it.each(ALL_CAUSES)("leaks no internal detail for %s", (cause) => {
    const explanation = explainFailure(cause, {
      projectedMs: 81_000,
      budgetMs: 300_000,
      notStartedCount: 32,
      plannedCount: 39,
      operationLabel: "GET /pets",
    });
    const text = `${explanation.summary} ${explanation.nextStep}`;

    // No AIErrorCategory literal, no environment variable name, no raw millisecond value.
    expect(text).not.toMatch(/[A-Z]{4,}_[A-Z_]+/);
    expect(text).not.toMatch(/\d+\s*ms\b/);
    expect(text).not.toContain("300000");
    expect(text).not.toContain("81000");
  });

  describe("run-budget-exhausted (specs/014-ai-batching-policy)", () => {
    it("reports what the ceiling covered rather than blaming the model's speed", () => {
      const explanation = explainFailure("run-budget-exhausted", {
        budgetMs: 300_000,
        notStartedCount: 32,
        plannedCount: 39,
      });

      // Shares TIMEOUT's user-facing category per contracts/run-budget.md's outcome mapping...
      expect(explanation.category).toBe("too-slow");
      // ...but not its wording: nothing timed out and nothing was lost.
      expect(explanation.summary).toContain("7 of 39 operations");
      expect(explanation.summary).toContain("about 5 minutes");
      expect(explanation.nextStep).toContain("kept");
      // A retry re-runs the same units in the same order and stops in the same place (FR-025).
      expect(explanation.retryable).toBe(false);
    });

    it("still explains itself when the planned counts are unavailable", () => {
      const explanation = explainFailure("run-budget-exhausted");

      expect(explanation.category).toBe("too-slow");
      expect(explanation.summary).toContain("part of the specification");
      expect(explanation.retryable).toBe(false);
    });
  });
});
