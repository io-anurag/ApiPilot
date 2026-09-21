/**
 * Single source of truth for interactive-control visual treatment (mirrors StatusBadge/
 * HttpMethodBadge's own "one file, every consumer" convention). `warning` and `ghost` were added
 * during an app-wide consistency pass — before them, AiEnhancementStage's retry button and every
 * text-link-style action (EnvironmentForm, EnvironmentPicker, the home page) each hand-rolled a
 * near-duplicate className instead of sharing one.
 */
export const BUTTON_STYLES = {
  primary:
    "rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-white/10",
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
