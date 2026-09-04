import type { AIErrorCategory } from "@apipilot/shared-domain";

/**
 * A subset of a specification's operations that together form one AI request
 * (specs/011-ai-prompt-batching/data-model.md: Batch<TOperation>). Internal implementation
 * type — never crosses the AIProvider boundary or an HTTP response.
 */
export interface Batch<TOperation> {
  operations: TOperation[];
}

/**
 * The per-batch result of one AI request attempt (data-model.md: BatchOutcome).
 * "not-attempted" is used only when the overall time budget was already exhausted before
 * this batch could be tried (FR-010, dependency detection only).
 */
export type BatchOutcome =
  | { status: "success" }
  | { status: "failed"; errorCategory: AIErrorCategory; errorMessage: string }
  | { status: "not-attempted" };

/** Closed set of outcomes a run's BatchOutcomes can aggregate to (data-model.md). */
export type AggregateOutcome =
  "success" | "partial" | "timeout" | "unavailable" | "invalid-response";

const UNAVAILABLE_CATEGORIES: readonly AIErrorCategory[] = [
  "PROVIDER_UNAVAILABLE",
  "NOT_READY",
  "LOAD_FAILED",
];

export interface AggregateOutcomeResult {
  outcome: AggregateOutcome;
  /** The representative category for the aggregate: the last failing/not-attempted batch's category, if any. */
  errorCategory?: AIErrorCategory;
  successCount: number;
  failureCount: number;
  notAttemptedCount: number;
  totalCount: number;
}

/**
 * Derives the aggregate outcome for a run from its per-batch outcomes, per the table in
 * data-model.md. A pure function so it can be unit-tested directly, independent of any real
 * provider call (constitution XXI).
 */
export function deriveAggregateOutcome(
  outcomes: readonly BatchOutcome[],
): AggregateOutcomeResult {
  const totalCount = outcomes.length;
  const successCount = outcomes.filter((o) => o.status === "success").length;
  const failures = outcomes.filter(
    (o): o is Extract<BatchOutcome, { status: "failed" }> => o.status === "failed",
  );
  const notAttemptedCount = outcomes.filter((o) => o.status === "not-attempted").length;
  const failureCount = failures.length + notAttemptedCount;
  const lastFailure = failures[failures.length - 1];

  if (totalCount > 0 && successCount === totalCount) {
    return {
      outcome: "success",
      successCount,
      failureCount,
      notAttemptedCount,
      totalCount,
    };
  }
  if (successCount > 0) {
    return {
      outcome: "partial",
      errorCategory: lastFailure?.errorCategory,
      successCount,
      failureCount,
      notAttemptedCount,
      totalCount,
    };
  }
  if (
    notAttemptedCount === 0 &&
    failures.length > 0 &&
    failures.every((f) => f.errorCategory === "TIMEOUT")
  ) {
    return {
      outcome: "timeout",
      errorCategory: lastFailure?.errorCategory,
      successCount,
      failureCount,
      notAttemptedCount,
      totalCount,
    };
  }
  if (
    notAttemptedCount === 0 &&
    failures.length > 0 &&
    failures.every((f) => UNAVAILABLE_CATEGORIES.includes(f.errorCategory))
  ) {
    return {
      outcome: "unavailable",
      errorCategory: lastFailure?.errorCategory,
      successCount,
      failureCount,
      notAttemptedCount,
      totalCount,
    };
  }
  return {
    outcome: "invalid-response",
    errorCategory: lastFailure?.errorCategory,
    successCount,
    failureCount,
    notAttemptedCount,
    totalCount,
  };
}

/**
 * Splits `operations` into one or more batches whose serialized prompt (via `buildPrompt`)
 * fits within `budgetChars`, using deterministic recursive halving
 * (specs/011-ai-prompt-batching/research.md Decision 3). Every operation from the input
 * appears in exactly one batch (FR-004); batch order matches input order (FR-009). A single
 * operation that still doesn't fit becomes its own one-operation batch (FR-011) rather than
 * being dropped or split further — it is still sent, and is expected to fail via the
 * provider's own exact-fit guard (INVALID_REQUEST).
 */
export function splitOperationsIntoBatches<TOperation>(
  operations: readonly TOperation[],
  buildPrompt: (operations: TOperation[]) => string,
  budgetChars: number | undefined,
): Batch<TOperation>[] {
  if (operations.length === 0) return [];

  const asArray = [...operations];
  if (budgetChars === undefined || asArray.length === 1) {
    return [{ operations: asArray }];
  }
  if (buildPrompt(asArray).length <= budgetChars) {
    return [{ operations: asArray }];
  }

  const mid = Math.ceil(asArray.length / 2);
  return [
    ...splitOperationsIntoBatches(asArray.slice(0, mid), buildPrompt, budgetChars),
    ...splitOperationsIntoBatches(asArray.slice(mid), buildPrompt, budgetChars),
  ];
}

export interface BatchRun<TOperation, TBatchData> {
  batch: Batch<TOperation>;
  outcome: BatchOutcome;
  /** Present only when `outcome.status === "success"`. */
  data?: TBatchData;
}

export interface BatchedInferenceSummary<
  TOperation,
  TBatchData,
> extends AggregateOutcomeResult {
  runs: BatchRun<TOperation, TBatchData>[];
}

/**
 * Sequentially runs `runBatch` once per batch — never starting batch N+1 before batch N's
 * call has resolved (FR-003) — and aggregates the resulting BatchOutcomes via
 * `deriveAggregateOutcome()`. `runBatch` is caller-defined so requestBatching.ts stays
 * agnostic to how a batch's InferenceRequest is built or its response parsed/validated.
 *
 * `isTimedOut` (dependency detection only, FR-010, research.md Decision 5) is checked
 * before each batch; once it reports true, that batch and all remaining batches are
 * recorded as "not-attempted" without calling `runBatch`.
 */
export async function runBatchedInference<TOperation, TBatchData>(
  batches: readonly Batch<TOperation>[],
  runBatch: (batch: Batch<TOperation>) => Promise<TBatchData>,
  options: { isTimedOut?: () => boolean } = {},
): Promise<BatchedInferenceSummary<TOperation, TBatchData>> {
  const runs: BatchRun<TOperation, TBatchData>[] = [];

  for (const batch of batches) {
    if (options.isTimedOut?.()) {
      runs.push({ batch, outcome: { status: "not-attempted" } });
      continue;
    }
    try {
      const data = await runBatch(batch);
      runs.push({ batch, outcome: { status: "success" }, data });
    } catch (error) {
      // Duck-typed rather than `instanceof AIProviderError`: `runBatch` may itself throw a
      // provider-thrown error with a `category` property (e.g. a provider's `infer()`
      // rejecting directly) in addition to the `AIProviderError` instances thrown by the
      // response parsers, so both shapes must be recognized here.
      const errorCategory: AIErrorCategory =
        error && typeof error === "object" && "category" in error
          ? (error as { category: AIErrorCategory }).category
          : "INVALID_RESPONSE";
      const errorMessage = error instanceof Error ? error.message : String(error);
      runs.push({ batch, outcome: { status: "failed", errorCategory, errorMessage } });
    }
  }

  const aggregate = deriveAggregateOutcome(runs.map((run) => run.outcome));
  return { runs, ...aggregate };
}
