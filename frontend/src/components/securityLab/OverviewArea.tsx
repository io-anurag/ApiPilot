import { useMemo, useState } from "react";
import { OBSERVATION_CLASSES, type ObservationClass } from "@apipilot/shared-domain";
import { useSecurityResource } from "../../hooks/useSecurityResource";
import { fetchAnalysis, fetchCategories, type CategoriesReply } from "../../services/securityLabClient";
import { BUTTON_STYLES, FIELD_STYLES } from "../controlStyles";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { Banner } from "../patterns/Banner";
import { Card, CardHeader } from "../patterns/Card";
import { Skeleton } from "../Skeleton";
import { StatTile } from "../StatTile";
import { CategoryTable } from "./CategoryTable";
import { ObservationList } from "./ObservationList";
import { SensitiveFieldsEditor } from "./SensitiveFieldsEditor";
import { classificationVariant } from "./securityViewModel";

type Filter = "all" | Exclude<ObservationClass, "potential-risk">;

/**
 * The Overview area (specs/057 FR-060). This step shows the specification analysis: counts by
 * classification, the potential risks as their own labelled group, the other observations, the category
 * registry and the sensitive-field setting. Potential risks come from the specification alone and are never
 * shown as findings, which only a run can produce.
 */
export function OverviewArea() {
  const analysis = useSecurityResource((signal) => fetchAnalysis({ signal }));
  const categories = useSecurityResource((signal) => fetchCategories({ signal }));
  const [filter, setFilter] = useState<Filter>("all");

  const observations = analysis.data?.analysis.observations ?? [];
  const risks = useMemo(() => observations.filter((o) => o.classification === "potential-risk"), [observations]);
  const others = useMemo(
    () => observations.filter((o) => o.classification !== "potential-risk" && (filter === "all" || o.classification === filter)),
    [observations, filter],
  );

  if (analysis.problem?.kind === "error" && !analysis.data) {
    return (
      <ErrorState testId="security-analysis-error" message="The security analysis is unavailable" detail={`${analysis.problem.message} This is not an empty result.`}>
        <button type="button" onClick={analysis.refresh} className={BUTTON_STYLES.secondary}>
          Retry
        </button>
      </ErrorState>
    );
  }

  if (analysis.problem?.kind === "no-specification") {
    return (
      <div className="space-y-4">
        <EmptyState message="There is no analysis to show yet." description="Security analysis needs a specification. Upload one in the Guided Workflow." testId="security-analysis-empty" />
        {categories.data && <CategoriesCard categories={categories.data} />}
      </div>
    );
  }

  if (!analysis.data) {
    return (
      <div role="status" aria-label="Analyzing the specification" className="space-y-3">
        <Skeleton className="h-24 w-full rounded bg-surface-strong" />
        <Skeleton className="h-40 w-full rounded bg-surface-strong" />
      </div>
    );
  }

  const { analysis: result, configuredSensitiveFields, operationCount } = analysis.data;

  return (
    <div data-testid="security-overview" className="space-y-4" aria-busy={analysis.loading}>
      <Banner tone="neutral" title="How to read this page" testId="security-reading-note">
        This is what the specification says, and does not say, about security. A potential risk is a question for you to answer, not a
        vulnerability: specification analysis cannot prove what the running API does. Findings come only from running approved tests.
      </Banner>

      {analysis.problem?.kind === "error" && (
        <ErrorState
          testId="security-analysis-stale"
          message="Out-of-date analysis: the latest refresh failed"
          detail={`${analysis.problem.message} The figures below are from the last successful analysis.`}
        >
          <button type="button" onClick={analysis.refresh} className={BUTTON_STYLES.secondary}>
            Retry
          </button>
        </ErrorState>
      )}

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Observations by classification">
        {OBSERVATION_CLASSES.map((classification) => {
          const variant = classificationVariant(classification);
          return (
            <StatTile
              key={classification}
              label={variant.label}
              value={String(result.counts[classification])}
              sub={classification === "potential-risk" ? "From the specification alone" : undefined}
              tone={result.counts[classification] > 0 ? variant.tone : "neutral"}
            />
          );
        })}
      </dl>
      <p className="text-sm text-text-secondary" data-testid="security-analysis-scope">
        Analysis covers all {operationCount} operations in the specification.
        {result.unmeasurable.length > 0 && ` Not measurable with this input: ${result.unmeasurable.join("; ")}.`}
      </p>

      <Card as="section" aria-labelledby="security-risks-heading">
        <CardHeader title="Potential risks (specification analysis)" titleId="security-risks-heading" subtitle="Evidence basis: the specification only. Nothing has been sent to any target." />
        <ObservationList
          observations={risks}
          caption="Potential risks raised from the specification"
          emptyMessage="The analysis raised no potential risks for this specification."
          testId="security-risk-list"
        />
      </Card>

      <Card as="section" aria-labelledby="security-observations-heading">
        <CardHeader
          title="Other observations"
          titleId="security-observations-heading"
          actions={
            <label className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
              Show
              <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)} className={`${FIELD_STYLES} font-normal`}>
                <option value="all">All other observations</option>
                {OBSERVATION_CLASSES.filter((c) => c !== "potential-risk").map((c) => (
                  <option key={c} value={c}>
                    {classificationVariant(c).label}
                  </option>
                ))}
              </select>
            </label>
          }
        />
        <ObservationList observations={others} caption="Other observations from the specification" testId="security-observation-list" />
      </Card>

      {categories.data && <CategoriesCard categories={categories.data} />}

      <Card as="section" aria-labelledby="security-fields-heading">
        <CardHeader title="Sensitive fields you configure" titleId="security-fields-heading" />
        <SensitiveFieldsEditor fields={configuredSensitiveFields} onSaved={() => analysis.refresh()} />
      </Card>
    </div>
  );
}

function CategoriesCard({ categories }: Readonly<{ categories: CategoriesReply }>) {
  return (
    <Card as="section" aria-labelledby="security-categories-heading">
      <CardHeader title="Categories and support levels" titleId="security-categories-heading" subtitle={categories.editionTitle} />
      <CategoryTable categories={categories.categories} editionTitle={categories.editionTitle} />
    </Card>
  );
}
