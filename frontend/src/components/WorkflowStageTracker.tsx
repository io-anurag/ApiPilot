import { useEffect, useRef } from "react";
import {
  WORKFLOW_STAGE_ORDER,
  type StageStatus,
  type TestGenerationWorkflow,
  type WorkflowStageId,
} from "@apipilot/shared-domain";
import { StatusBadge, type StatusTone } from "./StatusBadge";

function CheckIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className}>
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 010 1.415l-7.5 7.5a1 1 0 01-1.415 0l-3.5-3.5a1 1 0 111.415-1.415L8.5 12.086l6.79-6.79a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** Chip container styling per stage status — border/background echo the StatusBadge tone so the
 * whole chip reads as a unit; the badge's text remains the sole load-bearing signal (FR-016). */
const CHIP_TONE_CLASSES: Record<StageStatus, string> = {
  "not-yet-reached": "border-transparent bg-surface",
  active: "border-brand-300 bg-brand-50",
  complete: "border-transparent bg-success-50",
  stale: "border-warning-300 bg-warning-50",
  skipped: "border-transparent bg-slate-50",
  partial: "border-warning-300 bg-warning-50",
};

const INDEX_TONE_CLASSES: Record<StageStatus, string> = {
  "not-yet-reached": "bg-slate-200 text-slate-600",
  active: "bg-brand-600 text-white",
  complete: "bg-success-600 text-white",
  stale: "bg-warning-500 text-white",
  skipped: "bg-slate-300 text-slate-600",
  partial: "bg-warning-500 text-white",
};

const STAGE_LABELS: Record<WorkflowStageId, string> = {
  upload: "Upload",
  analysis: "Analysis",
  apiReview: "API Review",
  deterministicGeneration: "Deterministic Generation",
  aiEnhancement: "AI Enhancement",
  scenarioReview: "Scenario Review",
  dependencyAnalysis: "Dependency Analysis",
  workflowReview: "Workflow Review",
  postmanGeneration: "Postman Generation",
};

const STATUS_LABELS: Record<StageStatus, string> = {
  "not-yet-reached": "Not yet reached",
  active: "Active",
  complete: "Complete",
  stale: "Needs to be redone",
  skipped: "Skipped",
  partial: "Partially completed",
};

const STATUS_TONES: Record<StageStatus, StatusTone> = {
  "not-yet-reached": "neutral",
  active: "info",
  complete: "success",
  stale: "warning",
  skipped: "neutral",
  partial: "warning",
};

/** The only stages a QA engineer can revisit to revise a decision (research.md D3). */
export const REVISABLE_STAGES = new Set<WorkflowStageId>([
  "scenarioReview",
  "workflowReview",
]);

const READ_ONLY_VIEWABLE_STATUSES = new Set<StageStatus>([
  "complete",
  "stale",
  "skipped",
  "partial",
]);

/**
 * Shows every stage's status (User Story 2, FR-004) and any workflow-level condition worth
 * surfacing outside the active stage's own screen — analysis issues and dependency-analysis
 * AI-unavailability. The AI-enhancement-skipped notice is deliberately NOT shown here: it lives
 * solely in AiEnhancementStage's skip banner, which also carries the retry action (FR-013,
 * research.md D6) — showing it here too would duplicate it.
 */
export function WorkflowStageTracker({
  workflow,
  onViewStage,
  viewedStageId,
}: Readonly<{
  workflow: TestGenerationWorkflow;
  onViewStage?: (stageId: WorkflowStageId) => void;
  viewedStageId?: WorkflowStageId | null;
}>) {
  const issues = workflow.apiModel?.summary.issues ?? [];
  const dependencyAiIssue = workflow.dependencyAnalysis?.aiErrorCategory;
  const activeStageRef = useRef<HTMLLIElement | null>(null);

  // The stage list scrolls horizontally, so the active stage can start off-screen (e.g. on
  // initial load once several stages are already complete). Keep it in view automatically
  // instead of requiring the user to scroll the strip manually.
  useEffect(() => {
    activeStageRef.current?.scrollIntoView?.({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [workflow.activeStageId]);

  return (
    <nav
      aria-label="Workflow progress"
      data-testid="workflow-stage-tracker"
      className="space-y-3 overflow-hidden"
    >
      <ol className="flex gap-1 overflow-x-auto pb-1">
        {WORKFLOW_STAGE_ORDER.map((stageId, index) => {
          const stage = workflow.stages[stageId];
          const isActive = workflow.activeStageId === stageId;
          // The stage currently shown on screen — the active stage by default, or whichever
          // stage the user clicked "back"/"view" to revisit (viewedStageId, when the caller
          // tracks it). Distinct from `isActive`: revisiting a completed stage must move this
          // chip's highlight there too, not leave it stuck on the true active stage.
          const isCurrentlyViewed =
            viewedStageId !== undefined && viewedStageId !== null
              ? viewedStageId === stageId
              : isActive;
          const isViewingAnotherStage =
            !!onViewStage &&
            viewedStageId !== null &&
            viewedStageId !== workflow.activeStageId;
          const isRevisitable =
            !!onViewStage &&
            REVISABLE_STAGES.has(stageId) &&
            (stage.status === "complete" || stage.status === "stale");
          const isReadOnlyViewable =
            !!onViewStage &&
            !isActive &&
            !REVISABLE_STAGES.has(stageId) &&
            READ_ONLY_VIEWABLE_STATUSES.has(stage.status);
          const isReturnToActiveView = isActive && isViewingAnotherStage;
          let actionLabel = "view";
          if (isReturnToActiveView) {
            actionLabel = "return";
          } else if (isRevisitable) {
            actionLabel = "revisit";
          }
          return (
            <li
              key={stageId}
              ref={isActive ? activeStageRef : undefined}
              aria-current={isCurrentlyViewed ? "step" : undefined}
              className={`flex min-w-max items-center gap-2 border px-2.5 py-2 text-xs transition-colors ${CHIP_TONE_CLASSES[stage.status]} ${isCurrentlyViewed ? "ring-2 ring-inset ring-brand-500 font-semibold text-slate-950" : "text-slate-600"}`}
            >
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${INDEX_TONE_CLASSES[stage.status]}`}
              >
                {stage.status === "complete" ? (
                  <CheckIcon className="h-3 w-3" />
                ) : (
                  index + 1
                )}
              </span>
              <span>{STAGE_LABELS[stageId]}</span>
              {isRevisitable || isReadOnlyViewable || isReturnToActiveView ? (
                <button
                  type="button"
                  data-testid={`stage-status-${stageId}`}
                  onClick={() => onViewStage!(stageId)}
                  className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <StatusBadge
                    label={`${STATUS_LABELS[stage.status]} — ${actionLabel}`}
                    tone={STATUS_TONES[stage.status]}
                  />
                </button>
              ) : (
                <span data-testid={`stage-status-${stageId}`}>
                  <StatusBadge
                    label={STATUS_LABELS[stage.status]}
                    tone={STATUS_TONES[stage.status]}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {issues.length > 0 && (
        <output
          data-testid="workflow-analysis-issues"
          className="block rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700"
        >
          <p>{issues.length} specification analysis issue(s) were found:</p>
          <ul className="ml-4 list-disc">
            {issues.map((issue) => (
              <li key={`${issue.kind}-${issue.location}`}>
                <strong>{issue.kind}</strong> at {issue.location}: {issue.message}
              </li>
            ))}
          </ul>
        </output>
      )}
      {dependencyAiIssue && (
        <output
          data-testid="workflow-dependency-ai-issue"
          className="block rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700"
        >
          AI-assisted dependency detection did not complete ({dependencyAiIssue});
          deterministic relationships are still shown.
        </output>
      )}
    </nav>
  );
}
