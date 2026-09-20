import type { ReactNode } from "react";

function InboxIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 12l2.5-6.5A1.5 1.5 0 018 4.5h8a1.5 1.5 0 011.5 1l2.5 6.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h4.5l1 2h5l1-2H20v6a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18v-6z" />
    </svg>
  );
}

/**
 * Single source of truth for "no data" presentation (spec 027 FR-006/FR-007), formalizing the
 * boxed icon+message+description shape `ExternalCollectionList` already used ad hoc. `compact`
 * drops the box for an empty result already nested inside another bordered list/panel (e.g. a
 * filtered list that keeps its own border), so the message doesn't get a redundant double border.
 */
export function EmptyState({
  message,
  description,
  icon,
  compact = false,
  testId = "empty-state",
}: Readonly<{
  message: string;
  description?: string;
  icon?: ReactNode;
  compact?: boolean;
  /** Preserves a call site's pre-existing data-testid so migrating onto this component doesn't
   * break tests that already query it by name. */
  testId?: string;
}>) {
  if (compact) {
    return (
      <p data-testid={testId} className="text-sm text-muted">
        {message}
        {description ? ` ${description}` : ""}
      </p>
    );
  }
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center dark:border-slate-600 dark:bg-white/5"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-white text-muted dark:bg-white/10">
        {icon ?? <InboxIcon className="h-5 w-5" />}
      </span>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{message}</p>
      {description && <p className="text-xs text-muted">{description}</p>}
    </div>
  );
}
