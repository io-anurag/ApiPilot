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

export interface WorkflowStageState {
  stageId: WorkflowStageId;
  status: StageStatus;
  enteredAt?: string;
  completedAt?: string;
  /** Present only for aiEnhancement when status is "skipped" or "partial" (FR-008). */
  aiErrorCategory?: AIErrorCategory;
  aiErrorMessage?: string;
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
