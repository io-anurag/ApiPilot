import { useEffect, useId, useState } from "react";
import {
  EXECUTION_STATUSES,
  SECURITY_REVIEW_STATES,
  SEVERITIES,
  type ExecutionStatus,
  type ScenarioListCounts,
  type SecurityCategory,
  type SecurityReviewState,
  type Severity,
} from "@apipilot/shared-domain";
import type { ScenarioFilterQuery } from "../../services/securityLabClient";
import { BUTTON_STYLES, FIELD_STYLES } from "../controlStyles";
import { FLAG_FILTER_OPTIONS, activeFilterCount, withFilter } from "./scenarioViewModel";
import { executionStatusVariant, reviewStateVariant, severityVariant, SEVERITY_ORDER } from "./securityViewModel";

/** One labelled select. The empty option is "Any", which removes the filter. */
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

function CountLine({ label, entries }: Readonly<{ label: string; entries: ReadonlyArray<{ key: string; text: string; count: number }> }>) {
  const present = entries.filter((entry) => entry.count > 0);
  return (
    <p className="text-xs text-text-secondary">
      <span className="font-medium text-text-primary">{label}: </span>
      {present.length === 0 ? "none" : present.map((entry) => `${entry.text} ${entry.count}`).join(", ")}
    </p>
  );
}

/**
 * The scenario filters (specs/057 FR-032): search, operation, category, severity, review state, execution status and
 * derived flag. Selects apply at once; the two text fields apply when submitted so a request is not sent per
 * keystroke. The counts describe everything the current filters match (the server tallies them over the filtered
 * set), so a facet never reports figures for scenarios the list is not showing.
 */
export function ScenarioFilters({
  value,
  onChange,
  categories,
  counts,
}: Readonly<{
  value: ScenarioFilterQuery;
  onChange: (next: ScenarioFilterQuery) => void;
  categories: readonly SecurityCategory[];
  counts: ScenarioListCounts | undefined;
}>) {
  const searchId = useId();
  const operationId = useId();
  const [q, setQ] = useState(value.q ?? "");
  const [operation, setOperation] = useState(value.operation ?? "");

  // A filter cleared or changed elsewhere (Clear filters) replaces what the text fields show.
  useEffect(() => setQ(value.q ?? ""), [value.q]);
  useEffect(() => setOperation(value.operation ?? ""), [value.operation]);

  const categoryOptions = categories.filter((category) => category.generatable).map((category) => ({ value: category.id, label: category.name }));
  const active = activeFilterCount(value);

  return (
    <section aria-label="Scenario filters" className="space-y-3" data-testid="scenario-filters">
      <form
        role="search"
        aria-label="Search scenarios"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onChange(withFilter(withFilter(value, "q", q.trim()), "operation", operation.trim()));
        }}
      >
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor={searchId} className="text-xs font-medium text-text-secondary">
            Search title, operation or id
          </label>
          <input id={searchId} type="search" value={q} onChange={(event) => setQ(event.target.value)} autoComplete="off" className={FIELD_STYLES} />
        </div>
        <div className="flex min-w-48 flex-col gap-1">
          <label htmlFor={operationId} className="text-xs font-medium text-text-secondary">
            Operation (exact, such as GET /orders)
          </label>
          <input id={operationId} type="text" value={operation} onChange={(event) => setOperation(event.target.value)} autoComplete="off" spellCheck={false} className={`${FIELD_STYLES} font-mono`} />
        </div>
        <button type="submit" className={BUTTON_STYLES.secondary}>
          Search
        </button>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <FilterSelect label="Category" value={value.category ?? ""} onChange={(next) => onChange(withFilter(value, "category", next))} options={categoryOptions} />
        <FilterSelect
          label="Severity"
          value={value.severity ?? ""}
          onChange={(next) => onChange(withFilter(value, "severity", next as Severity | ""))}
          options={SEVERITY_ORDER.map((severity) => ({ value: severity, label: severityVariant(severity).label }))}
        />
        <FilterSelect
          label="Review state"
          value={value.reviewState ?? ""}
          onChange={(next) => onChange(withFilter(value, "reviewState", next as SecurityReviewState | ""))}
          options={SECURITY_REVIEW_STATES.map((state) => ({ value: state, label: reviewStateVariant(state).label }))}
        />
        <FilterSelect
          label="Execution status"
          value={value.executionStatus ?? ""}
          onChange={(next) => onChange(withFilter(value, "executionStatus", next as ExecutionStatus | ""))}
          options={EXECUTION_STATUSES.map((status) => ({ value: status, label: executionStatusVariant(status).label }))}
        />
        <FilterSelect
          label="Flag"
          value={value.flag ?? ""}
          onChange={(next) => onChange(withFilter(value, "flag", next as ScenarioFilterQuery["flag"] | ""))}
          options={FLAG_FILTER_OPTIONS.filter((option) => option.value !== "").map((option) => ({ value: option.value, label: option.label }))}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5" aria-label="Counts for the matching scenarios">
          {counts && (
            <>
              <CountLine
                label="Review state"
                entries={SECURITY_REVIEW_STATES.map((state) => ({ key: state, text: reviewStateVariant(state).label, count: counts.byReviewState[state] ?? 0 }))}
              />
              <CountLine
                label="Execution status"
                entries={EXECUTION_STATUSES.map((status) => ({ key: status, text: executionStatusVariant(status).label, count: counts.byExecutionStatus[status] ?? 0 }))}
              />
              <CountLine label="Severity" entries={SEVERITIES.map((severity) => ({ key: severity, text: severityVariant(severity).label, count: counts.bySeverity[severity] ?? 0 }))} />
            </>
          )}
        </div>
        <button type="button" onClick={() => onChange({})} disabled={active === 0} className={BUTTON_STYLES.secondary}>
          Clear filters{active > 0 ? ` (${active})` : ""}
        </button>
      </div>
    </section>
  );
}
