/**
 * Single source of truth for interactive-control visual treatment (mirrors StatusBadge/
 * HttpMethodBadge's own "one file, every consumer" convention). `warning` and `ghost` were added
 * during an app-wide consistency pass — before them, AiEnhancementStage's retry button and every
 * text-link-style action (EnvironmentForm, EnvironmentPicker, the home page) each hand-rolled a
 * near-duplicate className instead of sharing one.
 */
export const BUTTON_STYLES = {
  primary:
    "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "rounded-md border border-border-control bg-surface px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  success:
    "rounded-md bg-success-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-success-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-success-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  danger:
    "rounded-md bg-danger-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-danger-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  warning:
    "rounded-md bg-warning-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-warning-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-warning-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  /** A text-link-styled action (e.g. "+ Add variable") rather than a boxed button. */
  ghost:
    "text-sm font-medium text-brand-700 hover:text-brand-800 focus:outline-none focus-visible:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-brand-300 dark:hover:text-brand-200",
} as const;


/**
 * The one look of a text field, select or textarea (AP-054 FR-009): its outline is
 * `border-control`, dark enough to reach 3:1 against the surface it sits on. Card edges and
 * dividers use the lighter decorative `border` and `border-strong`. Checkboxes and radios use
 * `border-border-control` directly.
 */
export const FIELD_STYLES =
  "rounded-md border border-border-control bg-surface px-2 py-1.5 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The one look of the start screen's controls: the artifact buttons, the card arrows and the
 * coverage entry button. A workflow colour appears only on a marker dot or an icon, never on the box.
 */
export const ENTRY_CONTROL =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-border-strong bg-background text-sm font-medium text-text-secondary motion-safe:transition-colors hover:border-brand-500 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:border-border-strong disabled:hover:text-text-disabled";
