import { Fragment, type ReactNode } from "react";
import { toOperationKey, type ApiOperation } from "@apipilot/shared-domain";
import { HttpMethodBadge } from "./HttpMethodBadge";

/**
 * Shared column template for the header row and every operation row (mirrors
 * TestScenarioReviewList's ROW_GRID_COLUMNS). `justify-items-start` is required alongside the
 * fixed method-column width: CSS Grid's default `justify-items: stretch` otherwise forces the
 * method badge to fill its entire column, which is what stretched its background across the
 * whole first column instead of wrapping snugly around the method text.
 */
const ROW_GRID_COLUMNS = "grid-cols-[4.5rem_minmax(0,1fr)] justify-items-start";

/**
 * Row tone for an operation checked for inclusion — the same tint TestScenarioReviewList uses for
 * an accepted scenario, so "this row is in" reads identically across the app's tables. The row
 * whose details are expanded is marked with an inset ring instead (also mirroring that list), so
 * the two states stay distinguishable when they coincide.
 */
const INCLUDED_ROW_TONE = "bg-success-50 dark:bg-success-500/15";
const EXPANDED_ROW_RING = "ring-2 ring-inset ring-brand-400";

/**
 * Optional per-row inclusion checkboxes (specs/009 Clarifications 2026-09-23). Kept separate from
 * `selected`, which is only the row whose details are expanded: the checkbox sits beside the row
 * button rather than inside it, so the two stay independent controls (a nested interactive
 * element would be invalid HTML and unreachable by keyboard).
 */
export interface OperationListInclusion {
  checkedKeys: ReadonlySet<string>;
  onToggle: (operationKey: string) => void;
  disabled?: boolean;
}

export function OperationList({
  operations,
  selected,
  onSelect,
  renderSelected,
  inclusion,
}: {
  operations: ApiOperation[];
  selected: ApiOperation | null;
  onSelect: (operation: ApiOperation) => void;
  renderSelected?: (operation: ApiOperation) => ReactNode;
  inclusion?: OperationListInclusion;
}) {
  if (operations.length === 0) {
    return (
      <p data-testid="operation-list-empty" className="text-sm text-muted">
        No operations were discovered in this specification.
      </p>
    );
  }

  return (
    <ul data-testid="operation-list" className="overflow-hidden divide-y divide-border rounded-lg border border-border">
      <li
        aria-hidden="true"
        className={`grid items-center gap-3 border-b border-border bg-slate-50 py-2 text-xs font-semibold text-muted dark:bg-white/5 ${ROW_GRID_COLUMNS} ${
          inclusion ? "pl-10 pr-3" : "px-3"
        }`}
      >
        <span>Method</span>
        <span>Path</span>
      </li>
      {operations.map((operation) => {
        const key = toOperationKey(operation);
        const isSelected = selected?.method === operation.method && selected?.path === operation.path;
        const isIncluded = inclusion?.checkedKeys.has(key) ?? false;
        const rowButton = (
          <button
            type="button"
            onClick={() => onSelect(operation)}
            aria-pressed={isSelected}
            className={`grid items-center gap-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${ROW_GRID_COLUMNS} ${
              inclusion ? "min-w-0 flex-1 pr-3" : "w-full px-3"
            } ${isSelected ? EXPANDED_ROW_RING : ""}`}
          >
            <HttpMethodBadge method={operation.method} />
            <span className="min-w-0 truncate font-mono text-slate-800 dark:text-slate-200" title={operation.path}>
              {operation.path}
            </span>
          </button>
        );
        return (
          <Fragment key={key}>
            {inclusion ? (
              <li className={`flex min-w-0 items-center gap-3 pl-3 ${isIncluded ? INCLUDED_ROW_TONE : ""}`}>
                <input
                  type="checkbox"
                  checked={isIncluded}
                  onChange={() => inclusion.onToggle(key)}
                  disabled={inclusion.disabled}
                  aria-label={`Include ${key}`}
                  className="h-4 w-4 shrink-0 rounded border-border text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
                />
                {rowButton}
              </li>
            ) : (
              <li>{rowButton}</li>
            )}
            {isSelected && (
              <li className="border-t border-brand-200 bg-brand-50/20 dark:border-brand-500 dark:bg-brand-500/10">
                {renderSelected?.(operation)}
              </li>
            )}
          </Fragment>
        );
      })}
    </ul>
  );
}
