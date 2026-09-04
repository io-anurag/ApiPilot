import {
  WORKFLOW_STAGE_ORDER,
  type StageStatus,
  type TestGenerationWorkflow,
  type WorkflowStageId,
} from "@apipilot/shared-domain";
import { StatusBadge, type StatusTone } from "./StatusBadge";

function CheckIcon({ className }: { className?: string }) {
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
  "not-yet-reached": "border-border bg-surface",
  active: "border-brand-300 bg-brand-50 shadow-sm",
  complete: "border-success-500/30 bg-success-50",
  stale: "border-warning-500/40 bg-warning-50",
  skipped: "border-border bg-slate-50",
  partial: "border-warning-500/40 bg-warning-50",
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

/**
 * Shows every stage's status (User Story 2, FR-004) and any workflow-level condition worth
 * surfacing outside the active stage's own screen — analysis issues and dependency-analysis
 * AI-unavailability. The AI-enhancement-skipped notice is deliberately NOT shown here: it lives
 * solely in AiEnhancementStage's skip banner, which also carries the retry action (FR-013,
 * research.md D6) — showing it here too would duplicate it.
 */
/** The only stages a QA engineer can revisit to revise a decision (research.md D3). */
const REVISABLE_STAGES = new Set<WorkflowStageId>(["scenarioReview", "workflowReview"]);

export function WorkflowStageTracker({
  workflow,
  onViewStage,
}: {
  workflow: TestGenerationWorkflow;
  onViewStage?: (stageId: WorkflowStageId) => void;
}) {
  const issues = workflow.apiModel?.summary.issues ?? [];
  const dependencyAiIssue = workflow.dependencyAnalysis?.aiErrorCategory;

  return (
    <nav
      aria-label="Workflow progress"
      data-testid="workflow-stage-tracker"
      className="space-y-3"
    >
      <ol className="flex flex-wrap gap-2">
        {WORKFLOW_STAGE_ORDER.map((stageId, index) => {
          const stage = workflow.stages[stageId];
          const isActive = workflow.activeStageId === stageId;
          const isRevisitable =
            onViewStage &&
            REVISABLE_STAGES.has(stageId) &&
            (stage.status === "complete" || stage.status === "stale");
          return (
            <li
              key={stageId}
              aria-current={isActive ? "step" : undefined}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${CHIP_TONE_CLASSES[stage.status]} ${isActive ? "font-semibold text-slate-900" : "text-slate-600"}`}
            >
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${INDEX_TONE_CLASSES[stage.status]}`}
              >
                {stage.status === "complete" ? (
                  <CheckIcon className="h-3 w-3" />
                ) : (
                  index + 1
                )}
              </span>
              <span>{STAGE_LABELS[stageId]}</span>
              {isRevisitable ? (
                <button
                  type="button"
                  data-testid={`stage-status-${stageId}`}
                  onClick={() => onViewStage!(stageId)}
                  className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <StatusBadge
                    label={`${STATUS_LABELS[stage.status]} — revisit`}
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
        <div
          role="status"
          data-testid="workflow-analysis-issues"
          className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700"
        >
          <p>{issues.length} specification analysis issue(s) were found:</p>
          <ul className="ml-4 list-disc">
            {issues.map((issue) => (
              <li key={`${issue.kind}-${issue.location}`}>
                <strong>{issue.kind}</strong> at {issue.location}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {dependencyAiIssue && (
        <p
          role="status"
          data-testid="workflow-dependency-ai-issue"
          className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700"
        >
          AI-assisted dependency detection did not complete ({dependencyAiIssue});
          deterministic relationships are still shown.
        </p>
      )}
    </nav>
  );
}
