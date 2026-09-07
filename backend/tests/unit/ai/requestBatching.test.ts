import { describe, expect, it, vi } from "vitest";
import { AIProviderError } from "../../../src/ai/errors";
import {
  deriveAggregateOutcome,
  runBatchedInference,
  splitOperationsIntoBatches,
  type Batch,
} from "../../../src/ai/requestBatching";

function buildPrompt(operations: number[]): string {
  return JSON.stringify(operations);
}

describe("splitOperationsIntoBatches", () => {
  it("returns a single batch containing every operation when it already fits the budget", () => {
    const operations = [1, 2, 3];
    const batches = splitOperationsIntoBatches(operations, buildPrompt, 1000);
    expect(batches).toEqual([{ operations: [1, 2, 3] }]);
  });

  it("returns a single batch when budgetChars is undefined (no limit, e.g. MockProvider default)", () => {
    const operations = Array.from({ length: 50 }, (_, i) => i);
    const batches = splitOperationsIntoBatches(operations, buildPrompt, undefined);
    expect(batches).toHaveLength(1);
    expect(batches[0].operations).toEqual(operations);
  });

  it("recursively halves oversized input down to one-operation batches, covering every operation exactly once", () => {
    const operations = Array.from({ length: 9 }, (_, i) => i);
    // buildPrompt(ops).length grows with ops.length, so a tight budget forces splitting
    // down to single-operation batches.
    const budgetChars = buildPrompt([0]).length;
    const batches = splitOperationsIntoBatches(operations, buildPrompt, budgetChars);

    const allOperations = batches.flatMap((batch) => batch.operations);
    expect(allOperations).toEqual(operations);
    expect(batches.every((batch) => batch.operations.length === 1)).toBe(true);
  });

  it("treats a single operation that still doesn't fit as its own one-operation batch rather than dropping it", () => {
    const operations = [12345];
    const batches = splitOperationsIntoBatches(operations, buildPrompt, 1);
    expect(batches).toEqual([{ operations: [12345] }]);
  });

  it("produces identical batch groupings across at least 10 repeated calls with the same input and budget (FR-009, SC-004)", () => {
    const operations = Array.from({ length: 17 }, (_, i) => i);
    const budgetChars = 12;
    const first = splitOperationsIntoBatches(operations, buildPrompt, budgetChars);
    for (let i = 0; i < 10; i++) {
      expect(splitOperationsIntoBatches(operations, buildPrompt, budgetChars)).toEqual(
        first,
      );
    }
  });

  it("produces correspondingly different groupings for two differently-configured providers, with no cross-run caching (FR-012)", () => {
    const operations = Array.from({ length: 17 }, (_, i) => i);
    const generousBudget = 10_000;
    const tightBudget = 12;

    const generousBatches = splitOperationsIntoBatches(
      operations,
      buildPrompt,
      generousBudget,
    );
    const tightBatches = splitOperationsIntoBatches(operations, buildPrompt, tightBudget);
    // Re-running the generous budget after the tight one confirms nothing was cached/reused
    // from the other provider's run.
    const generousBatchesAgain = splitOperationsIntoBatches(
      operations,
      buildPrompt,
      generousBudget,
    );

    expect(generousBatches).toHaveLength(1);
    expect(tightBatches.length).toBeGreaterThan(1);
    expect(generousBatchesAgain).toEqual(generousBatches);
  });
});

describe("splitOperationsIntoBatches work bound (specs/014-ai-batching-policy)", () => {
  it("yields one batch per operation for a large specification when the work bound is 1", () => {
    const operations = Array.from({ length: 200 }, (_, i) => i);

    const batches = splitOperationsIntoBatches(operations, buildPrompt, 1_000_000, 1);

    expect(batches).toHaveLength(200);
    expect(batches.every((batch) => batch.operations.length === 1)).toBe(true);
  });

  it("preserves specification order across batches", () => {
    const operations = [10, 20, 30, 40, 50];

    const batches = splitOperationsIntoBatches(operations, buildPrompt, 1_000_000, 2);

    expect(batches.map((batch) => batch.operations)).toEqual([[10, 20], [30, 40], [50]]);
  });

  it("places every operation in exactly one batch, losing and duplicating none", () => {
    const operations = Array.from({ length: 37 }, (_, i) => i);

    const batches = splitOperationsIntoBatches(operations, buildPrompt, 1_000_000, 3);

    const flattened = batches.flatMap((batch) => batch.operations);
    expect(flattened).toEqual(operations);
    expect(new Set(flattened).size).toBe(operations.length);
  });

  it("produces identical batches across repeated calls, so a run is reproducible (SC-008)", () => {
    const operations = Array.from({ length: 50 }, (_, i) => i);

    const first = splitOperationsIntoBatches(operations, buildPrompt, 400, 4);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(splitOperationsIntoBatches(operations, buildPrompt, 400, 4)).toEqual(first);
    }
  });

  it("still applies the context budget within a work-bounded batch, so the work bound cannot produce an oversized request", () => {
    const operations = [1, 2, 3, 4];
    // A budget too small for the 4-operation work bound to fit in one prompt.
    const tightBudget = buildPrompt([1, 2]).length;

    const batches = splitOperationsIntoBatches(operations, buildPrompt, tightBudget, 4);

    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flatMap((batch) => batch.operations)).toEqual(operations);
    for (const batch of batches) {
      expect(buildPrompt(batch.operations).length).toBeLessThanOrEqual(tightBudget);
    }
  });

  it("isolates a single operation that alone exceeds the budget rather than dropping or merging it (FR-011)", () => {
    const operations = [1, 2, 3];

    const batches = splitOperationsIntoBatches(operations, buildPrompt, 1, 3);

    expect(batches).toEqual([{ operations: [1] }, { operations: [2] }, { operations: [3] }]);
  });

  it.each([
    ["omitted", undefined],
    ["zero", 0],
    ["negative", -5],
    ["not finite", Number.NaN],
  ])("falls back to context-only sizing when the work bound is %s, leaving existing callers unaffected", (_label, bound) => {
    const operations = [1, 2, 3, 4, 5];
    const budgetChars = buildPrompt([1, 2]).length;

    const withBound = splitOperationsIntoBatches(operations, buildPrompt, budgetChars, bound);
    const contextOnly = splitOperationsIntoBatches(operations, buildPrompt, budgetChars);

    expect(withBound).toEqual(contextOnly);
  });

  it("treats a work bound larger than the operation count as no constraint", () => {
    const operations = [1, 2, 3];

    const batches = splitOperationsIntoBatches(operations, buildPrompt, 1_000_000, 99);

    expect(batches).toEqual([{ operations: [1, 2, 3] }]);
  });

  it("returns no batches for an empty operation list regardless of the work bound", () => {
    expect(splitOperationsIntoBatches([], buildPrompt, 1000, 1)).toEqual([]);
  });
});

describe("deriveAggregateOutcome", () => {
  it("returns 'success' when every batch succeeded", () => {
    const result = deriveAggregateOutcome([{ status: "success" }, { status: "success" }]);
    expect(result.outcome).toBe("success");
  });

  it("returns 'partial' when some batches succeeded and some failed", () => {
    const result = deriveAggregateOutcome([
      { status: "success" },
      { status: "failed", errorCategory: "TIMEOUT", errorMessage: "timed out" },
    ]);
    expect(result.outcome).toBe("partial");
    expect(result.errorCategory).toBe("TIMEOUT");
  });

  it("returns 'timeout' when every batch failed with TIMEOUT", () => {
    const result = deriveAggregateOutcome([
      { status: "failed", errorCategory: "TIMEOUT", errorMessage: "a" },
      { status: "failed", errorCategory: "TIMEOUT", errorMessage: "b" },
    ]);
    expect(result.outcome).toBe("timeout");
  });

  it("returns 'unavailable' when every batch failed with an unavailable-category error", () => {
    const result = deriveAggregateOutcome([
      { status: "failed", errorCategory: "PROVIDER_UNAVAILABLE", errorMessage: "a" },
      { status: "failed", errorCategory: "NOT_READY", errorMessage: "b" },
    ]);
    expect(result.outcome).toBe("unavailable");
  });

  it("returns 'invalid-response' for mixed/other all-failure categories, including any not-attempted batch", () => {
    const mixedCategories = deriveAggregateOutcome([
      { status: "failed", errorCategory: "TIMEOUT", errorMessage: "a" },
      { status: "failed", errorCategory: "INVALID_RESPONSE", errorMessage: "b" },
    ]);
    expect(mixedCategories.outcome).toBe("invalid-response");

    const withNotAttempted = deriveAggregateOutcome([
      { status: "failed", errorCategory: "TIMEOUT", errorMessage: "a" },
      { status: "not-attempted" },
    ]);
    expect(withNotAttempted.outcome).toBe("invalid-response");
  });
});

describe("runBatchedInference", () => {
  it("issues batches sequentially, never starting batch N+1 before batch N resolves (FR-003)", async () => {
    const batches: Batch<number>[] = [
      { operations: [1] },
      { operations: [2] },
      { operations: [3] },
    ];
    const activeCount: number[] = [];
    let inFlight = 0;

    const runBatch = vi.fn(async (batch: Batch<number>) => {
      inFlight++;
      activeCount.push(inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return batch.operations[0];
    });

    await runBatchedInference(batches, runBatch);

    expect(activeCount).toEqual([1, 1, 1]);
    expect(runBatch).toHaveBeenCalledTimes(3);
  });

  it("aggregates a mix of success/failure into 'partial' and preserves each batch's data", async () => {
    const batches: Batch<number>[] = [{ operations: [1] }, { operations: [2] }];
    const summary = await runBatchedInference(batches, async (batch) => {
      if (batch.operations[0] === 2) {
        throw new AIProviderError("TIMEOUT", "batch 2 timed out");
      }
      return `result-${batch.operations[0]}`;
    });

    expect(summary.outcome).toBe("partial");
    expect(summary.runs[0].outcome).toEqual({ status: "success" });
    expect(summary.runs[0].data).toBe("result-1");
    expect(summary.runs[1].outcome).toMatchObject({
      status: "failed",
      errorCategory: "TIMEOUT",
    });
  });

  it("marks remaining batches as not-attempted once isTimedOut() reports true", async () => {
    const batches: Batch<number>[] = [{ operations: [1] }, { operations: [2] }];
    let calls = 0;
    const summary = await runBatchedInference(
      batches,
      async () => {
        calls++;
        return "ok";
      },
      { isTimedOut: () => calls >= 1 },
    );

    expect(calls).toBe(1);
    expect(summary.runs[1].outcome).toEqual({ status: "not-attempted" });
    expect(summary.outcome).toBe("partial");
  });

  it("fires onBatchStart/onBatchSettled once per batch, in order, with the correct index/total/outcome (specs/012-ai-enhancement-progress)", async () => {
    const batches: Batch<number>[] = [
      { operations: [1] },
      { operations: [2] },
      { operations: [3] },
    ];
    const events: string[] = [];
    const onBatchStart = vi.fn((index: number, total: number) => {
      events.push(`start:${index}/${total}`);
    });
    const onBatchSettled = vi.fn((index: number, total: number, outcome) => {
      events.push(`settled:${index}/${total}:${outcome.status}`);
    });

    await runBatchedInference(
      batches,
      async (batch) => {
        if (batch.operations[0] === 2) {
          throw new AIProviderError("TIMEOUT", "batch 2 timed out");
        }
        return `result-${batch.operations[0]}`;
      },
      { onBatchStart, onBatchSettled },
    );

    expect(onBatchStart).toHaveBeenCalledTimes(3);
    expect(onBatchSettled).toHaveBeenCalledTimes(3);
    expect(events).toEqual([
      "start:0/3",
      "settled:0/3:success",
      "start:1/3",
      "settled:1/3:failed",
      "start:2/3",
      "settled:2/3:success",
    ]);
  });

  it("calls onBatchSettled (not onBatchStart) for a batch skipped via isTimedOut, with a not-attempted outcome", async () => {
    const batches: Batch<number>[] = [{ operations: [1] }, { operations: [2] }];
    let calls = 0;
    const onBatchStart = vi.fn();
    const onBatchSettled = vi.fn();

    await runBatchedInference(
      batches,
      async () => {
        calls++;
        return "ok";
      },
      { isTimedOut: () => calls >= 1, onBatchStart, onBatchSettled },
    );

    expect(onBatchStart).toHaveBeenCalledTimes(1);
    expect(onBatchStart).toHaveBeenCalledWith(0, 2);
    expect(onBatchSettled).toHaveBeenCalledTimes(2);
    expect(onBatchSettled).toHaveBeenNthCalledWith(2, 1, 2, { status: "not-attempted" });
  });

  it("behaves identically to today when onBatchStart/onBatchSettled are omitted (analyzeDependencies.ts's existing call site is unaffected)", async () => {
    const batches: Batch<number>[] = [{ operations: [1] }, { operations: [2] }];
    const summary = await runBatchedInference(batches, async (batch) => batch.operations[0]);

    expect(summary.outcome).toBe("success");
    expect(summary.runs.map((run) => run.data)).toEqual([1, 2]);
  });
});
