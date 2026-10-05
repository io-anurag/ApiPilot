import { useEffect, useRef } from "react";
import {
  WORKFLOW_STAGE_ORDER,
  type StageStatus,
  type TestGenerationWorkflow,
  type WorkflowStageId,
} from "@apipilot/shared-domain";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import { STAGE_LABELS, getLockReason } from "./workflowStageViewModel";
import { STAGE_SECTIONS } from "./sectionCatalog";

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

function StageIcon({ stageId }: Readonly<{ stageId: WorkflowStageId }>) {
  const icons: Record<WorkflowStageId, React.ReactNode> = {
    upload: <path d="M12 16V4m0 0L8 8m4-4l4 4M5 14v5h14v-5" />,
    analysis: (
      <>
        <circle cx="11" cy="11" r="6" />
        <path d="m16 16 4 4" />
      </>
    ),
    apiReview: (
      <>
        <path d="M8 5 4 12l4 7M16 5l4 7-4 7M10 15l4-6" />
      </>
    ),
    deterministicGeneration: (
      <>
        <path d="M6 5h12v14H6zM9 9h6M9 12h6M9 15h4" />
      </>
    ),
    aiEnhancement: (
      <>
        <path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3z" />
      </>
    ),
    scenarioReview: (
      <>
        <path d="M6 4h12v16H6zM9 9l1.5 1.5L14 7M9 15l1.5 1.5L14 13" />
      </>
    ),
    dependencyAnalysis: (
      <>
        <circle cx="6" cy="7" r="2" />
        <circle cx="18" cy="7" r="2" />
        <circle cx="12" cy="17" r="2" />
        <path d="m7.7 8.2 2.6 6M16.3 8.2l-2.6 6M8 7h8" />
      </>
    ),
    workflowReview: (
      <>
        <path d="M5 6h14v12H5zM8 10h8M8 14h5" />
        <path d="m16 3 2 2" />
      </>
    ),
    postmanGeneration: (
      <>
        <path d="M7 3h7l4 4v14H7zM14 3v5h4M10 12h5M10 15h5" />
      </>
    ),
    execution: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m10 8 6 4-6 4z" />
      </>
    ),
    performanceTesting: (
      <>
        <path d="M5 18V9m5 9V5m5 13v-7m5 7V7" />
      </>
    ),
  };

  return (
    <svg
      data-testid={`stage-icon-${stageId}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-300"
      aria-hidden="true"
    >
      {icons[stageId]}
    </svg>
  );
}

/** Chip container styling per stage status — border/background echo the StatusBadge tone so the
 * whole chip reads as a unit; the badge's text remains the sole load-bearing signal (FR-016). */
const CHIP_TONE_CLASSES: Record<StageStatus, string> = {
  "not-yet-reached": "border-transparent bg-surface",
  active: "border-brand-300 bg-brand-50 dark:border-brand-500 dark:bg-brand-500/15",
  complete: "border-transparent bg-success-50 dark:bg-success-500/15",
  stale:
    "border-warning-300 bg-warning-50 dark:border-warning-500 dark:bg-warning-500/15",
  skipped: "border-transparent bg-surface-subtle",
  partial:
    "border-warning-300 bg-warning-50 dark:border-warning-500 dark:bg-warning-500/15",
};

const INDEX_TONE_CLASSES: Record<StageStatus, string> = {
  "not-yet-reached": "bg-surface-strong text-text-secondary",
  active: "bg-brand-600 text-white",
  complete: "bg-success-600 text-white",
  stale: "bg-warning-600 text-white",
  skipped: "bg-border-strong text-text-primary",
  partial: "bg-warning-600 text-white",
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
  // The upload/analysis/apiReview screens already render these same issues via AnalysisSummary,
  // right alongside the operation/schema counts they're actually about — showing this tracker-
  // level banner too, on exactly those screens, duplicated the same list twice on one page. Per
  // this component's own purpose ("worth surfacing outside the active stage's own screen"), the
  // banner now only appears on every *other* stage, where nothing else already shows them.
  const currentlyDisplayedStageId = viewedStageId ?? workflow.activeStageId;
  const analysisIssuesShownElsewhereOnThisScreen =
    currentlyDisplayedStageId === "upload" ||
    currentlyDisplayedStageId === "analysis" ||
    currentlyDisplayedStageId === "apiReview";
  // Only a genuine full-failure outcome belongs in this blanket "did not complete" banner.
  // "partial" means some batches DID succeed — that nuance (and the accurate, outcome-specific
  // wording backend already provides via aiErrorMessage) is what DependencyAnalysisSummary shows
  // instead; repeating it here as "did not complete" would misreport a partially-successful run
  // as a total one.
  const dependencyAiFullFailure =
    workflow.dependencyAnalysis?.aiOutcome === "unavailable" ||
    workflow.dependencyAnalysis?.aiOutcome === "timeout" ||
    workflow.dependencyAnalysis?.aiOutcome === "invalid-response";
  const dependencyAiIssue = dependencyAiFullFailure
    ? workflow.dependencyAnalysis?.aiErrorCategory
    : undefined;
  const activeStageRef = useRef<HTMLLIElement | null>(null);

  // The stage list scrolls horizontally, so the active stage can start off-screen (e.g. on
  // initial load once several stages are already complete). Keep it in view automatically
  // instead of requiring the user to scroll the strip manually. A JS-triggered smooth scroll
  // isn't covered by index.css's CSS-only prefers-reduced-motion rule (FR-015), so it's checked
  // here explicitly.
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    activeStageRef.current?.scrollIntoView?.({
      behavior: prefersReducedMotion ? "auto" : "smooth",
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
          // A workflow recorded before a stage existed (AP-029 added `performanceTesting`) simply
          // has not reached it.
          const stage = workflow.stages[stageId] ?? {
            stageId,
            status: "not-yet-reached" as const,
          };
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
          const lockReason =
            stage.status === "not-yet-reached"
              ? getLockReason(stageId, workflow)
              : undefined;
          // AP-029 (research D1): the optional performance stage can be opened as soon as Postman
          // Generation is complete, before it has ever been entered and whatever Execution's state.
          const isOpenable =
            !!onViewStage &&
            stageId === "performanceTesting" &&
            stage.status === "not-yet-reached" &&
            lockReason === undefined &&
            !isCurrentlyViewed;
          let actionLabel = "view";
          if (isReturnToActiveView) {
            actionLabel = "return";
          } else if (isRevisitable) {
            actionLabel = "revisit";
          } else if (isOpenable) {
            actionLabel = "open";
          }
          return (
            <li
              key={stageId}
              ref={isActive ? activeStageRef : undefined}
              aria-current={isCurrentlyViewed ? "step" : undefined}
              // AP-041: the chip takes its stage's section accent (icon, current-step ring). Its
              // tint and badge stay status-coloured, so section and status never share a colour.
              data-section={STAGE_SECTIONS[stageId]}
              className={`flex min-w-max items-center gap-2 border px-2.5 py-2 text-xs transition-colors ${CHIP_TONE_CLASSES[stage.status]} ${isCurrentlyViewed ? "ring-2 ring-inset ring-brand-500 font-semibold text-text-primary" : "text-text-secondary"}`}
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
              <StageIcon stageId={stageId} />
              <span>{STAGE_LABELS[stageId]}</span>
              {isRevisitable ||
              isReadOnlyViewable ||
              isReturnToActiveView ||
              isOpenable ? (
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
                    label={
                      lockReason
                        ? `${STATUS_LABELS[stage.status]} — ${lockReason}`
                        : STATUS_LABELS[stage.status]
                    }
                    tone={STATUS_TONES[stage.status]}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {issues.length > 0 && !analysisIssuesShownElsewhereOnThisScreen && (
        // Collapsed by default (native <details>, no extra JS state needed): a specification
        // with hundreds of issues previously rendered its entire list inline here, at the
        // tracker's top level — tall enough to push the actual active stage below the fold on
        // every visit. The count is still always visible; the full list is one click away.
        <details
          data-testid="workflow-analysis-issues"
          className="rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:border-warning-500 dark:bg-warning-500/10 dark:text-warning-100"
        >
          <summary className="cursor-pointer font-medium marker:text-warning-500">
            {issues.length} specification analysis issue{issues.length === 1 ? "" : "s"}{" "}
            found — click to expand
          </summary>
          <ul className="mt-2 ml-4 max-h-64 list-disc space-y-1 overflow-y-auto pr-2">
            {issues.map((issue) => (
              <li key={`${issue.kind}-${issue.location}`}>
                <strong>{issue.kind}</strong> at {issue.location}: {issue.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      {dependencyAiIssue && (
        <output
          data-testid="workflow-dependency-ai-issue"
          className="block rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:border-warning-500 dark:bg-warning-500/10 dark:text-warning-100"
        >
          AI-assisted dependency detection did not complete ({dependencyAiIssue});
          deterministic relationships are still shown.
        </output>
      )}
    </nav>
  );
}
