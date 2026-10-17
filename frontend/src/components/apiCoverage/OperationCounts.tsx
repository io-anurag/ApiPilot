import type { CoverageOperationCounts } from "@apipilot/shared-domain";
import { StatTile } from "../StatTile";
import { Card, CardHeader } from "../patterns/Card";
import { formatRatio } from "./coverageViewModel";

/**
 * Operation-level counts (coverage-rules.md section 3), as the pattern set's stat tiles with one mint
 * highlight, on the figure that says how many operations have a generated scenario. The unit is
 * operations. "With passing verification" and "with execution failures" can both apply to one
 * operation, and neither says the operation is complete: requirement-level coverage does.
 */
export function OperationCounts({ counts }: Readonly<{ counts: CoverageOperationCounts }>) {
  const of = (n: number) => ({ value: `${n} / ${counts.eligible}`, sub: formatRatio(n, counts.eligible) });
  return (
    <Card as="section" aria-labelledby="operation-counts-title" data-testid="operation-counts">
      <CardHeader
        title="Operation-level counts"
        titleId="operation-counts-title"
        level={3}
        subtitle="Unit: operations. Having a generated scenario is not the same as being fully covered, and an operation can have both passing verification and failures. Read the requirement states for completeness."
      />
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Eligible operations" value={String(counts.eligible)} sub="denominator for the rest" />
        <StatTile highlight label="With generated scenarios" {...of(counts.withScenarios)} />
        <StatTile label="With passing verification" {...of(counts.withPassingVerification)} tone="success" />
        <StatTile label="With execution failures" {...of(counts.withFailures)} tone={counts.withFailures > 0 ? "danger" : "neutral"} />
        <StatTile label="With no generated scenarios" {...of(counts.withNoScenarios)} />
      </dl>
    </Card>
  );
}
