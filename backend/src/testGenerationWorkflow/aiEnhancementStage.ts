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
import { createLogger } from "../logger";
import { AiEnhancementAlreadyRunningError, StageNotActiveError } from "./errors";
import {
  advanceActiveStage,
  getCurrentWorkflow,
  patchWorkflow,
  setAiEnhancementProgress,
  updateStage,
} from "./workflowStore";

const logger = createLogger("testGenerationWorkflow.aiEnhancementStage");

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
): AiEnhancementProgress {
  const batches: BatchProgress[] =
    progress && progress.totalBatches === total
      ? progress.batches.slice()
      : Array.from({ length: total }, (_, i) => ({ index: i, status: "pending" as const }));
  batches[index] = patch;
  return {
    totalBatches: total,
    batches,
    startedAt: progress?.startedAt ?? new Date().toISOString(),
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
    setAiEnhancementProgress({ totalBatches: 0, batches: [], startedAt: new Date().toISOString() });
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
        onBatchStart: (index, total) => {
          const current = getCurrentWorkflow()!.stages.aiEnhancement.progress;
          setAiEnhancementProgress(
            withBatchPatched(current, total, index, { index, status: "in-progress" }),
          );
        },
        onBatchComplete: (index, total, outcome: BatchOutcome, newlyRetainedScenarios) => {
          const current = getCurrentWorkflow()!.stages.aiEnhancement.progress;
          const batchStatus = outcome.status === "success" ? "succeeded" : "failed";
          setAiEnhancementProgress(
            withBatchPatched(current, total, index, {
              index,
              status: batchStatus,
              errorCategory: outcome.status === "failed" ? outcome.errorCategory : undefined,
            }),
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
    patchWorkflow({ aiEnhancement: result });
    setAiEnhancementProgress(undefined);

    if (result.aiProviderOutcome === "success" || result.aiProviderOutcome === "partial") {
      updateStage(
        "aiEnhancement",
        result.aiProviderOutcome === "success" ? "complete" : "partial",
        result.aiProviderOutcome === "partial"
          ? {
              aiErrorCategory: result.aiErrorCategory,
              aiErrorMessage: result.aiErrorMessage,
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
