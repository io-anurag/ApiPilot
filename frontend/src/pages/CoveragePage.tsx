import { useContext, useEffect, useMemo, useState } from "react";
import type { CoverageFilter, CoverageSortKey, CoverageSnapshot } from "@apipilot/shared-domain";
import { ActiveViewContext } from "../components/requestChain/activeView";
import { BUTTON_STYLES } from "../components/controlStyles";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Skeleton } from "../components/Skeleton";
import { CategoryCoverage } from "../components/apiCoverage/CategoryCoverage";
import { CoverageBars } from "../components/apiCoverage/CoverageBars";
import { CoverageNotices } from "../components/apiCoverage/CoverageNotice";
import { EMPTY_FILTER, GapFilters, isFiltered } from "../components/apiCoverage/GapFilters";
import { GapsTable } from "../components/apiCoverage/GapsTable";
import { MetricGroup, lastExecutionExtra } from "../components/apiCoverage/MetricGroup";
import { OperationCounts } from "../components/apiCoverage/OperationCounts";
import { Recommendations } from "../components/apiCoverage/Recommendations";
import { evidenceLabel, formatTimestamp, scopeLabel } from "../components/apiCoverage/coverageViewModel";
import { useCoverage } from "../hooks/useCoverage";
import { coverageExportUrl, type CoverageQueryParams } from "../services/coverageClient";

/** The latest-qualifying-result default for the run selector. */
const LATEST_RUN = "";
const TEXT_DEBOUNCE_MS = 250;

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
  onOpenWorkflow: (view: "guided-workflow" | "import-collection") => void;
}>) {
  const spec = snapshot?.specification;
  const exec = snapshot?.execution;
  return (
    <header className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="font-display text-2xl font-bold tracking-tight text-text-primary">API Test Coverage</h2>
          <p className="text-sm text-muted">
            How much of the API your generated tests cover, and how much of that real runs have verified.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {snapshot && exec && exec.availableRuns.length > 0 && (
            <label className="flex items-center gap-2 text-xs font-semibold text-muted">
              Evaluate run
              <select
                value={runId}
                onChange={(event) => onRunChange(event.target.value)}
                className="max-w-72 rounded-md border border-border bg-surface px-2 py-1.5 text-sm font-normal text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
              >
                <option value={LATEST_RUN}>Latest qualifying result per scenario</option>
                {exec.availableRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {`Single run: ${run.label} · ${formatTimestamp(run.startedAt)}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" onClick={onRecalculate} disabled={loading} className={BUTTON_STYLES.secondary}>
            {loading ? "Calculating..." : "Recalculate"}
          </button>
          {snapshot && (
            <>
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
            </>
          )}
          <button type="button" onClick={() => onOpenWorkflow("import-collection")} className={BUTTON_STYLES.primary}>
            Go to Import &amp; Run
          </button>
        </div>
      </div>
      {spec && exec && snapshot && (
        <dl data-testid="coverage-context" className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
          <div>
            <dt className="inline font-semibold">Specification </dt>
            <dd className="inline text-text-primary">
              {spec.name}
              {spec.version ? ` v${spec.version}` : ""}
            </dd>
          </div>
          <div>
            <dt className="inline font-semibold">Revision </dt>
            <dd className="inline font-mono text-text-primary">{spec.revision.slice(0, 10)}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">{exec.environments.length > 0 ? "Run context " : "Environment "}</dt>
            <dd className="inline text-text-primary">
              {exec.environments.length > 0 ? exec.environments.map((e) => `${e.name} (${e.tier})`).join(", ") : "No execution yet"}
            </dd>
          </div>
          <div data-testid="coverage-evidence">
            <dt className="inline font-semibold">Evidence </dt>
            <dd className="inline text-text-primary">{evidenceLabel(snapshot)}</dd>
          </div>
          {exec.excludedRuns.length > 0 && (
            <div data-testid="coverage-excluded-runs">
              <dt className="inline font-semibold">Excluded runs </dt>
              <dd className="inline text-text-primary">
                {exec.excludedRuns.map((r) => `${r.runId} (${r.reason}: ${r.environment.name}, ${r.environment.tier})`).join(", ")}
              </dd>
            </div>
          )}
          <div>
            <dt className="inline font-semibold">Last qualifying execution </dt>
            <dd className="inline text-text-primary">{formatTimestamp(exec.lastQualifyingExecutionAt)}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Scenarios </dt>
            <dd className="inline text-text-primary">
              {snapshot.context.scenarioCounts.accepted} accepted, {snapshot.context.scenarioCounts.pending} pending (
              {snapshot.context.scenarioCounts.rejected} rejected, not counted)
            </dd>
          </div>
        </dl>
      )}
    </header>
  );
}

function SideLists({ snapshot }: Readonly<{ snapshot: CoverageSnapshot }>) {
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-text-primary">Out of scope</h3>
        <p className="mb-2 text-xs text-muted">Operations not selected for generation. They are not counted as gaps.</p>
        {snapshot.outOfScopeOperations.length === 0 ? (
          <p className="text-xs text-muted">None. Every operation is in scope.</p>
        ) : (
          <ul data-testid="out-of-scope" className="space-y-0.5 font-mono text-xs text-text-secondary">
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
}: Readonly<{ onOpenWorkflow: (view: "guided-workflow" | "import-collection") => void }>) {
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
        <EmptyState
          testId="coverage-no-workflow"
          message="No active specification"
          description="Coverage is calculated from a specification and its generated scenarios. Upload a specification in the guided workflow first."
        />
        <button type="button" onClick={() => onOpenWorkflow("guided-workflow")} className={BUTTON_STYLES.primary}>
          Go to the specification step
        </button>
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
      <CoverageNotices notices={snapshot.notices} />
      {snapshot.notices.some((n) => n.code === "no-scenarios") && (
        <div>
          <button type="button" onClick={() => onOpenWorkflow("guided-workflow")} className={BUTTON_STYLES.primary}>
            Go to scenario generation
          </button>
        </div>
      )}
      <p data-testid="coverage-scope" aria-live="polite" className="text-xs text-muted">
        Scope: <span className="font-semibold text-text-primary">{scopeLabel(snapshot, filter, filtered)}</span> · Evidence:{" "}
        <span className="font-semibold text-text-primary">{evidenceLabel(snapshot)}</span>
        {filtered && (
          <>
            {" "}
            ·{" "}
            <button type="button" onClick={reset} className="font-semibold underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              Reset filters
            </button>
          </>
        )}
      </p>
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
