import type { ReactNode } from "react";
import { Card } from "../patterns/Card";

/**
 * The Coverage page header (AP-054 FR-013): the eyebrow, title and lead, then a toolbar card with the
 * actions (run selector at the start, commands at the end), with the specification/run context
 * underneath. The toolbar wraps on a narrow window.
 */
export function CoverageHero({
  actions,
  children,
}: Readonly<{ actions?: ReactNode; children?: ReactNode }>) {
  return (
    <header data-testid="coverage-hero" className="space-y-4">
      <div className="min-w-0 max-w-3xl space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Results · Coverage</p>
        <h2 className="font-display text-2xl font-bold text-text-primary">API Test Coverage</h2>
        <p className="max-w-2xl text-sm text-text-secondary">
          How much of the API your generated tests cover, and how much of that real runs have verified.
        </p>
      </div>
      {actions && (
        <Card variant="flat" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {actions}
        </Card>
      )}
      {children}
    </header>
  );
}
