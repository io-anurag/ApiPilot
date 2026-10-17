import type { CoverageCategoryCoverage, CoverageSnapshot } from "@apipilot/shared-domain";
import { Card, CardHeader } from "../patterns/Card";
import { Pill } from "../patterns/Pill";
import { BreakdownBar } from "./CoverageBars";
import { breakdownFromCounts, CATEGORY_TITLES, formatRatio } from "./coverageViewModel";

function Figure({ label, numerator, denominator }: Readonly<{ label: string; numerator: number; denominator: number }>) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs text-muted">
      <dt>{label}</dt>
      <dd className="font-mono text-sm font-semibold text-text-primary">
        {numerator} / {denominator}
        <span className="ml-1.5 text-xs font-normal text-muted">{formatRatio(numerator, denominator)}</span>
      </dd>
    </div>
  );
}

function SelectedMark({ selected }: Readonly<{ selected: boolean }>) {
  return selected ? <Pill tone="accent">Filtered to this category</Pill> : null;
}

function CategoryCard({ category, selected }: Readonly<{ category: CoverageCategoryCoverage; selected: boolean }>) {
  // The selected category carries a brand edge and the words, not the edge alone.
  const ring = selected ? "ring-2 ring-brand-500" : "";
  if (category.group === "security" || !category.available) {
    return (
      <article
        data-testid="category-card"
        data-category={category.group}
        className={`space-y-2 rounded-xl border border-dashed border-border-strong bg-surface-subtle p-3 ${ring}`}
      >
        <h4 className="text-sm font-semibold text-text-primary">{CATEGORY_TITLES[category.group]}</h4>
        <SelectedMark selected={selected} />
        {category.group === "security" ? (
          <p className="text-sm font-semibold text-text-primary">Unavailable</p>
        ) : (
          <p className="text-sm font-semibold text-text-primary">Not available (0 eligible)</p>
        )}
        <p className="text-xs text-muted">{category.reason}</p>
      </article>
    );
  }
  return (
    <article data-testid="category-card" data-category={category.group} className={`space-y-2 rounded-xl bg-surface-subtle p-3 ${ring}`}>
      <h4 className="text-sm font-semibold text-text-primary">{CATEGORY_TITLES[category.group]}</h4>
      <SelectedMark selected={selected} />
      <dl className="space-y-1">
        <Figure label="Specification coverage" numerator={category.specCovered} denominator={category.eligible} />
        <Figure label="Runtime-verified" numerator={category.verified} denominator={category.eligible} />
      </dl>
      <BreakdownBar breakdown={breakdownFromCounts(CATEGORY_TITLES[category.group], category.counts)} />
    </article>
  );
}

/**
 * Coverage by scenario category (coverage-rules.md section 10). Counted in classified testable
 * requirements, never scenarios, so duplicate scenarios cannot inflate it. Security is shown as
 * unavailable, not as zero, and requirements no generator can provoke are listed as unclassified
 * instead of being hidden or counted.
 */
export function CategoryCoverage({
  snapshot,
  selected,
}: Readonly<{ snapshot: CoverageSnapshot; selected: CoverageSnapshot["categoryCoverage"][number]["group"] | undefined }>) {
  const securityDeclared = snapshot.operations.filter((o) => o.securityDeclared).length;
  const unclassified = snapshot.unclassified.requirements;
  return (
    <Card as="section" aria-labelledby="category-coverage-title" data-testid="category-coverage" className="space-y-3">
      <CardHeader
        title="Coverage by scenario category"
        titleId="category-coverage-title"
        level={3}
        subtitle="Each requirement belongs to one category. Both figures count that category's own eligible requirements and are never combined into a score."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {snapshot.categoryCoverage.map((category) => (
          <CategoryCard key={category.group} category={category} selected={selected === category.group} />
        ))}
      </div>
      <p className="text-xs text-muted">
        {securityDeclared} of {snapshot.operations.length} operations declare a security requirement (declared in the specification, not tested).
      </p>
      <p data-testid="unclassified" className="text-xs text-muted">
        {unclassified.length === 0
          ? "Unclassified: none."
          : `Unclassified: ${unclassified.length} requirement${unclassified.length === 1 ? "" : "s"} (${unclassified
              .map((u) => `${u.operationKey} ${u.label}`)
              .join("; ")}) are in no category denominator; they stay in response-code coverage as their own keys.`}{" "}
        Unclassified scenarios: {snapshot.unclassified.scenarios}.
      </p>
    </Card>
  );
}
