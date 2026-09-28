import type { ReactNode } from "react";

/**
 * One section of the Run setup tab (load profile, thresholds, environment, script), headed by its
 * state as a mark and a screen-reader label, and a one-line summary. The heading takes focus
 * (`tabIndex={-1}`) so the pending bar can take the user straight to the section to fix. The mark
 * is never the only signal: each state has a text label beside it.
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
  children,
}: Readonly<{
  state: SetupItemState;
  title: string;
  titleId: string;
  summary?: ReactNode;
  children?: ReactNode;
}>) {
  return (
    <section aria-labelledby={titleId} className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <StateMark state={state} />
        <div className="min-w-0 flex-1">
          <h3 id={titleId} tabIndex={-1} className="rounded text-base font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            {title}
          </h3>
          {summary && <p className="text-xs text-muted">{summary}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}
