import { COVERAGE_GAP_KINDS, COVERAGE_STATES, type CoverageFilter, type CoveragePriority, type CoverageState } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { GAP_KIND_LABELS, PRIORITY_LABELS, STATE_LABELS } from "./coverageViewModel";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const FIELD =
  "rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1";

export const EMPTY_FILTER: CoverageFilter = { sort: "priority", order: "asc" };

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-semibold text-muted">
      {label}
      {children}
    </label>
  );
}

/** True when any narrowing filter (not the sort) is set. */
export function isFiltered(filter: CoverageFilter): boolean {
  return Boolean(
    filter.methods?.length || filter.q || filter.states?.length || filter.category || filter.priorities?.length || filter.gapKind,
  );
}

/**
 * Filters for the gaps table (FR-023): endpoint text, method, requirement state, scenario category,
 * priority, and gap type (missing, failed, insufficient evidence, needs re-execution). The state
 * filter keeps operations with at least one requirement in that state. The security category is
 * listed but disabled, because that dimension is unavailable until scenarios can be classified by
 * authorization intent.
 */
export function GapFilters({
  value,
  onChange,
  onReset,
}: Readonly<{ value: CoverageFilter; onChange: (next: CoverageFilter) => void; onReset: () => void }>) {
  const set = (patch: Partial<CoverageFilter>): void => onChange({ ...value, ...patch });
  return (
    <form
      role="search"
      aria-label="Filter coverage gaps"
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => event.preventDefault()}
    >
      <Field label="Endpoint">
        <input
          type="search"
          value={value.q ?? ""}
          onChange={(event) => set({ q: event.target.value })}
          placeholder="Path contains..."
          className={FIELD}
        />
      </Field>
      <Field label="Method">
        <select
          value={value.methods?.[0] ?? ""}
          onChange={(event) => set({ methods: event.target.value ? [event.target.value] : undefined })}
          className={FIELD}
        >
          <option value="">All</option>
          {METHODS.map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Requirement state">
        <select
          value={value.states?.[0] ?? ""}
          onChange={(event) => set({ states: event.target.value ? [event.target.value as CoverageState] : undefined })}
          className={FIELD}
        >
          <option value="">All</option>
          {COVERAGE_STATES.map((state) => (
            <option key={state} value={state}>
              {STATE_LABELS[state]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Scenario category">
        <select
          value={value.category ?? ""}
          onChange={(event) => set({ category: (event.target.value || undefined) as CoverageFilter["category"] })}
          className={FIELD}
        >
          <option value="">All</option>
          <option value="positive">Positive</option>
          <option value="negative">Negative</option>
          <option value="boundary">Boundary</option>
          <option value="security" disabled title="No scenario category identifies authorization intent.">
            Security (unavailable)
          </option>
        </select>
      </Field>
      <Field label="Priority">
        <select
          value={value.priorities?.[0] ?? ""}
          onChange={(event) => set({ priorities: event.target.value ? [event.target.value as CoveragePriority] : undefined })}
          className={FIELD}
        >
          <option value="">All</option>
          {(Object.keys(PRIORITY_LABELS) as CoveragePriority[]).map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Gap type">
        <select
          value={value.gapKind ?? ""}
          onChange={(event) => set({ gapKind: (event.target.value || undefined) as CoverageFilter["gapKind"] })}
          className={FIELD}
        >
          <option value="">All</option>
          {COVERAGE_GAP_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {GAP_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </Field>
      <button type="button" onClick={onReset} disabled={!isFiltered(value)} className={BUTTON_STYLES.secondary}>
        Reset filters
      </button>
    </form>
  );
}
