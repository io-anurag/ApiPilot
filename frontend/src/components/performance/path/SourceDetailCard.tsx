import type { ReactNode } from "react";

/**
 * The card under the source choice (specs/050-performance-source-step-redesign FR-003): the same anatomy
 * as the start screen's "Upload specification" card, an accent bar, a header with a title and a meta line,
 * and a body. The state at the right of the header is a dot and a word, so it never rests on colour alone.
 */
export function SourceDetailCard({
  title,
  meta,
  stateLabel,
  ready,
  testId,
  children,
}: Readonly<{ title: string; meta: string; stateLabel: string; ready: boolean; testId?: string; children: ReactNode }>) {
  return (
    <section aria-label={title} data-testid={testId} className="overflow-hidden rounded-xl border border-border-strong bg-surface shadow-sm">
      <div className="h-1 bg-brand-600 dark:bg-brand-500" />
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-subtle px-5 py-3">
        <div className="min-w-0">
          <p className="text-left text-sm font-semibold text-text-primary">{title}</p>
          <p className="mt-0.5 text-left text-xs text-muted">{meta}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-2 text-xs text-muted">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${ready ? "bg-success" : "bg-brand-500"}`} />
          {stateLabel}
        </span>
      </div>
      <div className="space-y-4 p-5 sm:p-6">{children}</div>
    </section>
  );
}
