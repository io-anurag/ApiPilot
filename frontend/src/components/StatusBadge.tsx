export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-surface-strong text-text-secondary ring-1 ring-inset ring-border-strong",
  info: "bg-info-100 text-info-700 ring-1 ring-inset ring-info-700/40 dark:bg-info-500/15 dark:text-info-100 dark:ring-info-100/40",
  success: "bg-success-100 text-success-700 ring-1 ring-inset ring-success-700/40 dark:bg-success-500/15 dark:text-success-100 dark:ring-success-100/40",
  warning: "bg-warning-100 text-warning-700 ring-1 ring-inset ring-warning-700/40 dark:bg-warning-500/15 dark:text-warning-100 dark:ring-warning-100/40",
  danger: "bg-danger-100 text-danger-700 ring-1 ring-inset ring-danger-700/40 dark:bg-danger-500/15 dark:text-danger-100 dark:ring-danger-100/40",
};

/**
 * Every tone carries an outline in its own text colour: the pale fills (info is the same mint as the
 * stage chips, success and neutral are close to the surfaces they sit on) are not distinguishable from
 * their background on their own.
 *
 * For a badge that sits on a tinted surface (a stage chip): the tone's own background can equal that
 * tint (the info and success fills match the mint and pale-lime chips), so it gets a surface fill and
 * an outline instead and stays visible in both themes. The text colour is unchanged.
 */
const ON_TINT_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-surface text-text-secondary ring-1 ring-inset ring-border-strong",
  info: "bg-surface text-info-700 ring-1 ring-inset ring-info-700/40 dark:text-info-100 dark:ring-info-100/40",
  success: "bg-surface text-success-700 ring-1 ring-inset ring-success-700/40 dark:text-success-100 dark:ring-success-100/40",
  warning: "bg-surface text-warning-700 ring-1 ring-inset ring-warning-700/40 dark:text-warning-100 dark:ring-warning-100/40",
  danger: "bg-surface text-danger-700 ring-1 ring-inset ring-danger-700/40 dark:text-danger-100 dark:ring-danger-100/40",
};

/**
 * Single source of truth for stage-status/severity/decision-state visual treatment (FR-001,
 * FR-002, FR-016; post-/speckit-analyze finding U1), imported by WorkflowStageTracker,
 * TestScenarioReviewList/Detail, and WorkflowReviewStage. The label is always rendered as text —
 * `tone` only adds a secondary, non-exclusive visual cue, never the only signal (FR-016).
 */
export function StatusBadge({
  label,
  tone = "neutral",
  title,
  onTint = false,
}: Readonly<{
  label: string;
  tone?: StatusTone;
  /** True when the badge sits on a tinted surface such as a stage chip; see `ON_TINT_CLASSES`. */
  onTint?: boolean;
  /** Optional native tooltip for a badge whose meaning isn't self-evident from its label alone
   * (e.g. "Uploaded" distinguishing an imported-collection run from a generated one). */
  title?: string;
}>) {
  return (
    <span
      data-testid="status-badge"
      data-tone={tone}
      title={title}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${onTint ? ON_TINT_CLASSES[tone] : TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  );
}
