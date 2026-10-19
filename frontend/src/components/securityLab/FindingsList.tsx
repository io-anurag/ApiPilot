import { useEffect, useId, useState } from "react";
import { FINDING_STATUSES, type FindingListCounts, type FindingStatus, type SecurityCategory, type SecurityFinding, type Severity } from "@apipilot/shared-domain";
import type { FindingFilterQuery } from "../../services/securityLabClient";
import { BUTTON_STYLES, FIELD_STYLES } from "../controlStyles";
import { EmptyState } from "../EmptyState";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { Pagination } from "../Pagination";
import { StatusBadge } from "../StatusBadge";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { activeFindingFilterCount, findingTitle, occurrenceText, withFindingFilter } from "./findingViewModel";
import { splitOperationKey } from "./scenarioViewModel";
import { SEVERITY_ORDER, findingStatusVariant, severityVariant } from "./securityViewModel";

export const FINDING_PAGE_SIZES = [10, 25, 50, 100] as const;

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: Readonly<{ label: string; value: string; onChange: (value: string) => void; options: ReadonlyArray<{ value: string; label: string }> }>) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-text-secondary">
        {label}
      </label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={`${FIELD_STYLES} w-full min-w-0`}>
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The finding filters (specs/057 FR-054, FR-058): severity, status, category, operation, and the filter for findings that
 * have an occurrence not yet reviewed. The counts describe everything the filters match. Findings and occurrences are
 * counted apart, so the number of occurrences is never mistaken for a number of findings.
 */
export function FindingFilters({
  value,
  onChange,
  categories,
  counts,
  total,
}: Readonly<{
  value: FindingFilterQuery;
  onChange: (next: FindingFilterQuery) => void;
  categories: readonly SecurityCategory[];
  counts: FindingListCounts | undefined;
  total: number | undefined;
}>) {
  const operationId = useId();
  const unreviewedId = useId();
  const [operation, setOperation] = useState(value.operation ?? "");
  useEffect(() => setOperation(value.operation ?? ""), [value.operation]);
  const active = activeFindingFilterCount(value);

  return (
    <section aria-label="Finding filters" className="space-y-3" data-testid="finding-filters">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect
          label="Severity"
          value={value.severity ?? ""}
          onChange={(next) => onChange(withFindingFilter(value, "severity", next as Severity | ""))}
          options={SEVERITY_ORDER.map((severity) => ({ value: severity, label: severityVariant(severity).label }))}
        />
        <FilterSelect
          label="Status"
          value={value.status ?? ""}
          onChange={(next) => onChange(withFindingFilter(value, "status", next as FindingStatus | ""))}
          options={FINDING_STATUSES.map((status) => ({ value: status, label: findingStatusVariant(status).label }))}
        />
        <FilterSelect
          label="Category"
          value={value.category ?? ""}
          onChange={(next) => onChange(withFindingFilter(value, "category", next))}
          options={categories.filter((category) => category.generatable).map((category) => ({ value: category.id, label: category.name }))}
        />
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onChange(withFindingFilter(value, "operation", operation.trim()));
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={operationId} className="text-xs font-medium text-text-secondary">
              Operation (exact, such as GET /orders)
            </label>
            <input id={operationId} type="text" value={operation} onChange={(event) => setOperation(event.target.value)} autoComplete="off" spellCheck={false} className={`${FIELD_STYLES} font-mono`} />
          </div>
          <button type="submit" className={BUTTON_STYLES.secondary}>
            Apply
          </button>
        </form>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor={unreviewedId} className="flex items-center gap-2 text-sm text-text-primary">
          <input
            id={unreviewedId}
            type="checkbox"
            className="h-4 w-4 rounded border-border-control"
            checked={value.unreviewed === true}
            onChange={(event) => onChange(withFindingFilter(value, "unreviewed", event.target.checked ? true : ""))}
          />
          Only findings with an unreviewed occurrence
        </label>
        <button type="button" onClick={() => onChange({})} disabled={active === 0} className={BUTTON_STYLES.secondary}>
          Clear filters{active > 0 ? ` (${active})` : ""}
        </button>
      </div>
      {counts && total !== undefined && (
        <p className="text-xs text-text-secondary" data-testid="finding-counts">
          <span className="font-medium text-text-primary">{total} {total === 1 ? "finding" : "findings"}</span> match. Occurrences are counted separately: {counts.occurrences} in all,
          and {counts.withUnreviewedOccurrence} {counts.withUnreviewedOccurrence === 1 ? "finding has" : "findings have"} one not yet reviewed.
        </p>
      )}
    </section>
  );
}

/**
 * The findings as a semantic table (specs/057 FR-054 to FR-058). Severity and status are text badges with their words;
 * the number of occurrences sits beside each finding as text and is never added to the finding count; a finding with
 * an occurrence that arrived while it was accepted or marked false positive carries a visible "Unreviewed occurrence"
 * marker. A finding is opened by its name, a real button.
 */
export function FindingsList({
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
  items: readonly SecurityFinding[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  categoryNames: Readonly<Record<string, string>>;
  filtered: boolean;
  onClearFilters: () => void;
}>) {
  if (total === 0) {
    return filtered ? (
      <div className="space-y-2">
        <EmptyState message="No findings match these filters." description="Nothing is hidden or lost: clear the filters to see every finding." testId="finding-list-empty" />
        <button type="button" onClick={onClearFilters} className={BUTTON_STYLES.secondary}>
          Clear filters
        </button>
      </div>
    ) : (
      <EmptyState message="There are no findings." description="A finding appears only when a request sent by a run did not behave as expected. No finding is not proof of safety." testId="finding-list-empty" />
    );
  }

  return (
    <div className="space-y-3" data-testid="finding-list">
      <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label="Security findings">
        <table className={TABLE_STYLES.table}>
          <caption className="sr-only">Security findings with severity, status and number of occurrences</caption>
          <thead>
            <tr>
              <th scope="col" className={TABLE_STYLES.th}>Finding</th>
              <th scope="col" className={TABLE_STYLES.th}>Severity</th>
              <th scope="col" className={TABLE_STYLES.th}>Status</th>
              <th scope="col" className={TABLE_STYLES.th}>Occurrences</th>
              <th scope="col" className={TABLE_STYLES.th}>Scenario version</th>
            </tr>
          </thead>
          <tbody>
            {items.map((finding) => {
              const operation = splitOperationKey(finding.operationKey);
              const severity = severityVariant(finding.severity.current);
              const status = findingStatusVariant(finding.status);
              const selected = finding.id === selectedId;
              return (
                <tr key={finding.id} data-testid="finding-row" data-finding-id={finding.id} className={selected ? "bg-surface-subtle" : undefined}>
                  <th scope="row" className={`${TABLE_STYLES.td} max-w-md text-left font-medium`}>
                    <button
                      type="button"
                      onClick={() => onSelect(finding.id)}
                      aria-current={selected ? "true" : undefined}
                      className="text-left font-medium text-brand-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300"
                    >
                      {findingTitle(finding, categoryNames[finding.categoryId])}
                    </button>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-normal text-text-secondary">
                      {operation.method && <HttpMethodBadge method={operation.method} />}
                      <span className="break-all font-mono">{operation.path}</span>
                    </span>
                    <span className="block text-xs font-normal text-text-secondary">{finding.expected.statement}</span>
                  </th>
                  <td className={TABLE_STYLES.td}>
                    <StatusBadge label={severity.label} tone={severity.tone} />
                    {finding.severity.current !== finding.severity.suggested && (
                      <span className="block text-xs text-text-secondary">Suggested {severityVariant(finding.severity.suggested).label.toLowerCase()}</span>
                    )}
                  </td>
                  <td className={TABLE_STYLES.td}>
                    <StatusBadge label={status.label} tone={status.tone} />
                  </td>
                  <td className={TABLE_STYLES.td}>
                    <span className="block">{occurrenceText(finding.occurrenceCount)}</span>
                    {finding.unreviewedOccurrence && (
                      <span className="mt-1 inline-block">
                        <StatusBadge label="Unreviewed occurrence" tone="warning" title="A new occurrence arrived after you decided on this finding. Review it and acknowledge it." />
                      </span>
                    )}
                  </td>
                  <td className={TABLE_STYLES.td}>Version {finding.scenarioVersion}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        pageSizeOptions={FINDING_PAGE_SIZES}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        noun="findings"
        testId="finding-pagination"
      />
    </div>
  );
}
