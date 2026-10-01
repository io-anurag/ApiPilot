import { useState } from "react";
import type { PerformanceThresholdMetric } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";

/**
 * User-set pass/fail thresholds (FR-018, FR-037). Empty by default: ApiPilot proposes no targets.
 *
 * AP-034 (specs/034 tasks T054): the scopes a threshold can apply to are the caller's. A plan offers
 * the whole run and its steps; a user script offers the whole run and a request name, typed by the
 * engineer with the last run's names suggested (`customScope`).
 */
export interface ThresholdDraft<S> {
  scope: S;
  metric: PerformanceThresholdMetric;
  comparator: "<=";
  limit: number;
}

export interface ThresholdScopeOption<S> {
  key: string;
  label: string;
  scope: S;
}

export interface CustomThresholdScope<S> {
  /** The select option's label, for example "A request name…". */
  optionLabel: string;
  inputLabel: string;
  suggestions: readonly string[];
  toScope: (text: string) => S;
}

const METRICS: { value: PerformanceThresholdMetric; label: string }[] = [
  { value: "p50", label: "p50 latency (ms)" },
  { value: "p90", label: "p90 latency (ms)" },
  { value: "p95", label: "p95 latency (ms)" },
  { value: "p99", label: "p99 latency (ms)" },
  { value: "error-rate", label: "Failure rate (%)" },
];

const CUSTOM_KEY = "__custom__";

export function ThresholdEditor<S>({
  thresholds,
  scopeOptions,
  scopeLabel,
  customScope,
  busy,
  onSave,
}: Readonly<{
  thresholds: ReadonlyArray<ThresholdDraft<S> & { id: string }>;
  scopeOptions: ReadonlyArray<ThresholdScopeOption<S>>;
  /** The text a saved threshold's scope is listed under. */
  scopeLabel: (scope: S) => string;
  customScope?: CustomThresholdScope<S>;
  busy: boolean;
  onSave: (thresholds: ThresholdDraft<S>[]) => void;
}>) {
  const [scopeKey, setScopeKey] = useState(scopeOptions[0]?.key ?? CUSTOM_KEY);
  const [customText, setCustomText] = useState("");
  const [metric, setMetric] = useState<PerformanceThresholdMetric>("p95");
  const [limit, setLimit] = useState("");
  const withoutId = (threshold: ThresholdDraft<S> & { id: string }): ThresholdDraft<S> => ({ scope: threshold.scope, metric: threshold.metric, comparator: "<=", limit: threshold.limit });
  const limitValue = Number(limit);
  const custom = scopeKey === CUSTOM_KEY;
  const canAdd = limit.trim().length > 0 && Number.isFinite(limitValue) && (!custom || customText.trim().length > 0);
  const chosenScope = (): S | undefined => (custom ? customScope?.toScope(customText.trim()) : scopeOptions.find((option) => option.key === scopeKey)?.scope);

  return (
    <div className="space-y-3">
      {thresholds.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted">No thresholds set. The report will show measurements with no pass/fail verdict.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {thresholds.map((threshold) => (
            <li key={threshold.id} className="flex items-center justify-between gap-2">
              <span>
                {scopeLabel(threshold.scope)} · {METRICS.find((m) => m.value === threshold.metric)?.label} ≤ <strong className="font-mono">{threshold.limit}</strong>
              </span>
              <button
                type="button"
                className={BUTTON_STYLES.ghost}
                disabled={busy}
                onClick={() => onSave(thresholds.filter((candidate) => candidate.id !== threshold.id).map(withoutId))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <fieldset className="flex min-w-0 flex-wrap items-end gap-2" disabled={busy}>
        <legend className="sr-only">Add a threshold</legend>
        {/* A step's operation key can be long; the select never grows wider than its column. */}
        <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs text-muted">
          Applies to
          <select value={scopeKey} onChange={(event) => setScopeKey(event.target.value)} className="max-w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-slate-900 dark:text-slate-100">
            {scopeOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
            {customScope && <option value={CUSTOM_KEY}>{customScope.optionLabel}</option>}
          </select>
        </label>
        {custom && customScope && (
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
            {customScope.inputLabel}
            <input
              list="threshold-custom-scope-suggestions"
              value={customText}
              onChange={(event) => setCustomText(event.target.value)}
              className="w-56 max-w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-sm"
            />
            <datalist id="threshold-custom-scope-suggestions">
              {customScope.suggestions.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-muted">
          Metric
          <select value={metric} onChange={(event) => setMetric(event.target.value as PerformanceThresholdMetric)} className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-slate-900 dark:text-slate-100">
            {METRICS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          At most
          <input type="number" value={limit} onChange={(event) => setLimit(event.target.value)} className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-sm" />
        </label>
        <button
          type="button"
          className={BUTTON_STYLES.secondary}
          disabled={!canAdd}
          onClick={() => {
            const scope = chosenScope();
            if (scope === undefined) return;
            onSave([...thresholds.map(withoutId), { scope, metric, comparator: "<=", limit: limitValue }]);
            setLimit("");
            setCustomText("");
          }}
        >
          + Add threshold
        </button>
      </fieldset>
    </div>
  );
}
