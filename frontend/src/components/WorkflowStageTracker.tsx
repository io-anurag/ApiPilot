import { useState } from "react";
import {
  WORKFLOW_STAGE_ORDER,
  type StageStatus,
  type TestGenerationWorkflow,
  type WorkflowStageId,
} from "@apipilot/shared-domain";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import {
  STAGE_LABELS,
  WORKFLOW_PHASES,
  getLockReason,
  getPhaseOfStage,
  getPhaseProgress,
  type PhaseStatus,
  type WorkflowPhase,
  type WorkflowPhaseId,
} from "./workflowStageViewModel";
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
      className="h-4 w-4 shrink-0 text-brand-500"
      aria-hidden="true"
    >
      {icons[stageId]}
    </svg>
  );
}

/**
 * Chip container styling per stage status. Every class resolves through a theme-aware token, so the
 * same classes serve light and dark: no `dark:` overrides, hence the same hues in both themes. The
 * badge text remains the sole load-bearing signal (FR-016).
 */
const CHIP_TONE_CLASSES: Record<StageStatus, string> = {
  "not-yet-reached": "border-dashed border-border-strong bg-surface-subtle text-muted",
  active: "border-brand-600/40 bg-brand-600/10",
  complete: "border-success-600/30 bg-success-600/10",
  stale: "border-warning-600/40 bg-warning-600/10",
  skipped: "border-border bg-surface-subtle",
  partial: "border-warning-600/40 bg-warning-600/10",
};

/** Phase tile styling, from the same tokens (and the same no-`dark:` rule) as the chips. */
const PHASE_TONE_CLASSES: Record<PhaseStatus, string> = {
  complete: "border-success-600/30 bg-success-600/10",
  "in-progress": "border-brand-600/30 bg-brand-600/10",
  attention: "border-warning-600/40 bg-warning-600/10",
  locked: "border-dashed border-border-strong bg-surface-subtle text-muted",
};

const PHASE_INDEX_CLASSES: Record<PhaseStatus, string> = {
  complete: "bg-success-600 text-white",
  "in-progress": "bg-brand-600 text-white",
  attention: "bg-warning-600 text-white",
  locked: "bg-surface-strong text-text-secondary",
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
  // Which phase's sub-stages are listed. By default the phase of the stage on screen; a tile click
  // overrides that for as long as the stage on screen stays in the same phase, so moving to another
  // phase snaps the tracker back to following the workflow instead of staying stuck.
  const currentPhase = getPhaseOfStage(currentlyDisplayedStageId);
  const [override, setOverride] = useState<{
    followedPhaseId: WorkflowPhaseId;
    expanded: WorkflowPhaseId | null;
  } | null>(null);
  const expandedPhaseId =
    override?.followedPhaseId === currentPhase.id ? override.expanded : currentPhase.id;
  const expandedPhase = WORKFLOW_PHASES.find((phase) => phase.id === expandedPhaseId);
  const togglePhase = (phaseId: WorkflowPhaseId) =>
    setOverride({
      followedPhaseId: currentPhase.id,
      expanded: expandedPhaseId === phaseId ? null : phaseId,
    });
  const currentStepNumber = WORKFLOW_STAGE_ORDER.indexOf(currentlyDisplayedStageId) + 1;

  const renderStage = (stageId: WorkflowStageId) => {
    // A workflow recorded before a stage existed (AP-029 added `performanceTesting`) simply has not
    // reached it.
    const stage = workflow.stages[stageId] ?? {
      stageId,
      status: "not-yet-reached" as const,
    };
    const isActive = workflow.activeStageId === stageId;
    // The stage currently shown on screen — the active stage by default, or whichever stage the
    // user clicked "back"/"view" to revisit (viewedStageId, when the caller tracks it). Distinct
    // from `isActive`: revisiting a completed stage must move this chip's highlight there too, not
    // leave it stuck on the true active stage.
    const isCurrentlyViewed = currentlyDisplayedStageId === stageId;
    const isViewingAnotherStage =
      !!onViewStage && viewedStageId !== null && viewedStageId !== workflow.activeStageId;
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
      stage.status === "not-yet-reached" ? getLockReason(stageId, workflow) : undefined;
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
    const lockReasonId = `stage-lock-reason-${stageId}`;
    const badge = (label: string) => (
      <StatusBadge label={label} tone={STATUS_TONES[stage.status]} />
    );
    let status: React.ReactNode;
    if (isRevisitable || isReadOnlyViewable || isReturnToActiveView || isOpenable) {
      status = (
        <button
          type="button"
          data-testid={`stage-status-${stageId}`}
          onClick={() => onViewStage!(stageId)}
          className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {badge(`${STATUS_LABELS[stage.status]} — ${actionLabel}`)}
        </button>
      );
    } else if (lockReason) {
      // A locked stage is focusable so its reason is reachable by keyboard, not only on hover.
      status = (
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={lockReasonId}
          data-testid={`stage-status-${stageId}`}
          className="cursor-not-allowed rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {badge(STATUS_LABELS[stage.status])}
        </button>
      );
    } else {
      status = (
        <span data-testid={`stage-status-${stageId}`}>{badge(STATUS_LABELS[stage.status])}</span>
      );
    }
    return (
      <li
        key={stageId}
        aria-current={isCurrentlyViewed ? "step" : undefined}
        // AP-041: the chip takes its stage's section accent (icon, current-step ring). Its tint and
        // badge stay status-coloured, so section and status never share a colour.
        data-section={STAGE_SECTIONS[stageId]}
        className={`group relative flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${CHIP_TONE_CLASSES[stage.status]} ${isCurrentlyViewed ? "ring-2 ring-inset ring-brand-500 font-semibold text-text-primary" : "text-text-secondary"}`}
      >
        <StageIcon stageId={stageId} />
        <span>{STAGE_LABELS[stageId]}</span>
        {status}
        {lockReason && (
          <span
            id={lockReasonId}
            role="tooltip"
            data-testid={lockReasonId}
            className="pointer-events-none absolute top-full left-0 z-10 mt-1 hidden whitespace-nowrap rounded-md border border-border-strong bg-surface-elevated px-2 py-1 font-normal text-text-primary shadow-md group-focus-within:block group-hover:block"
          >
            {lockReason}
          </span>
        )}
      </li>
    );
  };

  const renderPhase = (phase: WorkflowPhase, index: number) => {
    const progress = getPhaseProgress(phase, workflow);
    const isCurrent = phase.id === currentPhase.id;
    const isExpanded = phase.id === expandedPhaseId;
    // The current tile takes the section of the stage on screen; the others that of their first
    // stage. The accent only colours the tile's index disc and ring, never its status tint.
    const section = STAGE_SECTIONS[isCurrent ? currentlyDisplayedStageId : phase.stages[0]];
    let summary = `${progress.doneCount} of ${progress.totalCount} done`;
    if (progress.status === "complete") {
      summary = "Complete";
    } else if (progress.status === "locked") {
      summary = "Locked";
    } else if (progress.status === "attention") {
      summary = "Needs to be redone";
    }
    return (
      <li
        key={phase.id}
        aria-current={isCurrent ? "step" : undefined}
        data-section={section}
        data-testid={`phase-tile-${phase.id}`}
        className="min-w-0"
      >
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={`phase-stages-${phase.id}`}
          onClick={() => togglePhase(phase.id)}
          className={`flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${PHASE_TONE_CLASSES[progress.status]} ${isCurrent ? "ring-2 ring-inset ring-brand-500 text-text-primary" : "text-text-secondary"}`}
        >
          <span
            aria-hidden="true"
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${PHASE_INDEX_CLASSES[progress.status]}`}
          >
            {progress.status === "complete" ? <CheckIcon className="h-3 w-3" /> : index + 1}
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">{phase.label}</span>
            <span className="block truncate text-muted">{summary}</span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <nav aria-label="Workflow progress" data-testid="workflow-stage-tracker" className="space-y-2">
      <div className="text-xs text-muted" data-testid="workflow-position">
        Step {currentStepNumber} of {WORKFLOW_STAGE_ORDER.length} · {currentPhase.label} ›{" "}
        {STAGE_LABELS[currentlyDisplayedStageId]}
      </div>
      <ol className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
        {WORKFLOW_PHASES.map(renderPhase)}
      </ol>
      {expandedPhase && (
        <ul
          id={`phase-stages-${expandedPhase.id}`}
          aria-label={`${expandedPhase.label} stages`}
          className="flex flex-wrap gap-1.5 border-t border-border pt-2"
        >
          {expandedPhase.stages.map(renderStage)}
        </ul>
      )}
      {issues.length > 0 && !analysisIssuesShownElsewhereOnThisScreen && (
        // Collapsed by default (native <details>, no extra JS state needed): a specification
        // with hundreds of issues previously rendered its entire list inline here, at the
        // tracker's top level — tall enough to push the actual active stage below the fold on
        // every visit. The count is still always visible; the full list is one click away.
        <details
          data-testid="workflow-analysis-issues"
          className="rounded-md border border-warning-600/40 bg-warning-600/10 px-3 py-2 text-sm text-text-primary"
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
          className="block rounded-md border border-warning-600/40 bg-warning-600/10 px-3 py-2 text-sm text-text-primary"
        >
          AI-assisted dependency detection did not complete ({dependencyAiIssue});
          deterministic relationships are still shown.
        </output>
      )}
    </nav>
  );
}
