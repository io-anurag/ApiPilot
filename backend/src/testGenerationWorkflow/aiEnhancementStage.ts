import type {
  AIProvider,
  AiEnhancementProgress,
  BatchOutcomeRecord,
  BatchProgress,
  ReviewScenario,
  TestGenerationWorkflow,
  TestModel,
} from "@apipilot/shared-domain";
import {
  computeReviewSummary,
  createReviewWorkspace,
} from "../testDesign/reviewTestModel";
import { enhanceTestModel, retryOneBatch } from "../testDesign/enhanceTestModel";
import type { BatchOutcome } from "../ai/requestBatching";
import { loadAIConfig } from "../ai/modelConfig";
import { createLogger } from "../logger";
import {
  AiEnhancementAlreadyRunningError,
  BatchNotFoundError,
  BatchNotRetryableError,
  NoAiEnhancementRunInProgressError,
  StageNotActiveError,
} from "./errors";
import { explainFailure, type FailureCause } from "./failureExplanation";
import {
  advanceActiveStage,
  getCurrentWorkflow,
  isAiEnhancementCancelRequested,
  markAiEnhancementGenerating,
  requestAiEnhancementCancel,
  patchWorkflow,
  setAiEnhancementBatchOutcome,
  setAiEnhancementProgress,
  updateStage,
} from "./workflowStore";

const logger = createLogger("testGenerationWorkflow.aiEnhancementStage");

/**
 * Requests cancellation of the run currently in flight
 * (specs/013-ai-enhancement-viability/contracts/ai-enhancement-cancel.md, FR-020).
 *
 * Returns as soon as the request is recorded rather than waiting for the run to settle: that is
 * what returns interactive control to the user promptly (SC-008). Cancellation takes effect at
 * the next batch boundary — an in-flight generation cannot be interrupted, since the underlying
 * runtime exposes no abort signal (research.md Decision 7) — so the run finishes shortly
 * afterwards and the client observes the terminal state through its existing poll.
 *
 * Idempotent: cancelling an already-cancelled run succeeds without changing anything.
 */
export function cancelAiEnhancement(): TestGenerationWorkflow {
  const workflow = getCurrentWorkflow();
  if (!workflow?.stages.aiEnhancement.progress) {
    throw new NoAiEnhancementRunInProgressError();
  }
  const updated = requestAiEnhancementCancel();
  logger.info("cancel_requested", {
    stage: "aiEnhancement",
    workflowId: updated.id,
  });
  return updated;
}

/** ReviewScenario wrappers for scenarios in `testModel` not already present in `existingIds`. */
function newlyAddedReviewScenarios(
  testModel: TestModel,
  existingIds: Set<string>,
): ReviewScenario[] {
  return testModel.scenarios
    .filter((scenario) => !existingIds.has(scenario.id))
    .map((scenario) => ({
      scenarioId: scenario.id,
      revision: 0,
      scenario,
      state: "pending" as const,
      isUserModified: false,
      history: [],
    }));
}

/**
 * Builds the persisted `BatchOutcomeRecord` for one settled batch (specs/015-ai-batch-retry
 * FR-001, FR-010). `failureExplanation` reuses the same `explainFailure()` the run-level field
 * of the same name already relies on (research.md Decision 4) — a `"not-attempted"` batch's
 * cause is read from the live cancellation flag at the moment it settles, since a batch never
 * knows on its own whether the run's ceiling or a user cancellation is why it was never sent.
 */
function buildBatchOutcomeRecord(
  index: number,
  operationKeys: string[],
  outcome: BatchOutcome,
): BatchOutcomeRecord {
  if (outcome.status === "success") {
    return { index, operationKeys, status: "succeeded" };
  }
  if (outcome.status === "not-attempted") {
    return {
      index,
      operationKeys,
      status: "not-attempted",
      failureExplanation: explainFailure(
        isAiEnhancementCancelRequested() ? "cancelled" : "run-budget-exhausted",
      ),
    };
  }
  return {
    index,
    operationKeys,
    status: "failed",
    errorCategory: outcome.errorCategory,
    // A total run with unusable output is not retryable as a whole, but an individual failed
    // batch is exactly what the batch-retry workflow is designed to recover.
    failureExplanation: explainFailure(outcome.errorCategory as FailureCause, {
      partialRun: true,
    }),
  };
}

/**
 * Returns `progress`'s `batches` array with `index` patched to `patch`, first (re)building a
 * full `pending`-filled array of length `total` if `progress` is absent or was sized for a
 * different `total` — `enhanceTestModel`'s caller has no way to know a run's real batch count
 * until the first `onBatchStart`/`onBatchComplete` callback reports it (specs/012-ai-enhancement-progress).
 */
function withBatchPatched(
  progress: AiEnhancementProgress | undefined,
  total: number,
  index: number,
  patch: BatchProgress,
  runBudgetMs: number,
): AiEnhancementProgress {
  const batches: BatchProgress[] =
    progress && progress.totalBatches === total
      ? progress.batches.slice()
      : Array.from({ length: total }, (_, i) => ({
          index: i,
          status: "pending" as const,
        }));
  batches[index] = patch;
  const generatingSince = progress?.generatingSince ?? new Date().toISOString();
  return {
    totalBatches: total,
    batches,
    startedAt: progress?.startedAt ?? new Date().toISOString(),
    // Any batch activity means preparation is over, so carry the generating phase forward rather
    // than reverting to the `preparing` default (the phase transition is one-way, FR-018).
    phase: "generating",
    generatingSince,
    cancelRequested: progress?.cancelRequested ?? false,
    // Clamped at zero: the ceiling governs what is *started*, so a unit already in flight when it
    // elapses keeps running with nothing left (specs/014-ai-batching-policy FR-012).
    runBudgetRemainingMs: Math.max(
      0,
      runBudgetMs - (Date.now() - new Date(generatingSince).getTime()),
    ),
  };
}

/**
 * Runs (or retries) AI enhancement. `reviewWorkspace` is seeded with the deterministic
 * baseline before the run starts (fresh runs only — a retry keeps the still-live workspace
 * from the prior attempt), then AI-derived scenarios are appended to it incrementally as each
 * batch succeeds, and `stages.aiEnhancement.progress` is populated/updated the same way, so a
 * concurrent `GET /api/test-generation-workflow` can observe live batch-level progress and
 * partial results while a multi-batch run is still going (specs/012-ai-enhancement-progress).
 * A second call while one is already in progress is rejected
 * (`AiEnhancementAlreadyRunningError`, FR-008).
 *
 * Once the run finishes: a successful run completes the stage. A `"partial"` outcome (some
 * but not all batches succeeded, specs/011-ai-prompt-batching FR-011) marks the stage
 * `"partial"` — distinct from `"skipped"` — with `reviewWorkspace` already reflecting whatever
 * AI-derived scenarios did succeed (research.md Decision 7). Any other outcome marks the
 * stage `"skipped"` with the recorded error (FR-008) but still advances to `scenarioReview` on
 * the deterministic-only baseline. `progress` is cleared the moment the stage reaches any of
 * these terminal statuses.
 *
 * Retrying after `"skipped"` or `"partial"` is allowed only while `scenarioReview` has not
 * been finalized (FR-008a); a successful retry folds newly AI-derived scenarios into the
 * still-live workspace rather than resetting decisions already made on the deterministic
 * scenarios.
 */
export async function runAiEnhancement(
  provider: AIProvider,
): Promise<TestGenerationWorkflow> {
  const startedAt = Date.now();
  // Tracks whether *this* call set progress, so the catch block below only ever clears
  // progress it created itself — never another still-legitimately-running call's progress
  // (relevant when this call fails precisely because one is already in progress, FR-008).
  let progressSetByThisCall = false;
  try {
    const workflow = getCurrentWorkflow();
    if (!workflow) {
      throw new StageNotActiveError("aiEnhancement is not the active stage.");
    }
    const status = workflow.stages.aiEnhancement.status;
    if (status === "active") {
      // first attempt
    } else if (status === "skipped" || status === "partial") {
      if (workflow.stages.scenarioReview.status === "complete") {
        throw new StageNotActiveError(
          "AI enhancement can no longer be retried: scenario review is already finalized.",
        );
      }
      updateStage("aiEnhancement", "active");
    } else {
      throw new StageNotActiveError("aiEnhancement is not the active stage.");
    }

    // FR-008: a run is already in progress iff progress is already present — checked and set
    // synchronously, with no `await` in between, so a second concurrent call cannot race past
    // this check before the first call's progress is visible.
    if (workflow.stages.aiEnhancement.progress) {
      throw new AiEnhancementAlreadyRunningError();
    }
    const isRetry = workflow.reviewWorkspace !== undefined;
    // Read once for the whole run so every progress update reports the remaining allowance
    // against the same ceiling `enhanceTestModel` is enforcing (FR-012).
    const runBudgetMs = loadAIConfig().planning.enhancementRunBudgetMs;
    // Starts in the "preparing" phase with no batches: batch planning needs the loaded engine's
    // capacity, so until the model is ready there is genuinely nothing to count. Reporting the
    // phase is what makes a long first-run wait attributable — it can include a several-hundred-
    // megabyte download, which previously appeared as an unexplained delay indistinguishable from
    // slow generation (specs/013-ai-enhancement-viability FR-018).
    setAiEnhancementProgress({
      totalBatches: 0,
      batches: [],
      startedAt: new Date().toISOString(),
      phase: "preparing",
      cancelRequested: false,
    });
    progressSetByThisCall = true;
    if (!isRetry) {
      // Seed the review workspace with the deterministic baseline immediately, before any AI
      // batch has even started, so it is reviewable from the very start of the run — AI-derived
      // scenarios are appended to it incrementally as each batch succeeds (below), rather than
      // only once the whole run finishes (FR-009).
      patchWorkflow({
        reviewWorkspace: createReviewWorkspace(workflow.deterministicTestModel!),
      });
    }

    const result = await enhanceTestModel(
      workflow.apiModel!,
      workflow.deterministicTestModel!,
      provider,
      {
        onPlan: (total) => {
          const current = getCurrentWorkflow()!.stages.aiEnhancement.progress;
          const generatingSince = current?.generatingSince ?? new Date().toISOString();
          setAiEnhancementProgress({
            totalBatches: total,
            batches: Array.from({ length: total }, (_, index) => ({
              index,
              status: "pending" as const,
            })),
            startedAt: current?.startedAt ?? new Date().toISOString(),
            phase: current?.phase ?? "generating",
            generatingSince,
            cancelRequested: current?.cancelRequested ?? false,
            runBudgetRemainingMs: Math.max(
              0,
              runBudgetMs - (Date.now() - new Date(generatingSince).getTime()),
            ),
          });
        },
        isCancelled: () => isAiEnhancementCancelRequested(),
        onPrepared: () => {
          // The engine is loaded; everything from here is generation, and elapsed time shown to
          // the user is measured from this moment rather than from the request, so a large
          // one-time model download is not misreported as slow inference (FR-022).
          markAiEnhancementGenerating();
        },
        onBatchStart: (index, total) => {
          const current = getCurrentWorkflow()!.stages.aiEnhancement.progress;
          setAiEnhancementProgress(
            withBatchPatched(
              current,
              total,
              index,
              { index, status: "in-progress" },
              runBudgetMs,
            ),
          );
        },
        onBatchRetry: (index, total) => {
          const current = getCurrentWorkflow()!.stages.aiEnhancement.progress;
          setAiEnhancementProgress(
            withBatchPatched(
              current,
              total,
              index,
              { index, status: "retrying" },
              runBudgetMs,
            ),
          );
        },
        onBatchComplete: (
          index,
          total,
          outcome: BatchOutcome,
          newlyRetainedScenarios,
          operationKeys,
        ) => {
          const current = getCurrentWorkflow()!.stages.aiEnhancement.progress;
          // `not-attempted` is reported as itself rather than folded into `failed`: the run
          // ceiling or a cancellation stopped it from ever being sent, and nothing about it went
          // wrong (specs/014-ai-batching-policy contracts/run-budget.md).
          const batchStatus =
            outcome.status === "success"
              ? "succeeded"
              : outcome.status === "not-attempted"
                ? "not-attempted"
                : "failed";
          setAiEnhancementProgress(
            withBatchPatched(
              current,
              total,
              index,
              {
                index,
                status: batchStatus,
                errorCategory:
                  outcome.status === "failed" ? outcome.errorCategory : undefined,
              },
              runBudgetMs,
            ),
          );
          // Persisted past settling, unlike `progress` above — what a later single-batch retry
          // reads (specs/015-ai-batch-retry FR-001).
          setAiEnhancementBatchOutcome(
            buildBatchOutcomeRecord(index, operationKeys, outcome),
          );

          if (newlyRetainedScenarios.length === 0) return;
          const workspace = getCurrentWorkflow()!.reviewWorkspace!;
          const existingIds = new Set(workspace.scenarios.map((s) => s.scenarioId));
          const added = newlyAddedReviewScenarios(
            { scenarios: newlyRetainedScenarios },
            existingIds,
          );
          if (added.length === 0) return;
          const scenarios = [...workspace.scenarios, ...added];
          patchWorkflow({
            reviewWorkspace: {
              ...workspace,
              scenarios,
              summary: computeReviewSummary(scenarios, workspace.policy),
            },
          });
        },
      },
    );
    // Read the cancellation flag before clearing progress, so a cancelled run can be reported as
    // cancelled rather than as a failure (FR-021). Cancellation resolves to the existing
    // skipped/partial statuses with a marker, introducing no new StageStatus member and so
    // leaving specs/011's outcome semantics intact (FR-016, research.md Decision 10).
    const wasCancelled = isAiEnhancementCancelRequested();
    // Captured before `progress` is cleared below: it is the only record of how many units the run
    // planned, which a ceiling-truncated run needs in order to say what fraction it covered.
    const plannedUnitCount =
      getCurrentWorkflow()?.stages.aiEnhancement.progress?.totalBatches;
    patchWorkflow({ aiEnhancement: result });
    setAiEnhancementProgress(undefined);

    /**
     * The user-facing account of a non-success outcome for this run (FR-023).
     *
     * A pre-flight refusal takes precedence over every other cause: nothing failed and nothing was
     * attempted, so describing it as a provider error would be wrong. It carries the projected and
     * allowed durations so the message can say what was needed versus what was permitted, in
     * human-readable units (FR-014).
     */
    const explainOutcome = () => {
      if (result.notViable) {
        return explainFailure("not-viable", {
          projectedMs: result.notViable.projectedMs,
          budgetMs: result.notViable.budgetMs,
        });
      }
      if (wasCancelled) return explainFailure("cancelled");
      // The ceiling outranks the aggregated provider category: with units the run never started,
      // `aiErrorCategory` describes whichever unit happened to fail last, not why the run stopped.
      // Telling the user "the model replied with unusable output" when the real answer is "it ran
      // out of its time allowance after 7 of 39 operations" sends them to fix the wrong thing.
      if (result.runBudgetExhausted) {
        return explainFailure("run-budget-exhausted", {
          budgetMs: result.runBudgetExhausted.budgetMs,
          notStartedCount: result.runBudgetExhausted.notStartedCount,
          plannedCount: plannedUnitCount,
          attemptedOperations: result.runBudgetExhausted.attemptedOperations,
          totalOperations: result.runBudgetExhausted.totalOperations,
        });
      }
      return explainFailure(
        (result.aiErrorCategory ?? "INVALID_RESPONSE") as FailureCause,
        { partialRun: result.aiProviderOutcome === "partial" },
      );
    };

    if (
      result.aiProviderOutcome === "success" ||
      result.aiProviderOutcome === "partial"
    ) {
      updateStage(
        "aiEnhancement",
        result.aiProviderOutcome === "success" ? "complete" : "partial",
        result.aiProviderOutcome === "partial"
          ? {
              aiErrorCategory: wasCancelled ? undefined : result.aiErrorCategory,
              aiErrorMessage: result.aiErrorMessage,
              failureExplanation: explainOutcome(),
              cancelled: wasCancelled || undefined,
            }
          : {},
      );
      // reviewWorkspace already reflects the deterministic baseline plus every successful
      // batch's scenarios, built up incrementally above as each batch completed — nothing left
      // to seed or append here (and re-seeding from `result.enhancedTestModel` would discard any
      // review decision the user already made on an early-revealed scenario, violating FR-012).
      const advanced = advanceActiveStage("scenarioReview");
      logger.info("stage_complete", {
        stage: "aiEnhancement",
        workflowId: advanced.id,
        outcome: result.aiProviderOutcome,
        scenarioCount: result.enhancedTestModel.scenarios.length,
        durationMs: Date.now() - startedAt,
      });
      return advanced;
    }

    updateStage("aiEnhancement", "skipped", {
      aiErrorCategory: wasCancelled ? undefined : result.aiErrorCategory,
      aiErrorMessage: result.aiErrorMessage,
      failureExplanation: explainOutcome(),
      cancelled: wasCancelled || undefined,
    });
    if (!isRetry) {
      const advanced = advanceActiveStage("scenarioReview");
      logger.info("stage_complete", {
        stage: "aiEnhancement",
        workflowId: advanced.id,
        outcome: "skipped",
        errorCategory: result.aiErrorCategory,
        durationMs: Date.now() - startedAt,
      });
      return advanced;
    }
    const current = getCurrentWorkflow()!;
    logger.info("stage_complete", {
      stage: "aiEnhancement",
      workflowId: current.id,
      outcome: "skipped",
      errorCategory: result.aiErrorCategory,
      durationMs: Date.now() - startedAt,
    });
    return current;
  } catch (error) {
    if (progressSetByThisCall && getCurrentWorkflow()) {
      setAiEnhancementProgress(undefined);
    }
    logger.error("stage_error", {
      stage: "aiEnhancement",
      workflowId: getCurrentWorkflow()?.id,
      errorCategory: error instanceof Error ? error.name : "UNKNOWN",
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

/** `"METHOD /path"` -> the matching `ApiOperation`, or throws if the workflow's apiModel has none. */
function resolveOperationByKey(
  workflow: TestGenerationWorkflow,
  key: string,
): NonNullable<TestGenerationWorkflow["apiModel"]>["operations"][number] {
  const [method, ...pathParts] = key.split(" ");
  const opPath = pathParts.join(" ");
  const operation = workflow.apiModel!.operations.find(
    (op) => op.method.toUpperCase() === method && op.path === opPath,
  );
  if (!operation) {
    // Cannot happen for a workflow whose apiModel hasn't changed since the batch was recorded
    // (research.md Decision 2) — surfaced as a hard error rather than silently skipped, since a
    // silent skip would resend an incomplete batch without saying so (constitution XIV, XIX).
    throw new Error(`Operation for key "${key}" was not found in the current apiModel.`);
  }
  return operation;
}

/**
 * Recomputes the AI Enhancement stage's aggregate status from every current `batchOutcomes`
 * entry (specs/015-ai-batch-retry FR-012, `/speckit-clarify` 2026-09-08): `"complete"` once every
 * batch's terminal status is `"succeeded"`, otherwise `"partial"` — reusing the exact
 * `active -> complete`/`active -> partial` transitions whole-stage retry already exercises
 * (research.md Decision 3), so no new `StageStatus` or transition is introduced. When still
 * `"partial"`, the stage-level `aiErrorCategory`/`failureExplanation` are taken from the
 * highest-index batch that hasn't succeeded, mirroring `deriveAggregateOutcome`'s own
 * last-failure convention (requestBatching.ts).
 */
function recomputeAggregateStatus(): TestGenerationWorkflow {
  const outcomes = getCurrentWorkflow()!.stages.aiEnhancement.batchOutcomes ?? [];
  const allSucceeded = outcomes.every((o) => o.status === "succeeded");
  if (allSucceeded) {
    return updateStage("aiEnhancement", "complete");
  }
  const stillOutstanding = outcomes.filter((o) => o.status !== "succeeded");
  const representative = stillOutstanding[stillOutstanding.length - 1];
  return updateStage("aiEnhancement", "partial", {
    aiErrorCategory: representative?.errorCategory,
    failureExplanation: representative?.failureExplanation,
  });
}

/** Merges a successful batch retry's newly produced scenarios into `reviewWorkspace` (FR-004), via the same exact-scenario-ID path used for incremental reveal during a normal run. */
function mergeRetriedScenariosIntoWorkspace(
  newScenarios: ReviewScenario["scenario"][],
): void {
  if (newScenarios.length === 0) return;
  const workspace = getCurrentWorkflow()!.reviewWorkspace!;
  const existingIds = new Set(workspace.scenarios.map((s) => s.scenarioId));
  const added = newlyAddedReviewScenarios({ scenarios: newScenarios }, existingIds);
  if (added.length === 0) return;
  const scenarios = [...workspace.scenarios, ...added];
  patchWorkflow({
    reviewWorkspace: {
      ...workspace,
      scenarios,
      summary: computeReviewSummary(scenarios, workspace.policy),
    },
  });
}

/**
 * Appends a successful batch retry's scenarios/candidate tallies onto the run's existing
 * `EnhancementResult` (research.md Decision 7) rather than replacing it: a whole-stage run
 * overwrites `aiEnhancement` wholesale because it reprocesses every operation, but a batch retry
 * only ever covers one batch, so replacing the whole result would under-report every other
 * batch's already-retained scenarios in `AiEnhancementOutcomeSummary`.
 */
function appendRetryIntoEnhancementResult(
  result: Extract<Awaited<ReturnType<typeof retryOneBatch>>, { outcome: "succeeded" }>,
): void {
  const enhancement = getCurrentWorkflow()!.aiEnhancement;
  if (!enhancement) return;
  patchWorkflow({
    aiEnhancement: {
      ...enhancement,
      enhancedTestModel: {
        scenarios: [...enhancement.enhancedTestModel.scenarios, ...result.scenarios],
      },
      aiCandidates: {
        added: [...enhancement.aiCandidates.added, ...result.candidateOutcomes.added],
        deduplicated: [
          ...enhancement.aiCandidates.deduplicated,
          ...result.candidateOutcomes.deduplicated,
        ],
        rejected: [
          ...enhancement.aiCandidates.rejected,
          ...result.candidateOutcomes.rejected,
        ],
        nonExecutable: [
          ...enhancement.aiCandidates.nonExecutable,
          ...result.candidateOutcomes.nonExecutable,
        ],
      },
    },
  });
}

/**
 * Retries exactly one batch from the most recent AI Enhancement run
 * (specs/015-ai-batch-retry/contracts/ai-enhancement-retry-batch.md). Available only once the
 * stage has settled `"skipped"` or `"partial"` (never mid-run) and only for a batch whose own
 * `BatchOutcomeRecord.status` is not `"succeeded"` and whose `failureExplanation.retryable` is
 * not `false` (FR-002, FR-003) — the same retryable/non-retryable rule whole-stage retry already
 * uses (research.md Decision 4), evaluated per batch instead of per run.
 *
 * A successful retry adds only that batch's newly produced scenarios to `reviewWorkspace`
 * (FR-004); a repeat failure updates only that batch's own record (FR-005). Every other batch's
 * scenarios, review decisions, and record are left exactly as they were. Reuses the same
 * `progress`-presence concurrency guard as a whole-stage run (FR-007, research.md Decision 8).
 */
export async function retryAiEnhancementBatch(
  batchIndex: number,
  provider: AIProvider,
): Promise<TestGenerationWorkflow> {
  const startedAt = Date.now();
  let progressSetByThisCall = false;
  try {
    const workflow = getCurrentWorkflow();
    if (!workflow) {
      throw new StageNotActiveError("aiEnhancement is not the active stage.");
    }
    // FR-007: checked first and before any status transition below, with no `await` in between
    // — a concurrent call (whole-stage run, cancel, or another batch retry) must be detected by
    // this signal regardless of what status this call's own transition has already applied,
    // never mistaken for "wrong stage" (research.md Decision 8).
    if (workflow.stages.aiEnhancement.progress) {
      throw new AiEnhancementAlreadyRunningError();
    }
    const status = workflow.stages.aiEnhancement.status;
    if (status !== "skipped" && status !== "partial") {
      throw new StageNotActiveError(
        "A batch can only be retried once the AI enhancement run has settled as skipped or partial.",
      );
    }
    if (workflow.stages.scenarioReview.status === "complete") {
      throw new StageNotActiveError(
        "AI enhancement can no longer be retried: scenario review is already finalized.",
      );
    }
    const target = workflow.stages.aiEnhancement.batchOutcomes?.find(
      (o) => o.index === batchIndex,
    );
    if (!target) {
      throw new BatchNotFoundError(batchIndex);
    }
    if (target.status === "succeeded") {
      throw new BatchNotRetryableError(
        batchIndex,
        "already succeeded and cannot be retried.",
      );
    }
    if (target.failureExplanation?.retryable === false) {
      throw new BatchNotRetryableError(
        batchIndex,
        "cannot be retried: its failure reason is not retryable.",
      );
    }

    setAiEnhancementProgress({
      totalBatches: workflow.stages.aiEnhancement.batchOutcomes!.length,
      batches: [],
      startedAt: new Date().toISOString(),
      phase: "generating",
      generatingSince: new Date().toISOString(),
      cancelRequested: false,
    });
    progressSetByThisCall = true;
    updateStage("aiEnhancement", "active");

    const operations = target.operationKeys.map((key) =>
      resolveOperationByKey(workflow, key),
    );
    const requestId = `retry-batch${batchIndex}-${Date.now()}`;
    const result = await retryOneBatch(
      operations,
      workflow.apiModel!,
      workflow.deterministicTestModel!,
      provider,
      requestId,
      batchIndex,
    );

    setAiEnhancementProgress(undefined);

    if (result.outcome === "succeeded") {
      setAiEnhancementBatchOutcome({
        index: batchIndex,
        operationKeys: target.operationKeys,
        status: "succeeded",
      });
      mergeRetriedScenariosIntoWorkspace(result.scenarios);
      appendRetryIntoEnhancementResult(result);
    } else {
      setAiEnhancementBatchOutcome({
        index: batchIndex,
        operationKeys: target.operationKeys,
        status: "failed",
        errorCategory: result.errorCategory,
        failureExplanation: explainFailure(result.errorCategory as FailureCause, {
          partialRun: true,
        }),
      });
    }

    const settled = recomputeAggregateStatus();
    logger.info("batch_retry_settled", {
      stage: "aiEnhancement",
      workflowId: settled.id,
      batchIndex,
      outcome: result.outcome,
      errorCategory: result.outcome === "failed" ? result.errorCategory : undefined,
      durationMs: Date.now() - startedAt,
    });
    return settled;
  } catch (error) {
    if (progressSetByThisCall && getCurrentWorkflow()) {
      setAiEnhancementProgress(undefined);
    }
    logger.error("batch_retry_error", {
      stage: "aiEnhancement",
      workflowId: getCurrentWorkflow()?.id,
      batchIndex,
      errorCategory: error instanceof Error ? error.name : "UNKNOWN",
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
