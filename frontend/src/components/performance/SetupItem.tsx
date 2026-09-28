import type { ReactNode } from "react";

/**
 * One line of the plan's run-setup checklist: its state (as text and a mark), a one-line summary,
 * and its controls. A `collapsible` item keeps its editor behind a native `<details>` so the
 * checklist stays short; the summary line still says where the item stands. The mark is never the
 * only signal: each state has a screen-reader label beside it.
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

function Mark({ state }: Readonly<{ state: SetupItemState }>) {
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
  collapsible = false,
  actionLabel = "Edit",
  children,
}: Readonly<{
  state: SetupItemState;
  title: string;
  titleId: string;
  summary: ReactNode;
  collapsible?: boolean;
  /** The collapsible item's visible cue that it opens. */
  actionLabel?: string;
  children?: ReactNode;
}>) {
  const heading = (
    <span className="min-w-0 flex-1">
      <span id={titleId} className="block text-sm font-medium">
        {title}
      </span>
      <span className="block text-xs text-muted">{summary}</span>
    </span>
  );

  if (collapsible) {
    return (
      <li className="px-4 py-3">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-start gap-3 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 [&::-webkit-details-marker]:hidden">
            <Mark state={state} />
            {heading}
            <span className="shrink-0 text-sm font-medium text-brand-700 dark:text-brand-300">
              <span className="group-open:hidden">{actionLabel}</span>
              <span className="hidden group-open:inline">Close</span>
            </span>
          </summary>
          <div className="mt-3 space-y-3">{children}</div>
        </details>
      </li>
    );
  }
  return (
    <li className="space-y-3 px-4 py-3" aria-labelledby={titleId}>
      <div className="flex items-start gap-3">
        <Mark state={state} />
        {heading}
      </div>
      {children}
    </li>
  );
}
