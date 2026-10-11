import type { CoverageOperationCounts } from "@apipilot/shared-domain";
import { StatTile } from "../StatTile";
import { formatRatio } from "./coverageViewModel";

/**
 * Operation-level counts (coverage-rules.md section 3). The unit is operations. "With passing
 * verification" and "with execution failures" can both apply to one operation, and neither says the
 * operation is complete: requirement-level coverage does.
 */
export function OperationCounts({ counts }: Readonly<{ counts: CoverageOperationCounts }>) {
  const of = (n: number) => ({ value: `${n} / ${counts.eligible}`, sub: formatRatio(n, counts.eligible) });
  return (
    <section aria-labelledby="operation-counts-title" data-testid="operation-counts" className="space-y-2 rounded-lg border border-border bg-surface p-4">
      <div>
        <h3 id="operation-counts-title" className="text-sm font-semibold text-text-primary">
          Operation-level counts
        </h3>
        <p className="text-xs text-muted">
          Unit: operations. Having a generated scenario is not the same as being fully covered, and an operation can have both passing
          verification and failures. Read the requirement states for completeness.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-5">
        <StatTile flat label="Eligible operations" value={String(counts.eligible)} sub="denominator for the rest" />
        <StatTile flat label="With generated scenarios" {...of(counts.withScenarios)} />
        <StatTile flat label="With passing verification" {...of(counts.withPassingVerification)} tone="success" />
        <StatTile flat label="With execution failures" {...of(counts.withFailures)} tone={counts.withFailures > 0 ? "danger" : "neutral"} />
        <StatTile flat label="With no generated scenarios" {...of(counts.withNoScenarios)} />
      </dl>
    </section>
  );
}
