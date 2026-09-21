import { BUTTON_STYLES } from "./controlStyles";

/** Extends `StatusTone` (StatusBadge.tsx) with "brand" for a breakdown segment whose natural
 * color is the brand teal rather than any semantic status (e.g. an HTTP method or provenance
 * split) — every other value stays interchangeable with the rest of the app's tone vocabulary. */
export type SummaryTone = "brand" | "neutral" | "info" | "success" | "warning" | "danger";

const BAR_TONE_CLASSES: Record<SummaryTone, string> = {
  brand: "bg-brand-500",
  neutral: "bg-slate-400 dark:bg-slate-500",
  info: "bg-info-500",
  success: "bg-success-500",
  warning: "bg-warning-500",
  danger: "bg-danger-500",
};

const TEXT_TONE_CLASSES: Record<SummaryTone, string> = {
  brand: "text-brand-700 dark:text-brand-300",
  neutral: "text-slate-700 dark:text-slate-300",
  info: "text-info-700 dark:text-info-400",
  success: "text-success-700 dark:text-success-400",
  warning: "text-warning-700 dark:text-warning-400",
  danger: "text-danger-700 dark:text-danger-400",
};

export interface SummaryPanelSegment {
  key: string;
  label: string;
  count: number;
  tone: SummaryTone;
}

export interface SummaryPanelAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * A colored count breakdown: a segmented bar plus a label/count legend. The bar is `aria-hidden`
 * — the `dl` legend below it is the accessible source of truth for every count (constitution
 * §38: never communicate state through color alone), so the bar is a decorative reinforcement,
 * not the only signal. Exported on its own (not just through `SummaryPanel`) so an inline
 * caller that isn't a full sidebar — e.g. `AiEnhancementOutcomeSummary` — can reuse the same
 * visual language without the sidebar chrome.
 */
export function SummaryBreakdown({ segments }: Readonly<{ segments: SummaryPanelSegment[] }>) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  if (total === 0) return null;

  return (
    <div data-testid="summary-breakdown" className="space-y-3">
      <div
        aria-hidden="true"
        className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"
      >
        {segments
          .filter((segment) => segment.count > 0)
          .map((segment) => (
            <div
              key={segment.key}
              className={BAR_TONE_CLASSES[segment.tone]}
              style={{ width: `${(segment.count / total) * 100}%` }}
            />
          ))}
      </div>
      <dl className="space-y-1.5 text-sm">
        {segments.map((segment) => (
          <div key={segment.key} className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${BAR_TONE_CLASSES[segment.tone]}`}
              />
              {segment.label}
            </dt>
            <dd className={`font-semibold ${TEXT_TONE_CLASSES[segment.tone]}`}>{segment.count}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The sticky right-hand summary card behind every guided-workflow stage that has a count worth
 * calling out (CLAUDE.md §28 "Developer Tool + API Observatory"): a big stat, an optional colored
 * breakdown, explanatory text, and an optional primary action. Each stage owns its own two-column
 * layout and passes this its own data — there is deliberately no shared page-level layout
 * component, since what belongs in the sidebar differs per stage.
 */
export function SummaryPanel({
  testId,
  label = "Summary",
  statValue,
  statLabel,
  segments,
  description,
  action,
}: Readonly<{
  testId: string;
  label?: string;
  statValue: number | string;
  statLabel: string;
  segments?: SummaryPanelSegment[];
  description?: string;
  action?: SummaryPanelAction;
}>) {
  return (
    <aside
      data-testid={testId}
      className="space-y-5 self-start rounded-lg border border-border bg-surface p-5 shadow-sm lg:sticky lg:top-4"
    >
      <p className="font-mono text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div>
        <p className="font-display text-4xl font-semibold tracking-tight text-slate-950 dark:text-white">
          {statValue}
        </p>
        <p className="text-sm text-muted">{statLabel}</p>
      </div>
      {segments && <SummaryBreakdown segments={segments} />}
      {description && <p className="text-xs leading-5 text-muted">{description}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className={`${BUTTON_STYLES.primary} flex w-full items-center justify-center gap-1.5`}
        >
          {action.label}
        </button>
      )}
    </aside>
  );
}
