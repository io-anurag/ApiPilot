import { Fragment, type ReactNode } from "react";
import type { ApiOperation } from "@apipilot/shared-domain";
import { HttpMethodBadge } from "./HttpMethodBadge";

/**
 * Shared column template for the header row and every operation row (mirrors
 * TestScenarioReviewList's ROW_GRID_COLUMNS). `justify-items-start` is required alongside the
 * fixed method-column width: CSS Grid's default `justify-items: stretch` otherwise forces the
 * method badge to fill its entire column, which is what stretched its background across the
 * whole first column instead of wrapping snugly around the method text.
 */
const ROW_GRID_COLUMNS = "grid-cols-[4.5rem_minmax(0,1fr)] justify-items-start";

export function OperationList({
  operations,
  selected,
  onSelect,
  renderSelected,
}: {
  operations: ApiOperation[];
  selected: ApiOperation | null;
  onSelect: (operation: ApiOperation) => void;
  renderSelected?: (operation: ApiOperation) => ReactNode;
}) {
  if (operations.length === 0) {
    return (
      <p data-testid="operation-list-empty" className="text-sm text-muted">
        No operations were discovered in this specification.
      </p>
    );
  }

  return (
    <ul data-testid="operation-list" className="divide-y divide-border rounded-md border border-border">
      <li
        aria-hidden="true"
        className={`grid items-center gap-3 border-b border-border bg-slate-50 px-3 py-2 text-xs font-semibold text-muted ${ROW_GRID_COLUMNS}`}
      >
        <span>Method</span>
        <span>Path</span>
      </li>
      {operations.map((operation) => {
        const isSelected = selected?.method === operation.method && selected?.path === operation.path;
        return (
          <Fragment key={`${operation.method} ${operation.path}`}>
            <li>
              <button
                type="button"
                onClick={() => onSelect(operation)}
                aria-pressed={isSelected}
                className={`grid w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${ROW_GRID_COLUMNS} ${
                  isSelected ? "bg-brand-50" : ""
                }`}
              >
                <HttpMethodBadge method={operation.method} />
                <span className="min-w-0 truncate font-mono text-slate-800" title={operation.path}>
                  {operation.path}
                </span>
              </button>
            </li>
            {isSelected && (
              <li className="border-t border-brand-200 bg-brand-50/20">
                {renderSelected?.(operation)}
              </li>
            )}
          </Fragment>
        );
      })}
    </ul>
  );
}
