import type {
  AIProvider,
  AiEnhancementProgress,
  BatchProgress,
  ReviewScenario,
  TestGenerationWorkflow,
  TestModel,
} from "@apipilot/shared-domain";
import {
  computeReviewSummary,
  createReviewWorkspace,
} from "../testDesign/reviewTestModel";
import { enhanceTestModel } from "../testDesign/enhanceTestModel";
import type { BatchOutcome } from "../ai/requestBatching";
import { loadAIConfig } from "../ai/modelConfig";
import { createLogger } from "../logger";
import {
  AiEnhancementAlreadyRunningError,
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
      : Array.from({ length: total }, (_, i) => ({ index: i, status: "pending" as const }));
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
      patchWorkflow({ reviewWorkspace: createReviewWorkspace(workflow.deterministicTestModel!) });
    }

    const result = await enhanceTestModel(
      workflow.apiModel!,
      workflow.deterministicTestModel!,
      provider,
      {
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
        onBatchComplete: (index, total, outcome: BatchOutcome, newlyRetainedScenarios) => {
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
                errorCategory: outcome.status === "failed" ? outcome.errorCategory : undefined,
              },
              runBudgetMs,
            ),
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
        });
      }
      return explainFailure((result.aiErrorCategory ?? "INVALID_RESPONSE") as FailureCause);
    };

    if (result.aiProviderOutcome === "success" || result.aiProviderOutcome === "partial") {
      updateStage(
        "aiEnhancement",
        result.aiProviderOutcome === "success" ? "complete" : "partial",
        result.aiProviderOutcome === "partial"
          ? {
              aiErrorCategory: result.aiErrorCategory,
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
      aiErrorCategory: result.aiErrorCategory,
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
