import { useContext, useEffect, useMemo, useState } from "react";
import type { CoverageFilter, CoverageSortKey, CoverageSnapshot } from "@apipilot/shared-domain";
import { ActiveViewContext } from "../components/requestChain/activeView";
import { BUTTON_STYLES } from "../components/controlStyles";
import { ErrorState } from "../components/ErrorState";
import { Skeleton } from "../components/Skeleton";
import { CoverageHero } from "../components/apiCoverage/CoverageHero";
import { CoverageSteps, type CoverageNeed } from "../components/apiCoverage/CoverageSteps";
import { CategoryCoverage } from "../components/apiCoverage/CategoryCoverage";
import { CoverageBars } from "../components/apiCoverage/CoverageBars";
import { CoverageContext } from "../components/apiCoverage/CoverageContext";
import { CoverageNotices } from "../components/apiCoverage/CoverageNotice";
import { EMPTY_FILTER, GapFilters, isFiltered } from "../components/apiCoverage/GapFilters";
import { GapsTable } from "../components/apiCoverage/GapsTable";
import { MetricGroup, lastExecutionExtra } from "../components/apiCoverage/MetricGroup";
import { OperationCounts } from "../components/apiCoverage/OperationCounts";
import { Recommendations } from "../components/apiCoverage/Recommendations";
import { formatTimestamp, scopeLabel, type OpenWorkflow } from "../components/apiCoverage/coverageViewModel";
import { useCoverage } from "../hooks/useCoverage";
import { coverageExportUrl, type CoverageQueryParams } from "../services/coverageClient";

/** The latest-qualifying-result default for the run selector. */
const LATEST_RUN = "";
const TEXT_DEBOUNCE_MS = 250;
/** Run labels are user-supplied collection names; the native select popup widens to the longest option. */
const RUN_LABEL_MAX = 28;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function Header({
  snapshot,
  runId,
  onRunChange,
  onRecalculate,
  loading,
  exportQuery,
  onOpenWorkflow,
}: Readonly<{
  snapshot: CoverageSnapshot | null;
  runId: string;
  onRunChange: (runId: string) => void;
  onRecalculate: () => void;
  loading: boolean;
  exportQuery: CoverageQueryParams;
  onOpenWorkflow: OpenWorkflow;
}>) {
  const exec = snapshot?.execution;
  return (
    <CoverageHero
      actions={
        snapshot ? (
        <>
          {exec && exec.availableRuns.length > 0 && (
            <label className="flex items-center gap-2 text-xs font-semibold text-muted">
              Evaluate run
              <select
                value={runId}
                onChange={(event) => onRunChange(event.target.value)}
                className="max-w-72 rounded-md border border-border bg-surface px-2 py-1.5 text-sm font-normal text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
              >
                <option value={LATEST_RUN}>Latest qualifying result per scenario</option>
                {exec.availableRuns.map((run) => (
                  <option key={run.id} value={run.id} title={`${run.label} · ${formatTimestamp(run.startedAt)}`}>
                    {`${truncate(run.label, RUN_LABEL_MAX)} · ${formatTimestamp(run.startedAt)}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <button type="button" onClick={onRecalculate} disabled={loading} className={BUTTON_STYLES.secondary}>
                {loading ? "Calculating..." : "Recalculate"}
              </button>
              <a
                href={coverageExportUrl(exportQuery, "html", "filtered")}
                download
                className={`${BUTTON_STYLES.secondary} inline-block`}
              >
                Export this view (HTML)
              </a>
              <a href={coverageExportUrl(exportQuery, "json", "all")} download className={`${BUTTON_STYLES.secondary} inline-block`}>
                Export all (JSON)
              </a>
              {/* Before the first run the steps below carry this action; once runs exist it is "again". */}
              {exec && exec.runIds.length > 0 && (
                <button type="button" onClick={() => onOpenWorkflow("import-collection")} className={BUTTON_STYLES.primary}>
                  Run again in Import &amp; Run
                </button>
              )}
          </div>
        </>
        ) : undefined
      }
    />
  );
}

function SideLists({ snapshot }: Readonly<{ snapshot: CoverageSnapshot }>) {
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-text-primary">
          Out of scope
          {snapshot.outOfScopeOperations.length > 0 && <span className="ml-1 font-normal text-muted">({snapshot.outOfScopeOperations.length})</span>}
        </h3>
        <p className="mb-2 text-xs text-muted">Operations not selected for generation. They are not counted as gaps.</p>
        {snapshot.outOfScopeOperations.length === 0 ? (
          <p className="text-xs text-muted">None. Every operation is in scope.</p>
        ) : (
          // Can hold hundreds of operations: scroll inside the card; focusable so the keyboard can scroll it.
          <ul
            data-testid="out-of-scope"
            tabIndex={0}
            aria-label="Out-of-scope operations"
            className="max-h-60 space-y-0.5 overflow-y-auto rounded-md font-mono text-xs text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {snapshot.outOfScopeOperations.map((key) => (
              <li key={key}>{key}</li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-text-primary">Not measurable</h3>
        <p className="mb-2 text-xs text-muted">Excluded from every denominator, with the reason.</p>
        {snapshot.notMeasurable.length === 0 ? (
          <p className="text-xs text-muted">Nothing was excluded.</p>
        ) : (
          <ul data-testid="not-measurable" className="space-y-1.5 text-xs text-text-secondary">
            {snapshot.notMeasurable.slice(0, 20).map((entry, index) => (
              <li key={`${entry.operationKey ?? "doc"}-${entry.label}-${index}`}>
                <span className="font-mono text-text-primary">{entry.operationKey ?? "Document"}</span> · {entry.label}: {entry.reason}
              </li>
            ))}
            {snapshot.notMeasurable.length > 20 && <li>…and {snapshot.notMeasurable.length - 20} more.</li>}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">
          <strong className="font-semibold">Security and authorization:</strong> unavailable. No scenario category identifies
          authorization intent.
        </p>
      </section>
      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-text-primary">How priority is scored</h3>
        <p className="text-xs text-muted">
          A heuristic from declared facts: the gap's state, whole-operation gaps, documented responses, mutating methods
          (DELETE, PUT, PATCH, POST), declared security requirements and contract complexity. Cross-run failure history is
          not used. It is not a security assessment.
        </p>
      </section>
    </div>
  );
}

/**
 * The Coverage view (AP-046). Everything shown comes from `GET /api/coverage`, computed on the
 * server from the session's real specification, scenarios and run results; there is no sample data
 * and an error is never rendered as empty coverage. Filters and sort live in this component, which
 * stays mounted while hidden, so they survive switching views and reset on a full page refresh.
 */
export function CoveragePage({
  onOpenWorkflow,
}: Readonly<{ onOpenWorkflow: OpenWorkflow }>) {
  const active = useContext(ActiveViewContext) === "coverage";
  const [filter, setFilter] = useState<CoverageFilter>(EMPTY_FILTER);
  const [runId, setRunId] = useState(LATEST_RUN);
  const [debouncedQ, setDebouncedQ] = useState("");
  const [showVerified, setShowVerified] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(filter.q ?? ""), TEXT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filter.q]);

  const query = useMemo<CoverageQueryParams>(
    () => ({ ...filter, q: debouncedQ || undefined, ...(runId ? { runId } : {}) }),
    [filter, debouncedQ, runId],
  );
  const { snapshot, loading, problem, refresh } = useCoverage(query, active);

  const reset = (): void => {
    setFilter({ ...EMPTY_FILTER, sort: filter.sort, order: filter.order });
    setDebouncedQ("");
  };
  const onSort = (key: CoverageSortKey): void =>
    setFilter((f) => ({ ...f, sort: key, order: f.sort === key && (f.order ?? "asc") === "asc" ? "desc" : "asc" }));

  const header = (
    <Header
      snapshot={snapshot}
      runId={runId}
      onRunChange={setRunId}
      onRecalculate={refresh}
      loading={loading}
      exportQuery={query}
      onOpenWorkflow={onOpenWorkflow}
    />
  );

  if (problem?.kind === "no-workflow") {
    return (
      <div data-testid="coverage-page" className="space-y-4">
        {header}
        <div data-testid="coverage-no-workflow" className="space-y-3">
          <div className="space-y-1 rounded-lg border border-border bg-surface p-4">
            <p className="text-sm font-semibold text-text-primary">No active specification</p>
            <p className="text-sm text-text-secondary">
              Coverage measures your tests against an OpenAPI specification loaded in the Guided Workflow, and matches run
              results from Import &amp; Run Collection to the scenarios generated from it.
            </p>
            <p className="text-sm text-text-secondary">
              A collection run on its own has no specification to be measured against. The same applies when the session
              was restarted or expired, because the specification and scenarios are not kept. Start the Guided Workflow with
              the specification, then run its collection.
            </p>
          </div>
          <CoverageSteps need="specification" onOpenWorkflow={onOpenWorkflow} />
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div data-testid="coverage-page" className="space-y-4">
        {header}
        {problem?.kind === "error" ? (
          <ErrorState testId="coverage-error" message="Coverage is unavailable" detail={`${problem.message} This is not an empty result.`}>
            <button type="button" onClick={refresh} className={BUTTON_STYLES.secondary}>
              Retry
            </button>
          </ErrorState>
        ) : (
          <div role="status" aria-label="Calculating coverage" className="space-y-3">
            <Skeleton className="h-24 w-full rounded bg-surface-strong" />
            <Skeleton className="h-40 w-full rounded bg-surface-strong" />
          </div>
        )}
      </div>
    );
  }

  const specMetrics = snapshot.metrics.filter((m) => m.dimension === "specification" && m.id !== "spec-response-codes");
  const runtimeMetrics = snapshot.metrics.filter((m) => m.dimension === "runtime");
  const filtered = isFiltered(filter);
  const counted = snapshot.context.scenarioCounts.accepted + snapshot.context.scenarioCounts.pending;
  let need: CoverageNeed | null = null;
  if (counted === 0) need = "scenarios";
  else if (snapshot.execution.runIds.length === 0) need = "run";

  return (
    <div data-testid="coverage-page" className="space-y-4" aria-busy={loading}>
      {header}
      {problem?.kind === "error" && (
        <ErrorState
          testId="coverage-error"
          message="Out-of-date snapshot: the latest recalculation failed"
          detail={`${problem.message} The figures below are from the snapshot calculated at ${formatTimestamp(snapshot.calculatedAt)} and may not reflect later runs or edits.`}
        >
          <button type="button" onClick={refresh} className={BUTTON_STYLES.secondary}>
            Retry
          </button>
        </ErrorState>
      )}
      <CoverageContext snapshot={snapshot} scope={scopeLabel(snapshot, filter, filtered)} filtered={filtered} onReset={reset} />
      <CoverageNotices notices={snapshot.notices} />
      {need && (
        <CoverageSteps
          need={need}
          scenarioSummary={`${snapshot.context.scenarioCounts.total} scenarios (${snapshot.context.scenarioCounts.accepted} accepted, ${snapshot.context.scenarioCounts.pending} pending).`}
          onOpenWorkflow={onOpenWorkflow}
        />
      )}
      <OperationCounts counts={snapshot.operationCounts} />
      <div className="grid gap-4 lg:grid-cols-2">
        <MetricGroup
          testId="spec-metrics"
          title="Specification coverage"
          caption="a qualifying generated scenario exists"
          metrics={specMetrics}
          barClassName="bg-info-600"
        />
        <MetricGroup
          testId="runtime-metrics"
          title="Runtime-verified coverage"
          caption="execution evidence passed"
          metrics={runtimeMetrics}
          barClassName="bg-success-600"
          extra={lastExecutionExtra(snapshot.execution.lastQualifyingExecutionAt)}
          notes={{
            "runtime-assertions": `${snapshot.assertionOutcomes.failed} failed · ${snapshot.assertionOutcomes.notEvaluated} not evaluated (outside the denominator)`,
          }}
        />
      </div>
      <CategoryCoverage snapshot={snapshot} selected={filter.category} />
      <CoverageBars requirements={snapshot.requirements} />
      <section aria-labelledby="coverage-gaps-title" className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <div>
          <h3 id="coverage-gaps-title" className="text-sm font-semibold text-text-primary">
            Coverage gaps
          </h3>
          <p className="text-xs text-muted">
            Showing {snapshot.operations.length} of {snapshot.totals.operations} operations and {snapshot.gaps.length} of{" "}
            {snapshot.totals.gaps} gaps.
          </p>
        </div>
        <GapFilters value={filter} onChange={setFilter} onReset={reset} />
        <label className="inline-flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={showVerified}
            onChange={(event) => setShowVerified(event.target.checked)}
            className="h-4 w-4 rounded border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          Show verified requirements in operation details
        </label>
        <GapsTable
          operations={snapshot.operations}
          requirements={snapshot.requirements}
          scenarios={snapshot.scenarios}
          gaps={snapshot.gaps}
          showVerified={showVerified}
          totalOperations={snapshot.totals.operations}
          sort={filter.sort}
          order={filter.order ?? "asc"}
          onSort={onSort}
          onReset={reset}
          filtered={filtered}
          availableRuns={snapshot.execution.availableRuns}
          onOpenWorkflow={onOpenWorkflow}
        />
      </section>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="recommendations-title" className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <div>
            <h3 id="recommendations-title" className="text-sm font-semibold text-text-primary">
              Recommended next tests
            </h3>
            <p className="text-xs text-muted">Ranked by the same rules as priority. Each one traces to a specific gap.</p>
          </div>
          <Recommendations recommendations={snapshot.recommendations} onOpenWorkflow={onOpenWorkflow} />
        </section>
        <SideLists snapshot={snapshot} />
      </div>
    </div>
  );
}
