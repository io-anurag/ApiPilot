import { useId, useMemo, useState } from "react";
import type { ScenarioListItem, SecurityProfile } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { EmptyState } from "../EmptyState";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { Pagination } from "../Pagination";
import { StatusBadge } from "../StatusBadge";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { isSelectable, unselectableReasons } from "./runViewModel";
import { splitOperationKey } from "./scenarioViewModel";
import { severityVariant } from "./securityViewModel";

const PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * The approved scenarios a run can be built from (specs/057 FR-029, FR-041). Every approved scenario is listed, and one
 * that cannot be chosen is shown with the reasons in words (not approved at this version, stale, orphaned, no
 * specification, a category or destructive scenarios the profile does not permit, prerequisites it does not meet), so
 * it is never silently missing. The choice is an explicit set of scenarios; the server judges each one again at
 * preview and at start.
 */
export function ApprovedScenarioSelection({
  items,
  profile,
  selected,
  onChange,
  categoryNames,
}: Readonly<{
  items: readonly ScenarioListItem[];
  profile: SecurityProfile | undefined;
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
  categoryNames: Readonly<Record<string, string>>;
}>) {
  const base = useId();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[1]);
  const judged = useMemo(() => items.map((item) => ({ item, reasons: unselectableReasons(item, profile), selectable: isSelectable(item, profile) })), [items, profile]);
  const selectableIds = useMemo(() => judged.filter((entry) => entry.selectable).map((entry) => entry.item.id), [judged]);
  const visible = judged.slice((page - 1) * pageSize, page * pageSize);

  if (items.length === 0) {
    return <EmptyState message="There are no approved scenarios yet." description="Approve scenarios in the Scenarios area. Only an approved version can run." testId="approved-empty" />;
  }

  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  }

  return (
    <div className="space-y-3" data-testid="approved-selection">
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" className="text-sm text-text-primary" data-testid="selection-count">
          {selected.size} selected of {selectableIds.length} that can run ({items.length} approved).
        </p>
        <button type="button" onClick={() => onChange(new Set(selectableIds))} disabled={selectableIds.length === 0} className={BUTTON_STYLES.secondary}>
          Select all that can run
        </button>
        <button type="button" onClick={() => onChange(new Set())} disabled={selected.size === 0} className={BUTTON_STYLES.secondary}>
          Clear selection
        </button>
      </div>
      <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label="Approved scenarios">
        <table className={TABLE_STYLES.table}>
          <caption className="sr-only">Approved scenarios, with whether each can be chosen for a run and why not</caption>
          <thead>
            <tr>
              <th scope="col" className={TABLE_STYLES.th}>Choose</th>
              <th scope="col" className={TABLE_STYLES.th}>Scenario</th>
              <th scope="col" className={TABLE_STYLES.th}>Operation</th>
              <th scope="col" className={TABLE_STYLES.th}>Severity</th>
              <th scope="col" className={TABLE_STYLES.th}>Can it run?</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ item, reasons, selectable }) => {
              const operation = splitOperationKey(item.operationKey);
              const severity = severityVariant(item.severity);
              const reasonId = `${base}-${item.id}-reasons`;
              return (
                <tr key={item.id} data-testid="approved-row" data-scenario-id={item.id} data-selectable={selectable}>
                  <td className={TABLE_STYLES.td}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border-control"
                      checked={selected.has(item.id)}
                      disabled={!selectable}
                      onChange={(event) => toggle(item.id, event.target.checked)}
                      aria-label={`Choose ${item.title}`}
                      aria-describedby={selectable ? undefined : reasonId}
                    />
                  </td>
                  <th scope="row" className={`${TABLE_STYLES.td} max-w-sm text-left font-medium`}>
                    {item.title}
                    <span className="block text-xs font-normal text-text-secondary">{categoryNames[item.categoryId] ?? item.categoryId}</span>
                    {item.destructive && (
                      <span className="mt-1 inline-block">
                        <StatusBadge label="Destructive" tone="danger" />
                      </span>
                    )}
                  </th>
                  <td className={TABLE_STYLES.td}>
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {operation.method && <HttpMethodBadge method={operation.method} />}
                      <span className="break-all font-mono text-xs">{operation.path}</span>
                    </span>
                  </td>
                  <td className={TABLE_STYLES.td}>
                    <StatusBadge label={severity.label} tone={severity.tone} />
                  </td>
                  <td className={`${TABLE_STYLES.td} max-w-md`}>
                    {selectable ? (
                      <StatusBadge label="Can run" tone="success" />
                    ) : (
                      <div id={reasonId}>
                        <StatusBadge label="Cannot be chosen" tone="warning" />
                        <ul className="mt-1 list-disc pl-5 text-xs text-text-secondary">
                          {reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={items.length}
        pageSizeOptions={PAGE_SIZES}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        noun="approved scenarios"
        testId="approved-pagination"
      />
    </div>
  );
}
