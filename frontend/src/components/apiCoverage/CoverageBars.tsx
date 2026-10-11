import type { CoverageRequirementResult } from "@apipilot/shared-domain";
import { breakdownFor, breakdownLabel, type Breakdown } from "./coverageViewModel";

/** One stacked bar with its legend; the counts under it carry the exact values, so the bar is never the only way to read them. */
export function BreakdownBar({ breakdown }: Readonly<{ breakdown: Breakdown }>) {
  return (
    <div data-testid="breakdown" data-breakdown={breakdown.title} className="min-w-0 space-y-2">
      <h4 className="text-sm font-semibold text-text-primary">{breakdown.title}</h4>
      <div
        role="img"
        aria-label={breakdownLabel(breakdown)}
        className="flex h-4 overflow-hidden rounded bg-surface-strong ring-1 ring-inset ring-border"
      >
        {breakdown.segments.map(
          (segment) =>
            segment.count > 0 &&
            segment.key !== "uncovered" && (
              // The width is the one genuinely dynamic value in this view (a share of the total).
              <span
                key={segment.key}
                className={`h-full border-r border-surface last:border-r-0 ${segment.className}`}
                style={{ width: `${(segment.count / breakdown.total) * 100}%` }}
              />
            ),
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {breakdown.segments.map((segment) => (
          <li key={segment.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-sm ring-1 ring-inset ring-border ${segment.className}`} />
            {segment.label}
            <span className="font-mono font-semibold text-text-primary">{segment.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Requirement breakdowns (FR-022): parameters, request-schema elements and documented response
 * codes. Each bar partitions the eligible requirements of one kind into verified, executed-failed,
 * inconclusive, stale, generated-not-executed and not covered, so specification coverage, runtime
 * verification and the remaining gap are all visible. Operations are not a bar here: their
 * counts, which are a different unit, have their own section.
 */
export function CoverageBars({ requirements }: Readonly<{ requirements: readonly CoverageRequirementResult[] }>) {
  const breakdowns = [
    breakdownFor("Parameters", requirements, ["parameter"]),
    breakdownFor("Request-schema elements", requirements, ["request-schema"]),
    breakdownFor("Response codes", requirements, ["response-code"]),
  ];
  return (
    <section aria-labelledby="coverage-breakdown-title" className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div>
        <h3 id="coverage-breakdown-title" className="text-sm font-semibold text-text-primary">
          Requirement breakdown
        </h3>
        <p className="text-xs text-muted">
          Each bar partitions the eligible requirements of one kind. Verified and failed come from execution evidence; generated means a
          scenario exists but has not been executed.
        </p>
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        {breakdowns.map((breakdown) =>
          breakdown.total === 0 ? (
            <div key={breakdown.title} data-testid="breakdown" data-breakdown={breakdown.title} className="text-sm text-muted">
              <h4 className="font-semibold text-text-primary">{breakdown.title}</h4>
              Not available (0 eligible) for the current selection.
            </div>
          ) : (
            <BreakdownBar key={breakdown.title} breakdown={breakdown} />
          ),
        )}
      </div>
    </section>
  );
}
