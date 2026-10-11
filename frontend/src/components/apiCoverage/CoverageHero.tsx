import type { ReactNode } from "react";

/**
 * The Coverage page header in the application's hero style (the eyebrow, display title and lead
 * used by the start screen and Import & Run Collection), with its actions on the right and the
 * specification/run context underneath.
 */
export function CoverageHero({
  actions,
  children,
}: Readonly<{ actions?: ReactNode; children?: ReactNode }>) {
  return (
    <header data-testid="coverage-hero" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-3xl space-y-3">
          <p className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">
            <span aria-hidden="true" className="h-3 w-1 rounded-full bg-brand-500" />
            <span>Results · Coverage</span>
          </p>
          <h2 className="font-display text-3xl font-semibold leading-tight tracking-tight text-text-primary sm:text-4xl">
            API Test Coverage
          </h2>
          <p className="max-w-2xl text-base leading-7 text-muted">
            How much of the API your generated tests cover, and how much of that real runs have verified.
          </p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
