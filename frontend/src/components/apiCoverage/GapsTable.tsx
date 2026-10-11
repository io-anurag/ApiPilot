import { Fragment, useEffect, useState } from "react";
import type { CoverageGap, CoverageRequirementResult, CoverageScenarioResult, CoverageSortKey, OperationCoverage } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { EmptyState } from "../EmptyState";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { Pagination } from "../Pagination";
import { PriorityBadge, StateBadge } from "./CoverageBadges";
import { OperationRequirements } from "./OperationRequirements";
import { formatFraction, formatPercentage, presentStates } from "./coverageViewModel";

const PAGE_SIZES = [10, 25, 50] as const;
const COLUMN_COUNT = 7;

function SortHeader({
  label,
  sortKey,
  active,
  order,
  onSort,
}: Readonly<{
  label: string;
  sortKey: CoverageSortKey;
  active: CoverageSortKey | undefined;
  order: "asc" | "desc";
  onSort: (key: CoverageSortKey) => void;
}>) {
  const isActive = active === sortKey;
  return (
    <th scope="col" aria-sort={isActive ? (order === "asc" ? "ascending" : "descending") : "none"} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {label}
        <span aria-hidden="true">{isActive ? (order === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

function Fraction({ numerator, denominator }: Readonly<{ numerator: number; denominator: number }>) {
  return (
    <span className="font-mono">
      {formatFraction(numerator, denominator)}
      <span className="block text-xs text-muted">{formatPercentage({ percentage: denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10 })}</span>
    </span>
  );
}

const CHIP = "inline-flex items-center rounded border px-1.5 py-0.5 text-xs";

/** Membership of the operation-level counts, as text chips: neither one is a completeness claim. */
function Membership({ row }: Readonly<{ row: OperationCoverage }>) {
  return (
    <div className="flex flex-wrap gap-1">
      {row.scenarioCount === 0 && <span className={`${CHIP} border-dashed border-border text-text-primary`}>No scenarios</span>}
      {row.scenarioVerdicts.passed > 0 && <span className={`${CHIP} border-success-600 text-success-700 dark:text-success-100`}>Has passing verification</span>}
      {row.scenarioVerdicts.failed > 0 && <span className={`${CHIP} border-danger-600 text-danger-700 dark:text-danger-100`}>Has execution failures</span>}
    </div>
  );
}

/**
 * The coverage gaps table (FR-023): one row per operation with specification and runtime
 * requirement fractions, the profile of requirement states and scenario verdicts (there is no
 * single status), what is missing, a priority and actions. Each row expands to its scenarios and
 * requirements. Semantic table, horizontal scroll rather than hiding information on narrow screens.
 */
export function GapsTable({
  operations,
  requirements,
  scenarios,
  gaps,
  totalOperations,
  sort,
  order,
  onSort,
  onReset,
  filtered,
  showVerified,
  onOpenWorkflow,
}: Readonly<{
  operations: readonly OperationCoverage[];
  requirements: readonly CoverageRequirementResult[];
  scenarios: readonly CoverageScenarioResult[];
  gaps: readonly CoverageGap[];
  totalOperations: number;
  sort: CoverageSortKey | undefined;
  order: "asc" | "desc";
  onSort: (key: CoverageSortKey) => void;
  onReset: () => void;
  filtered: boolean;
  showVerified: boolean;
  onOpenWorkflow: (view: "guided-workflow" | "import-collection") => void;
}>) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  // A narrower result can leave the current page past the end.
  const lastPage = Math.max(1, Math.ceil(operations.length / pageSize));
  useEffect(() => {
    if (page > lastPage) setPage(lastPage);
  }, [page, lastPage]);

  const toggle = (key: string): void =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (operations.length === 0) {
    return (
      <div className="space-y-2">
        <EmptyState
          testId="gaps-empty"
          message={filtered ? "No operations match these filters." : "This specification has no eligible operations."}
          description={filtered ? `Showing 0 of ${totalOperations} operations.` : "Select operations in the API review step."}
        />
        {filtered && (
          <button type="button" onClick={onReset} className={BUTTON_STYLES.secondary}>
            Reset filters
          </button>
        )}
      </div>
    );
  }

  const visible = operations.slice((page - 1) * pageSize, page * pageSize);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table data-testid="gaps-table" className="w-full min-w-[56rem] border-collapse text-sm">
          <caption className="sr-only">
            Coverage by operation, showing {operations.length} of {totalOperations} operations
          </caption>
          <thead className="bg-surface-subtle">
            <tr>
              <SortHeader label="Method" sortKey="method" active={sort} order={order} onSort={onSort} />
              <SortHeader label="Endpoint" sortKey="path" active={sort} order={order} onSort={onSort} />
              <SortHeader label="Specification" sortKey="specification" active={sort} order={order} onSort={onSort} />
              <SortHeader label="Runtime verified" sortKey="runtime" active={sort} order={order} onSort={onSort} />
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Requirement states and scenarios</th>
              <SortHeader label="Priority" sortKey="priority" active={sort} order={order} onSort={onSort} />
              <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const isOpen = open.has(row.operationKey);
              const v = row.scenarioVerdicts;
              return (
                <Fragment key={row.operationKey}>
                  <tr data-testid="gap-row" data-operation={row.operationKey} className="border-t border-border align-top">
                    <td className="px-3 py-2"><HttpMethodBadge method={row.method} /></td>
                    <td className="px-3 py-2 font-mono text-xs text-text-primary">{row.path}</td>
                    <td className="px-3 py-2">
                      <Fraction numerator={row.specification.covered} denominator={row.specification.total} />
                      <span className="block text-xs text-muted">requirements</span>
                    </td>
                    <td className="px-3 py-2">
                      <Fraction numerator={row.runtime.verified} denominator={row.runtime.total} />
                      <span className="block text-xs text-muted">requirements</span>
                    </td>
                    <td className="space-y-1.5 px-3 py-2">
                      <Membership row={row} />
                      <ul className="flex flex-col items-start gap-1">
                        {presentStates(row.stateCounts).map(([state, count]) => (
                          <li key={state} className="inline-flex items-center gap-1.5">
                            <StateBadge state={state} />
                            <span className="font-mono text-xs text-muted">×{count}</span>
                          </li>
                        ))}
                      </ul>
                      <p data-testid="scenario-verdicts" className="text-xs text-muted">
                        Scenarios: {v.passed} passed, {v.failed} failed, {v.inconclusive} inconclusive, {v.notExecuted} not executed
                      </p>
                      {row.matchingRequirements !== undefined && (
                        <p className="text-xs text-muted">
                          <span className="font-semibold text-text-primary">{row.matchingRequirements}</span> matching requirement
                          {row.matchingRequirements === 1 ? "" : "s"}
                        </p>
                      )}
                      {row.missing.length === 0 ? (
                        <span className="text-xs text-muted">Nothing missing</span>
                      ) : (
                        <ul className="list-disc space-y-0.5 pl-4 text-xs text-text-secondary">
                          {row.missing.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-2"><PriorityBadge priority={row.priority} /></td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-start gap-1">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => toggle(row.operationKey)}
                          className={BUTTON_STYLES.ghost}
                        >
                          {isOpen ? "Hide details" : "Details"}
                        </button>
                        <button type="button" onClick={() => onOpenWorkflow("guided-workflow")} className={BUTTON_STYLES.ghost}>
                          Open scenarios
                        </button>
                        {(row.failedCount > 0 || row.runtime.verified > 0) && (
                          <button type="button" onClick={() => onOpenWorkflow("import-collection")} className={BUTTON_STYLES.ghost}>
                            {row.failedCount > 0 ? "Open failing result" : "Open results"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr data-testid="gap-detail-row" className="bg-surface-subtle">
                      <td colSpan={COLUMN_COUNT} className="px-4 py-3">
                        <OperationRequirements
                          row={row}
                          requirements={requirements.filter((r) => r.operationKey === row.operationKey)}
                          scenarios={scenarios.filter((s) => s.operationKey === row.operationKey)}
                          gaps={gaps.filter((g) => g.operationKey === row.operationKey)}
                          showVerified={showVerified}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={operations.length}
        pageSizeOptions={PAGE_SIZES}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        noun="operations"
        testId="gaps-pagination"
      />
    </div>
  );
}
