import type { CoverageMetric } from "@apipilot/shared-domain";
import { formatFraction, formatPercentage, formatTimestamp } from "./coverageViewModel";

/** One card: a titled group of metrics, each with numerator, denominator, percentage and a bar. */
export function MetricGroup({
  title,
  caption,
  metrics,
  barClassName,
  extra,
  notes,
  testId,
}: Readonly<{
  title: string;
  caption: string;
  metrics: readonly CoverageMetric[];
  /** Literal Tailwind class for the filled part of each bar. */
  barClassName: string;
  extra?: Readonly<{ label: string; value: string; sub?: string }>;
  /** Extra text under a metric's percentage, by metric id (for example the failed and not-evaluated assertion counts). */
  notes?: Readonly<Record<string, string>>;
  testId: string;
}>) {
  return (
    <section aria-labelledby={`${testId}-title`} data-testid={testId} className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 pt-3">
        <h3 id={`${testId}-title`} className="text-sm font-semibold text-text-primary">
          {title}
        </h3>
        <p className="text-xs text-muted">{caption}</p>
      </div>
      <dl className="mt-3 grid grid-cols-2 border-t border-border">
        {metrics.map((metric) => (
          <div
            key={metric.id}
            data-testid="metric-tile"
            data-metric={metric.id}
            className="min-w-0 border-b border-r border-border px-4 py-3"
          >
            <dt className="text-xs font-semibold text-muted" title={metric.basis}>
              {metric.label}
            </dt>
            <dd className="font-mono text-xl font-semibold text-text-primary">
              {metric.numerator}
              <span className="text-sm font-medium text-muted"> / {metric.denominator}</span>
            </dd>
            <dd className="text-xs text-muted">
              <span data-testid="metric-percentage">{formatPercentage(metric)}</span>
              {notes?.[metric.id] && <span className="block">{notes[metric.id]}</span>}
              <span className="sr-only">{`. ${formatFraction(metric.numerator, metric.denominator)}. ${metric.basis}`}</span>
            </dd>
            <dd>
              <div
                role="img"
                aria-label={`${metric.label}: ${metric.numerator} of ${metric.denominator}`}
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-strong"
              >
                {/* The width is a genuinely dynamic value (the metric's percentage). */}
                <span className={`block h-full ${barClassName}`} style={{ width: `${metric.percentage ?? 0}%` }} />
              </div>
            </dd>
          </div>
        ))}
        {extra && (
          <div data-testid="metric-tile" data-metric="extra" className="min-w-0 border-b border-r border-border px-4 py-3">
            <dt className="text-xs font-semibold text-muted">{extra.label}</dt>
            <dd className="break-words font-mono text-sm font-semibold text-text-primary">{extra.value}</dd>
            {extra.sub && <dd className="text-xs text-muted">{extra.sub}</dd>}
          </div>
        )}
      </dl>
    </section>
  );
}

/** The "last qualifying execution" figure for the runtime group. */
export function lastExecutionExtra(lastQualifyingExecutionAt: string | undefined): {
  label: string;
  value: string;
  sub: string;
} {
  return {
    label: "Last qualifying execution",
    value: formatTimestamp(lastQualifyingExecutionAt),
    sub: lastQualifyingExecutionAt ? "latest result that counts as evidence" : "no execution evidence yet",
  };
}
