export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-100",
  info: "bg-info-100 text-info-700 dark:bg-info-500/15 dark:text-info-100",
  success: "bg-success-100 text-success-700 dark:bg-success-500/15 dark:text-success-100",
  warning: "bg-warning-100 text-warning-700 dark:bg-warning-500/15 dark:text-warning-100",
  danger: "bg-danger-100 text-danger-700 dark:bg-danger-500/15 dark:text-danger-100",
};

/**
 * Single source of truth for stage-status/severity/decision-state visual treatment (FR-001,
 * FR-002, FR-016; post-/speckit-analyze finding U1), imported by WorkflowStageTracker,
 * TestScenarioReviewList/Detail, and WorkflowReviewStage. The label is always rendered as text —
 * `tone` only adds a secondary, non-exclusive visual cue, never the only signal (FR-016).
 */
export function StatusBadge({ label, tone = "neutral" }: { label: string; tone?: StatusTone }) {
  return (
    <span
      data-testid="status-badge"
      data-tone={tone}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  );
}
