import { useState, type ReactNode } from "react";

/**
 * One section of the Run setup tab (load profile, thresholds, environment, script), headed by its
 * state as a mark and a screen-reader label, and a one-line summary. The heading takes focus
 * (`tabIndex={-1}`) so the pending bar can take the user straight to the section to fix. The mark
 * is never the only signal: each state has a text label beside it.
 *
 * `variant="row"` is a row of a larger card (AP-040): a `collapsible` row shows only its summary until
 * the engineer chooses Edit, and keeps its content mounted while hidden so nothing typed is lost.
 */
export type SetupItemState = "done" | "attention" | "todo" | "optional";

const MARK: Record<SetupItemState, { symbol: string; label: string; className: string }> = {
  done: {
    symbol: "✓",
    label: "Ready",
    className: "bg-success-100 text-success-700 dark:bg-success-500/20 dark:text-success-100",
  },
  attention: {
    symbol: "!",
    label: "Needs attention",
    className: "bg-warning-100 font-bold text-warning-700 dark:bg-warning-500/20 dark:text-warning-100",
  },
  todo: { symbol: "", label: "Not done yet", className: "border-2 border-border" },
  optional: { symbol: "–", label: "Optional", className: "border border-dashed border-muted text-muted" },
};

export function StateMark({ state }: Readonly<{ state: SetupItemState }>) {
  const mark = MARK[state];
  return (
    <>
      <span
        aria-hidden="true"
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs ${mark.className}`}
      >
        {mark.symbol}
      </span>
      <span className="sr-only">{mark.label}:</span>
    </>
  );
}

export function SetupItem({
  state,
  title,
  titleId,
  summary,
  status,
  actions,
  collapsedSummary,
  variant = "card",
  collapsible = false,
  startOpen = true,
  className = "",
  children,
}: Readonly<{
  state: SetupItemState;
  title: string;
  titleId: string;
  summary?: ReactNode;
  /** Shown beside the title, for a state that belongs with the name (for example the script's freshness). */
  status?: ReactNode;
  /** Link-style actions at the right of the heading; they wrap below it when the row is narrow. */
  actions?: ReactNode;
  /** The summary shown instead of `summary` while a collapsible row is closed. */
  collapsedSummary?: ReactNode;
  /** `row` drops the card's own border so a parent can group several items in one rounded card. */
  variant?: "card" | "row";
  collapsible?: boolean;
  startOpen?: boolean;
  className?: string;
  children?: ReactNode;
}>) {
  const [open, setOpen] = useState(startOpen);
  const bodyId = `${titleId}-body`;
  const shownSummary = collapsible && !open && collapsedSummary !== undefined ? collapsedSummary : summary;
  const box = variant === "row" ? "border-t border-border px-5 py-4 first:border-t-0" : "rounded-2xl border border-border p-4";

  return (
    <section aria-labelledby={titleId} className={`bg-surface ${box} ${className}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <StateMark state={state} />
        <div className="min-w-0 flex-1 basis-60">
          <div className="flex min-w-0 items-center gap-x-3">
            <h3 id={titleId} tabIndex={-1} className="shrink-0 rounded text-base font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              {title}
            </h3>
            {status && <div className="flex min-w-0 flex-1 items-center">{status}</div>}
          </div>
          {shownSummary && <p className="text-xs text-muted">{shownSummary}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-8 sm:pl-0">{actions}</div>}
        {collapsible && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={`${open ? "Hide" : "Edit"} ${title}`}
            className="shrink-0 rounded-lg border border-border bg-surface px-3 py-1 text-sm font-medium hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-white/10"
            onClick={() => setOpen(!open)}
          >
            {open ? "Hide" : "Edit"}
          </button>
        )}
      </div>
      <div id={bodyId} hidden={collapsible && !open} className="mt-3 space-y-3 sm:pl-8">
        {children}
      </div>
    </section>
  );
}
