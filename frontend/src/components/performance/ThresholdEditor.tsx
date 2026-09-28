import { useState } from "react";
import type { PerformanceThreshold, PerformanceThresholdMetric } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";

/**
 * User-set pass/fail thresholds (FR-018, FR-037). Empty by default: ApiPilot proposes no targets.
 */
type ThresholdInput = Omit<PerformanceThreshold, "id">;

const METRICS: { value: PerformanceThresholdMetric; label: string }[] = [
  { value: "p50", label: "p50 latency (ms)" },
  { value: "p90", label: "p90 latency (ms)" },
  { value: "p95", label: "p95 latency (ms)" },
  { value: "p99", label: "p99 latency (ms)" },
  { value: "error-rate", label: "Failure rate (%)" },
];

export function ThresholdEditor({
  thresholds,
  steps,
  busy,
  onSave,
}: Readonly<{
  thresholds: PerformanceThreshold[];
  steps: { id: string; label: string }[];
  busy: boolean;
  onSave: (thresholds: ThresholdInput[]) => void;
}>) {
  const [scope, setScope] = useState("run");
  const [metric, setMetric] = useState<PerformanceThresholdMetric>("p95");
  const [limit, setLimit] = useState("");
  const withoutId = (threshold: PerformanceThreshold): ThresholdInput => ({ scope: threshold.scope, metric: threshold.metric, comparator: "<=", limit: threshold.limit });
  const stepLabel = (stepId: string) => steps.find((step) => step.id === stepId)?.label ?? stepId;
  const limitValue = Number(limit);
  const canAdd = limit.trim().length > 0 && Number.isFinite(limitValue);

  return (
    <div className="space-y-3">
      {thresholds.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted">No thresholds set. The report will show measurements with no pass/fail verdict.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {thresholds.map((threshold) => (
            <li key={threshold.id} className="flex items-center justify-between gap-2">
              <span>
                {threshold.scope.kind === "run" ? "Run" : stepLabel(threshold.scope.stepId)} · {METRICS.find((m) => m.value === threshold.metric)?.label} ≤{" "}
                <strong className="font-mono">{threshold.limit}</strong>
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
          <select value={scope} onChange={(event) => setScope(event.target.value)} className="max-w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-slate-900 dark:text-slate-100">
            <option value="run">Whole run</option>
            {steps.map((step) => (
              <option key={step.id} value={step.id}>
                {step.label}
              </option>
            ))}
          </select>
        </label>
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
            onSave([
              ...thresholds.map(withoutId),
              { scope: scope === "run" ? { kind: "run" } : { kind: "step", stepId: scope }, metric, comparator: "<=", limit: limitValue },
            ]);
            setLimit("");
          }}
        >
          + Add threshold
        </button>
      </fieldset>
    </div>
  );
}
