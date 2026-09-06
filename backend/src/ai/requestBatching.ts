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

/** Per-run rollup of every batch's outcome, returned by `deriveAggregateOutcome`/`runBatchedInference`. */
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
 * Splits `operations` so every batch's serialized prompt (via `buildPrompt`) fits within
 * `budgetChars`, using deterministic recursive halving (specs/011-ai-prompt-batching/research.md
 * Decision 3). This is the context-capacity bound only; `splitOperationsIntoBatches` applies the
 * work bound before calling it.
 */
function splitByContextBudget<TOperation>(
  operations: TOperation[],
  buildPrompt: (operations: TOperation[]) => string,
  budgetChars: number | undefined,
): Batch<TOperation>[] {
  if (operations.length === 0) return [];
  if (budgetChars === undefined || operations.length === 1) {
    return [{ operations }];
  }
  if (buildPrompt(operations).length <= budgetChars) {
    return [{ operations }];
  }

  const mid = Math.ceil(operations.length / 2);
  return [
    ...splitByContextBudget(operations.slice(0, mid), buildPrompt, budgetChars),
    ...splitByContextBudget(operations.slice(mid), buildPrompt, budgetChars),
  ];
}

/**
 * Splits `operations` into batches bounded first by work and second by context capacity
 * (specs/014-ai-batching-policy/contracts/batch-sizing.md).
 *
 * `maxOperationsPerBatch` is the work bound: batches are formed from at most that many operations,
 * taken in input order, and each is then still checked against `budgetChars`. Sizing by work rather
 * than by remaining context is what makes a batch's *reply* short enough to be usable — measured,
 * one operation per batch produced a valid reply for 6 of 6 operations of a real specification,
 * while two and three both truncated mid-document, and the whole-specification batch that
 * context-only sizing produced made the model echo the request back instead of answering it
 * (research.md Decisions 1 and 2).
 *
 * The bound is supplied per caller rather than fixed, because the two AI passes have opposite
 * pressures: scenario enhancement reasons about one operation's contract, so the smallest batch is
 * the best batch, while dependency analysis infers relationships *between* operations and cannot
 * find one whose two ends land in different batches (research.md Decision 7).
 *
 * Omitting the bound — or passing a non-positive or non-finite value — preserves the previous
 * context-only behavior exactly, so callers not yet migrated are unaffected.
 *
 * Every operation appears in exactly one batch (FR-004, FR-006); batch order matches input order
 * (FR-005, FR-009). A single operation that still doesn't fit `budgetChars` becomes its own
 * one-operation batch (FR-011) rather than being dropped or split further — it is still sent, and
 * is expected to fail via the provider's own exact-fit guard (INVALID_REQUEST), which is what makes
 * it a visible, named exclusion rather than a silent one.
 */
export function splitOperationsIntoBatches<TOperation>(
  operations: readonly TOperation[],
  buildPrompt: (operations: TOperation[]) => string,
  budgetChars: number | undefined,
  maxOperationsPerBatch?: number,
): Batch<TOperation>[] {
  if (operations.length === 0) return [];

  const workBound =
    typeof maxOperationsPerBatch === "number" &&
    Number.isFinite(maxOperationsPerBatch) &&
    maxOperationsPerBatch >= 1
      ? Math.floor(maxOperationsPerBatch)
      : undefined;

  if (workBound === undefined) {
    return splitByContextBudget([...operations], buildPrompt, budgetChars);
  }

  const batches: Batch<TOperation>[] = [];
  for (let start = 0; start < operations.length; start += workBound) {
    batches.push(
      ...splitByContextBudget(
        operations.slice(start, start + workBound) as TOperation[],
        buildPrompt,
        budgetChars,
      ),
    );
  }
  return batches;
}

/** One batch's outcome plus (on success) the caller-defined data `runBatch` produced for it. */
export interface BatchRun<TOperation, TBatchData> {
  batch: Batch<TOperation>;
  outcome: BatchOutcome;
  /** Present only when `outcome.status === "success"`. */
  data?: TBatchData;
}

/** `runBatchedInference`'s full result: the aggregate outcome plus every individual batch's run. */
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
 *
 * `onBatchStart`/`onBatchSettled` (specs/012-ai-enhancement-progress) are optional,
 * no-op-by-default progress hooks: `onBatchStart` fires immediately before a batch's
 * `runBatch()` is invoked, `onBatchSettled` immediately after its `BatchOutcome` is known.
 * Neither changes this function's return shape or any existing caller's behavior when
 * omitted (e.g. `analyzeDependencies.ts`'s existing call site).
 */
export async function runBatchedInference<TOperation, TBatchData>(
  batches: readonly Batch<TOperation>[],
  runBatch: (batch: Batch<TOperation>) => Promise<TBatchData>,
  options: {
    isTimedOut?: () => boolean;
    /**
     * Checked before each batch alongside `isTimedOut`; once true, that batch and all remaining
     * ones are recorded as "not-attempted" without calling `runBatch`
     * (specs/013-ai-enhancement-viability FR-020). Optional and defaulting to never-cancelled, so
     * existing callers are unaffected.
     */
    isCancelled?: () => boolean;
    onBatchStart?: (index: number, total: number) => void;
    onBatchSettled?: (index: number, total: number, outcome: BatchOutcome) => void;
  } = {},
): Promise<BatchedInferenceSummary<TOperation, TBatchData>> {
  const runs: BatchRun<TOperation, TBatchData>[] = [];
  const total = batches.length;

  for (const [index, batch] of batches.entries()) {
    if (options.isTimedOut?.() || options.isCancelled?.()) {
      const outcome: BatchOutcome = { status: "not-attempted" };
      runs.push({ batch, outcome });
      options.onBatchSettled?.(index, total, outcome);
      continue;
    }
    options.onBatchStart?.(index, total);
    try {
      const data = await runBatch(batch);
      const outcome: BatchOutcome = { status: "success" };
      runs.push({ batch, outcome, data });
      options.onBatchSettled?.(index, total, outcome);
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
      const outcome: BatchOutcome = { status: "failed", errorCategory, errorMessage };
      runs.push({ batch, outcome });
      options.onBatchSettled?.(index, total, outcome);
    }
  }

  const aggregate = deriveAggregateOutcome(runs.map((run) => run.outcome));
  return { runs, ...aggregate };
}
