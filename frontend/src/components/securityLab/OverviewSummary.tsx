import type { ReactNode } from "react";
import { FINDING_STATUSES, SCENARIO_OUTCOME_KINDS, SECURITY_REVIEW_STATES, type SecurityOverview } from "@apipilot/shared-domain";
import { useSecurityResource } from "../../hooks/useSecurityResource";
import { fetchOverview } from "../../services/securityLabClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { Card, CardHeader } from "../patterns/Card";
import { Skeleton } from "../Skeleton";
import { StatusBadge } from "../StatusBadge";
import type { SecurityLabIntent } from "./navigationIntent";
import { formatTimestamp } from "./scenarioViewModel";
import { RUN_STATUS } from "./runViewModel";
import { SEVERITY_ORDER, findingStatusVariant, outcomeVariant, reviewStateVariant, severityVariant } from "./securityViewModel";

/**
 * One figure of the Overview. A count above zero is a button that opens the list it counts, already filtered, so the
 * number and the list always agree (specs/057 FR-060, SC-012). A zero has nothing to open and is plain text. The label
 * is part of the button's name, so a screen reader hears what is counted.
 */
function Count({ label, count, intent, onOpen }: Readonly<{ label: string; count: number; intent: SecurityLabIntent; onOpen: (intent: SecurityLabIntent) => void }>) {
  return (
    <li>
      {count > 0 ? (
        <button
          type="button"
          onClick={() => onOpen(intent)}
          title="Open the list this count is of"
          className="rounded-md border border-border-control bg-surface px-2.5 py-1 text-sm text-text-primary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
        >
          {label} <span className="font-semibold">{count}</span>
        </button>
      ) : (
        <span className="inline-block px-2.5 py-1 text-sm text-text-secondary">
          {label} <span className="font-semibold">0</span>
        </span>
      )}
    </li>
  );
}

function CountGroup({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase text-muted">{title}</p>
      <ul className="flex flex-wrap gap-2" aria-label={title}>
        {children}
      </ul>
    </div>
  );
}

/**
 * The retained-work half of the Overview (specs/057 FR-060, FR-004): scenario and finding counts that each open their
 * list, the generation scope, the latest run, and the high-priority operations nothing has tested yet, with the reason
 * each is listed. It reads retained work, so it works with no specification loaded. Scenarios are proposed tests and
 * findings come from requests that were actually sent; the two are separate groups and never added together.
 */
export function OverviewSummary({ categoryNames, onOpen }: Readonly<{ categoryNames: Readonly<Record<string, string>>; onOpen: (intent: SecurityLabIntent) => void }>) {
  const overview = useSecurityResource((signal) => fetchOverview({ signal }));

  if (overview.problem && !overview.data) {
    return (
      <ErrorState testId="overview-summary-error" message="The scenario and finding counts are unavailable" detail={`${overview.problem.message} This is not an empty result.`}>
        <button type="button" onClick={overview.refresh} className={BUTTON_STYLES.secondary}>
          Retry
        </button>
      </ErrorState>
    );
  }
  if (!overview.data) {
    return (
      <div role="status" aria-label="Reading the overview" className="space-y-3">
        <Skeleton className="h-24 w-full rounded bg-surface-strong" />
        <Skeleton className="h-24 w-full rounded bg-surface-strong" />
      </div>
    );
  }

  const data: SecurityOverview = overview.data;
  const { scenarioCounts, findingCounts, latestRun, scope, untestedHighPriority } = data;
  const runStatus = latestRun ? RUN_STATUS[latestRun.status] : undefined;
  const categoryIds = Object.keys(scenarioCounts.byCategory).sort();

  return (
    <div className="space-y-4" data-testid="overview-summary" aria-busy={overview.loading}>
      {overview.problem && (
        <ErrorState testId="overview-summary-stale" message="Out-of-date counts: the latest refresh failed" detail={`${overview.problem.message} The figures below are from the last successful read.`}>
          <button type="button" onClick={overview.refresh} className={BUTTON_STYLES.secondary}>
            Retry
          </button>
        </ErrorState>
      )}

      <p className="text-sm text-text-secondary" data-testid="overview-spec-status">
        {data.specificationLoaded
          ? `A specification is loaded${data.specificationRevision ? ` (revision ${data.specificationRevision.slice(0, 12)})` : ""}.`
          : "No specification is loaded. The figures below come from work retained earlier, and are marked “specification not loaded” where it matters."}
        {scope ? ` Generation scope: ${scope.mode === "selection" ? "your Guided Workflow selection" : "all operations"}, ${scope.included} included and ${scope.excluded} left out.` : ""}
      </p>
      <p className="text-xs text-text-secondary">Select a count to open the list it counts, already filtered.</p>

      <Card as="section" aria-labelledby="overview-scenarios-heading">
        <CardHeader title="Scenarios (proposed tests)" titleId="overview-scenarios-heading" subtitle="Evidence basis: generated from the specification. Nothing here has been sent to any target." />
        <div className="space-y-3">
          <CountGroup title="Scenarios in all">
            <Count label="All scenarios" count={scenarioCounts.total} intent={{ kind: "scenarios", filters: {} }} onOpen={onOpen} />
          </CountGroup>
          <CountGroup title="Scenarios by category">
            {categoryIds.length === 0 ? <li className="text-sm text-text-secondary">None yet.</li> : null}
            {categoryIds.map((id) => (
              <Count key={id} label={categoryNames[id] ?? id} count={scenarioCounts.byCategory[id] ?? 0} intent={{ kind: "scenarios", filters: { category: id } }} onOpen={onOpen} />
            ))}
          </CountGroup>
          <CountGroup title="Scenarios by review state">
            {SECURITY_REVIEW_STATES.map((state) => (
              <Count key={state} label={reviewStateVariant(state).label} count={scenarioCounts.byReviewState[state]} intent={{ kind: "scenarios", filters: { reviewState: state } }} onOpen={onOpen} />
            ))}
          </CountGroup>
          <CountGroup title="Scenarios needing attention">
            <Count label="Stale" count={scenarioCounts.stale} intent={{ kind: "scenarios", filters: { flag: "stale" } }} onOpen={onOpen} />
            <Count label="Orphaned" count={scenarioCounts.orphaned} intent={{ kind: "scenarios", filters: { flag: "orphaned" } }} onOpen={onOpen} />
            <Count label="Blocked" count={scenarioCounts.blocked} intent={{ kind: "scenarios", filters: { flag: "blocked" } }} onOpen={onOpen} />
            <Count label="Specification not loaded" count={scenarioCounts.specificationNotLoaded} intent={{ kind: "scenarios", filters: { flag: "specification_not_loaded" } }} onOpen={onOpen} />
          </CountGroup>
        </div>
      </Card>

      <Card as="section" aria-labelledby="overview-run-heading">
        <CardHeader title="Latest run" titleId="overview-run-heading" subtitle="Evidence basis: requests actually sent to a target." />
        {latestRun && runStatus ? (
          <div className="space-y-2" data-testid="overview-latest-run">
            <p className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
              Started {formatTimestamp(latestRun.startedAt)} <StatusBadge label={runStatus.label} tone={runStatus.tone} />
            </p>
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Outcomes of the latest run">
              {SCENARIO_OUTCOME_KINDS.map((kind) => (
                <div key={kind}>
                  <dt className="inline text-text-secondary">{outcomeVariant(kind).label}: </dt>
                  <dd className="inline font-medium text-text-primary">{latestRun.summary[kind]}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-text-secondary">Blocked, errored and not run are not passes.</p>
          </div>
        ) : (
          <p className="text-sm text-text-secondary" data-testid="overview-no-run">
            No run has been made yet. Approve scenarios and run them in Execution and Findings.
          </p>
        )}
      </Card>

      <Card as="section" aria-labelledby="overview-findings-heading">
        <CardHeader title="Findings (from requests sent)" titleId="overview-findings-heading" subtitle="Evidence basis: responses to requests a run actually sent. Occurrences are counted beside findings, never added to them." />
        <div className="space-y-3">
          <CountGroup title="Findings in all">
            <Count label="All findings" count={findingCounts.total} intent={{ kind: "findings", filters: {} }} onOpen={onOpen} />
            <Count label="With an unreviewed occurrence" count={findingCounts.withUnreviewedOccurrence} intent={{ kind: "findings", filters: { unreviewed: true } }} onOpen={onOpen} />
          </CountGroup>
          <CountGroup title="Findings by severity">
            {SEVERITY_ORDER.map((severity) => (
              <Count key={severity} label={severityVariant(severity).label} count={findingCounts.bySeverity[severity]} intent={{ kind: "findings", filters: { severity } }} onOpen={onOpen} />
            ))}
          </CountGroup>
          <CountGroup title="Findings by status">
            {FINDING_STATUSES.map((status) => (
              <Count key={status} label={findingStatusVariant(status).label} count={findingCounts.byStatus[status]} intent={{ kind: "findings", filters: { status } }} onOpen={onOpen} />
            ))}
          </CountGroup>
          <p className="text-sm text-text-secondary" data-testid="overview-occurrences">
            Occurrences, counted separately: {findingCounts.occurrences}.
          </p>
        </div>
      </Card>

      <Card as="section" aria-labelledby="overview-untested-heading">
        <CardHeader title="High-priority operations nothing has tested" titleId="overview-untested-heading" subtitle="Evidence basis: the specification analysis. Each is listed with the reason." />
        {!data.specificationLoaded ? (
          <p className="text-sm text-text-secondary" data-testid="overview-untested-unavailable">
            This list comes from the specification analysis, so it is not available while no specification is loaded.
          </p>
        ) : untestedHighPriority.length === 0 ? (
          <p className="text-sm text-text-secondary" data-testid="overview-untested-empty">
            Every operation the analysis marks as high priority has had a scenario run, or the analysis marked none.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="overview-untested">
            {untestedHighPriority.map((entry) => (
              <li key={entry.operationKey} className="text-sm">
                <span className="font-mono text-xs text-text-primary">{entry.operationKey}</span>
                <span className="block text-xs text-text-secondary">Why: {entry.basis}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
