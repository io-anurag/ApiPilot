import type { ScenarioListItem } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { EmptyState } from "../EmptyState";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { Pagination } from "../Pagination";
import { StatusBadge } from "../StatusBadge";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { FlagBadges, FlagLegend } from "./FlagBadges";
import { splitOperationKey } from "./scenarioViewModel";
import { executionStatusVariant, reviewStateVariant, severityVariant } from "./securityViewModel";

export const SCENARIO_PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * The scenario list as a semantic table (specs/057 FR-032): each row carries the review state, execution status,
 * severity, destructive mark and flags as text badges, so nothing is told by colour alone. A scenario is opened by its
 * title, a real button, so the list is operable by keyboard. Retained scenarios are listed with no specification
 * loaded, each flagged "specification not loaded" (FR-004).
 */
export function ScenarioList({
  items,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  selectedId,
  onSelect,
  categoryNames,
  filtered,
  onClearFilters,
}: Readonly<{
  items: readonly ScenarioListItem[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  categoryNames: Readonly<Record<string, string>>;
  /** True when at least one filter is applied, which changes what an empty list means. */
  filtered: boolean;
  onClearFilters: () => void;
}>) {
  if (total === 0) {
    return filtered ? (
      <div className="space-y-2">
        <EmptyState message="No scenarios match these filters." description="Nothing is hidden or lost: clear the filters to see every scenario." testId="scenario-list-empty" />
        <button type="button" onClick={onClearFilters} className={BUTTON_STYLES.secondary}>
          Clear filters
        </button>
      </div>
    ) : (
      <EmptyState message="There are no scenarios yet." description="Generate them from a loaded specification using the controls above." testId="scenario-list-empty" />
    );
  }

  return (
    <div className="space-y-3" data-testid="scenario-list">
      <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label="Security scenarios">
        <table className={TABLE_STYLES.table}>
          <caption className="sr-only">Security scenarios, with review state, execution status, severity and flags</caption>
          <thead>
            <tr>
              <th scope="col" className={TABLE_STYLES.th}>Scenario</th>
              <th scope="col" className={TABLE_STYLES.th}>Operation</th>
              <th scope="col" className={TABLE_STYLES.th}>Category</th>
              <th scope="col" className={TABLE_STYLES.th}>Severity</th>
              <th scope="col" className={TABLE_STYLES.th}>Review state</th>
              <th scope="col" className={TABLE_STYLES.th}>Execution</th>
              <th scope="col" className={TABLE_STYLES.th}>Flags</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const operation = splitOperationKey(item.operationKey);
              const severity = severityVariant(item.severity);
              const state = reviewStateVariant(item.reviewState);
              const execution = executionStatusVariant(item.executionStatus);
              const selected = item.id === selectedId;
              return (
                <tr key={item.id} data-testid="scenario-row" data-scenario-id={item.id} className={selected ? "bg-surface-subtle" : undefined}>
                  <th scope="row" className={`${TABLE_STYLES.td} max-w-sm text-left font-medium`}>
                    <button
                      type="button"
                      onClick={() => onSelect(item.id)}
                      aria-current={selected ? "true" : undefined}
                      className="text-left font-medium text-brand-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300"
                    >
                      {item.title}
                    </button>
                    {item.destructive && (
                      <span className="ml-2 inline-block align-middle">
                        <StatusBadge label="Destructive" tone="danger" title="This scenario may change or delete data on the target." />
                      </span>
                    )}
                  </th>
                  <td className={TABLE_STYLES.td}>
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {operation.method && <HttpMethodBadge method={operation.method} />}
                      <span className="break-all font-mono text-xs">{operation.path}</span>
                    </span>
                  </td>
                  <td className={TABLE_STYLES.td}>{categoryNames[item.categoryId] ?? item.categoryId}</td>
                  <td className={TABLE_STYLES.td}>
                    <StatusBadge label={severity.label} tone={severity.tone} />
                  </td>
                  <td className={TABLE_STYLES.td}>
                    <StatusBadge label={state.label} tone={state.tone} />
                  </td>
                  <td className={TABLE_STYLES.td}>
                    <StatusBadge label={execution.label} tone={execution.tone} />
                  </td>
                  <td className={TABLE_STYLES.td}>
                    <FlagBadges flags={item.flags} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <FlagLegend />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        pageSizeOptions={SCENARIO_PAGE_SIZES}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        noun="scenarios"
        testId="scenario-pagination"
      />
    </div>
  );
}
