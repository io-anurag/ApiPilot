import { useEffect, useRef, useState } from "react";
import type { Environment, EnvironmentTier } from "@apipilot/shared-domain";
import {
  createEnvironment,
  updateEnvironment,
  type EnvironmentInput,
} from "../services/environmentsClient";
import { BUTTON_STYLES } from "./controlStyles";
import { ErrorState } from "./ErrorState";

/**
 * Defines or edits an `Environment` (AP-017 FR-001, FR-002, FR-005). Restored from commit 32930ed
 * for AP-029, whose user-supplied values are environment variable values (FR-013). Values are
 * typed into plain text inputs with autocomplete off; `suggestedNames` pre-fills rows for the
 * values a plan needs.
 */
const TIERS: EnvironmentTier[] = ["local", "dev", "qa", "staging", "production"];
const INPUT =
  "rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1";
/** Denser than `INPUT`: a plan can suggest dozens of value rows. */
const ROW_INPUT =
  "min-w-0 rounded border border-border bg-surface px-2 py-1 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";

interface VariableRow {
  key: string;
  value: string;
}

function toRows(
  variableValues: Record<string, string>,
  suggestedNames: readonly string[],
): VariableRow[] {
  const rows = Object.entries(variableValues).map(([key, value]) => ({ key, value }));
  for (const name of suggestedNames)
    if (!rows.some((row) => row.key === name)) rows.push({ key: name, value: "" });
  return rows.length > 0 ? rows : [{ key: "", value: "" }];
}

function toVariableValues(rows: VariableRow[]): Record<string, string> {
  return Object.fromEntries(
    rows
      .filter((row) => row.key.trim().length > 0 && row.value.length > 0)
      .map((row) => [row.key.trim(), row.value]),
  );
}

export function EnvironmentForm({
  initial,
  suggestedNames = [],
  onSaved,
  onCancel,
  onNameChange,
}: Readonly<{
  initial?: Environment;
  suggestedNames?: readonly string[];
  onSaved: (environment: Environment) => void;
  onCancel?: () => void;
  /** Reports the Name field as typed, so a surrounding dialog can title itself with it. */
  onNameChange?: (name: string) => void;
}>) {
  const [name, setName] = useState(initial?.name ?? "");
  const [tier, setTier] = useState<EnvironmentTier>(initial?.tier ?? "local");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [requestDelayMs, setRequestDelayMs] = useState(initial?.requestDelayMs ?? 0);
  const [rows, setRows] = useState<VariableRow[]>(() =>
    toRows(
      initial?.variableValues ?? {},
      suggestedNames.filter((n) => n !== "baseUrl"),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusLastRow = useRef(false);

  // "+ Add variable" focuses the new row, which also scrolls it into view in the value list.
  useEffect(() => {
    if (!focusLastRow.current) return;
    focusLastRow.current = false;
    listRef.current?.lastElementChild?.querySelector("input")?.focus();
  }, [rows.length]);

  function updateRow(index: number, patch: Partial<VariableRow>) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    const input: EnvironmentInput = {
      name: name.trim(),
      tier,
      baseUrl: baseUrl.trim(),
      variableValues: toVariableValues(rows),
      requestDelayMs,
    };
    const result = initial
      ? await updateEnvironment(initial.id, input)
      : await createEnvironment(input);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(result.environment);
  }

  const canSubmit = name.trim().length > 0 && baseUrl.trim().length > 0 && !saving;
  const filledCount = rows.filter((row) => row.value.length > 0).length;
  const trimmedName = name.trim();
  let submitLabel = initial ? "Save changes" : "Add environment";
  if (trimmedName.length > 0) submitLabel = `Save ${trimmedName}`;
  if (saving) submitLabel = "Saving…";

  return (
    <div data-testid="environment-form" className="flex min-h-0 flex-1 flex-col">
      <div className="scrollbar-visible min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label
              htmlFor="environment-form-name"
              className="text-xs font-medium text-muted"
            >
              Name
            </label>
            <input
              id="environment-form-name"
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                onNameChange?.(event.target.value);
              }}
              className={INPUT}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="environment-form-tier"
              className="text-xs font-medium text-muted"
            >
              Tier
            </label>
            <select
              id="environment-form-tier"
              value={tier}
              onChange={(event) => setTier(event.target.value as EnvironmentTier)}
              className={INPUT}
            >
              {TIERS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label
              htmlFor="environment-form-base-url"
              className="text-xs font-medium text-muted"
            >
              Base URL
            </label>
            <input
              id="environment-form-base-url"
              type="text"
              placeholder="https://api.example.com"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              className={`${INPUT} font-mono`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="environment-form-delay"
              className="text-xs font-medium text-muted"
            >
              Request pause (ms)
            </label>
            <input
              id="environment-form-delay"
              type="number"
              min={0}
              aria-describedby="environment-form-delay-hint"
              value={requestDelayMs}
              onChange={(event) =>
                setRequestDelayMs(Math.max(0, Number(event.target.value) || 0))
              }
              className={INPUT}
            />
            <p id="environment-form-delay-hint" className="text-xs text-muted">
              Between functional-run requests.
            </p>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted">
            Variable values{" "}
            <span className="font-normal">
              · {filledCount} of {rows.length} filled
            </span>
          </legend>
          <p className="text-xs text-muted">
            Stored encrypted; never shown again or sent to a browser in a report. Rows left
            empty are not saved.
          </p>
          {/* The list scrolls on its own so a plan with many values keeps the dialog short. */}
          <div
            ref={listRef}
            className="scrollbar-visible max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-border p-2"
          >
            {rows.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  aria-label={`Variable name ${index + 1}`}
                  placeholder="variable name"
                  value={row.key}
                  onChange={(event) => updateRow(index, { key: event.target.value })}
                  className={`${ROW_INPUT} w-2/5`}
                />
                <input
                  type="text"
                  autoComplete="off"
                  aria-label={`Value for ${row.key || `variable ${index + 1}`}`}
                  placeholder={initial && row.value ? "unchanged" : "value"}
                  value={row.value}
                  onChange={(event) => updateRow(index, { value: event.target.value })}
                  className={`${ROW_INPUT} flex-1`}
                />
                <button
                  type="button"
                  aria-label={`Remove variable row ${index + 1}`}
                  onClick={() =>
                    setRows((current) => current.filter((_, i) => i !== index))
                  }
                  className="shrink-0 rounded px-1 text-sm text-muted hover:text-danger-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:text-danger-400"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              focusLastRow.current = true;
              setRows((current) => [...current, { key: "", value: "" }]);
            }}
            className={BUTTON_STYLES.ghost}
          >
            + Add variable
          </button>
        </fieldset>

        {error && <ErrorState message={error} />}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
        {onCancel && (
          <button type="button" onClick={onCancel} className={BUTTON_STYLES.secondary}>
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`${BUTTON_STYLES.primary} max-w-full truncate`}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
