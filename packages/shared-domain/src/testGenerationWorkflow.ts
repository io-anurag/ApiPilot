import type { AIErrorCategory } from "./aiProvider";
import type { ApiModel } from "./apiModel";
import type { DependencyAnalysisResult } from "./apiDependency";
import type { EnhancementResult } from "./aiScenarioDesign";
import type { ExportResult } from "./postmanArtifact";
import type { ReviewWorkspace } from "./testScenarioReview";
import type { TestModel } from "./testModel";

/**
 * The nine guided-workflow stages, in fixed order (spec.md FR-001, Key Entities: Workflow
 * Stage). "upload" and "analysis" always complete together in one backend call (research.md D4).
 */
export type WorkflowStageId =
  | "upload"
  | "analysis"
  | "apiReview"
  | "deterministicGeneration"
  | "aiEnhancement"
  | "scenarioReview"
  | "dependencyAnalysis"
  | "workflowReview"
  | "postmanGeneration";

/** Single source of truth for stage order, iterated by gating and staleness computation. */
export const WORKFLOW_STAGE_ORDER: readonly WorkflowStageId[] = [
  "upload",
  "analysis",
  "apiReview",
  "deterministicGeneration",
  "aiEnhancement",
  "scenarioReview",
  "dependencyAnalysis",
  "workflowReview",
  "postmanGeneration",
];

/** data-model.md: StageStatus. `skipped` and `partial` apply only to `aiEnhancement`. */
export type StageStatus =
  "not-yet-reached" | "active" | "complete" | "stale" | "skipped" | "partial";

/**
 * The per-batch status of one AI enhancement run, as known at the moment a client polls
 * (specs/012-ai-enhancement-progress/data-model.md: BatchProgress). "not-attempted"
 * (specs/011-ai-prompt-batching's BatchOutcome) is not applicable here — scenario enhancement
 * has no overall wall-clock budget (specs/011 research.md Decision 5), so every batch is
 * always attempted.
 */
export interface BatchProgress {
  index: number;
  status: "pending" | "in-progress" | "succeeded" | "failed";
  /** Present only when status is "failed". */
  errorCategory?: AIErrorCategory;
}

/**
 * Which activity an in-flight run is currently spending time on
 * (specs/013-ai-enhancement-viability/data-model.md). Distinguishing these is what makes a long
 * first-run wait attributable rather than mysterious: preparing the model can include a
 * multi-hundred-megabyte download, which previously appeared as an unexplained delay
 * indistinguishable from slow generation (FR-018).
 */
export type AiEnhancementPhase = "preparing" | "generating";

/**
 * The live state of one in-flight AI enhancement run (specs/012-ai-enhancement-progress/data-model.md:
 * AiEnhancementProgress). Present on WorkflowStageState only for the aiEnhancement stage, and
 * only while a run is active.
 *
 * Extended by specs/013-ai-enhancement-viability with `phase`, `generatingSince` and
 * `cancelRequested`. Note that specs/012 FR-005 (hide progress entirely when `totalBatches <= 1`)
 * is superseded for `phase`/elapsed time: that rule assumed single-batch runs were the fast path
 * not needing progress, but the context-window defect corrected by specs/013 had made
 * single-batch the *only* reachable case, so it suppressed progress for every real run. The
 * per-batch *list* is still not worth showing for a single batch.
 */
export interface AiEnhancementProgress {
  totalBatches: number;
  batches: BatchProgress[];
  startedAt: string;
  /**
   * Current activity. Transitions one way only (`preparing` -> `generating`) and never returns;
   * `totalBatches` is 0 while preparing, because batch planning needs the loaded engine's
   * capacity.
   */
  phase: AiEnhancementPhase;
  /**
   * When `phase` first became `generating`; present if and only if `phase` is `generating`, and
   * never earlier than `startedAt`. Clients derive elapsed time from this rather than the server
   * pushing a ticking value, which would make every poll response differ.
   */
  generatingSince?: string;
  /** True once a cancellation has been accepted. Transitions false -> true only. */
  cancelRequested: boolean;
}

/**
 * The kind of non-success outcome, as the user understands it rather than as the system
 * classifies it internally (specs/013-ai-enhancement-viability/contracts/failure-explanation.md).
 * Deliberately not the same set as `AIErrorCategory`: several internal categories collapse to one
 * user-facing kind, and two entries (`not-viable`, `cancelled`) have no `AIErrorCategory` at all.
 */
export type FailureExplanationCategory =
  | "too-slow"
  | "not-viable"
  | "unavailable"
  | "unusable-output"
  | "too-large"
  | "cancelled";

/**
 * What the user is told when AI enhancement does not succeed, kept deliberately separate from
 * `aiErrorMessage`, which retains internal diagnostic text for logs only (constitution XX).
 *
 * `summary` and `nextStep` must never contain an error-class name, an `AIErrorCategory` literal,
 * an environment variable name, a file path, a model identifier, or a raw millisecond value
 * (FR-024) — the message this replaces leaked three of those at once.
 */
export interface FailureExplanation {
  category: FailureExplanationCategory;
  /** One plain-language sentence describing what happened. */
  summary: string;
  /** A concrete action the user can take. */
  nextStep: string;
  /**
   * Whether a retry could plausibly produce a different outcome. False for `too-slow`,
   * `not-viable` and `too-large`, where the same conditions deterministically repeat — offering
   * a retry there costs the user the whole timeout again for nothing (FR-025).
   */
  retryable: boolean;
}

export interface WorkflowStageState {
  stageId: WorkflowStageId;
  status: StageStatus;
  enteredAt?: string;
  completedAt?: string;
  /** Present only for aiEnhancement when status is "skipped" or "partial" (FR-008). */
  aiErrorCategory?: AIErrorCategory;
  /**
   * Internal diagnostic detail. Shape unchanged, but as of specs/013-ai-enhancement-viability
   * the audience is narrowed to logs and support: clients render `failureExplanation` instead.
   */
  aiErrorMessage?: string;
  /**
   * Present only for aiEnhancement while a run is actively in progress; absent once the run
   * reaches a terminal status (specs/012-ai-enhancement-progress FR-006/FR-007).
   */
  progress?: AiEnhancementProgress;
  /**
   * Present only for aiEnhancement when status is "skipped" or "partial" — what the user reads
   * (specs/013-ai-enhancement-viability FR-023).
   */
  failureExplanation?: FailureExplanation;
  /**
   * True when a terminal `skipped`/`partial` resulted from the user cancelling rather than from a
   * failure. Carried as a marker rather than a new `StageStatus` member so that the outcome
   * semantics established by specs/011-ai-prompt-batching stay intact (FR-016, FR-030).
   */
  cancelled?: boolean;
}

/** data-model.md: WorkflowReviewDecision — mirrors ReviewState/ReviewDecision (research.md D5). */
export type WorkflowReviewState = "pending" | "approved" | "rejected";

export interface WorkflowReviewDecision {
  workflowId: string;
  state: WorkflowReviewState;
  reason?: string;
  recordedAt: string;
}

/**
 * The single global orchestration record (FR-018). At most one exists at a time — see
 * `workflowStore.ts` in the backend, the only place a `TestGenerationWorkflow` is created.
 */
export interface TestGenerationWorkflow {
  id: string;
  createdAt: string;
  updatedAt: string;
  activeStageId: WorkflowStageId;
  stages: Record<WorkflowStageId, WorkflowStageState>;

  specificationFilename: string;
  apiModel?: ApiModel;

  deterministicTestModel?: TestModel;
  aiEnhancement?: EnhancementResult;

  reviewWorkspace?: ReviewWorkspace;
  approvedTestModel?: TestModel;

  dependencyAnalysis?: DependencyAnalysisResult;
  workflowDecisions?: Record<string, WorkflowReviewDecision>;
  approvedWorkflowIds?: string[];

  postmanArtifact?: ExportResult;
}
