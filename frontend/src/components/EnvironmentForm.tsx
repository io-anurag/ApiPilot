import { useState } from "react";
import type { Environment, EnvironmentTier } from "@apipilot/shared-domain";
import {
  createEnvironment,
  updateEnvironment,
  type EnvironmentInput,
} from "../services/executionClient";
import { BUTTON_STYLES } from "./controlStyles";

const TIERS: EnvironmentTier[] = ["local", "dev", "qa", "staging", "production"];

interface VariableRow {
  key: string;
  value: string;
}

function toRows(variableValues: Record<string, string>): VariableRow[] {
  const rows = Object.entries(variableValues).map(([key, value]) => ({ key, value }));
  return rows.length > 0 ? rows : [{ key: "", value: "" }];
}

function toVariableValues(rows: VariableRow[]): Record<string, string> {
  return Object.fromEntries(
    rows.filter((row) => row.key.trim().length > 0).map((row) => [row.key.trim(), row.value]),
  );
}

/**
 * Defines or edits an `Environment` (FR-001, FR-002, FR-005, FR-011). Used both to create a new
 * environment and, passed an `initial` value, to edit one in place — `execution-api.md`'s `POST`
 * and `PUT` endpoints share the same request shape, so one form serves both.
 */
export function EnvironmentForm({
  initial,
  onSaved,
  onCancel,
}: Readonly<{
  initial?: Environment;
  onSaved: (environment: Environment) => void;
  onCancel?: () => void;
}>) {
  const [name, setName] = useState(initial?.name ?? "");
  const [tier, setTier] = useState<EnvironmentTier>(initial?.tier ?? "local");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [requestDelayMs, setRequestDelayMs] = useState(initial?.requestDelayMs ?? 0);
  const [rows, setRows] = useState<VariableRow[]>(() => toRows(initial?.variableValues ?? {}));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateRow(index: number, patch: Partial<VariableRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
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

  return (
    <div
      data-testid="environment-form"
      className="space-y-3 rounded-md border border-border bg-slate-50 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="environment-form-name" className="text-xs font-medium text-muted">
            Name
          </label>
          <input
            id="environment-form-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="environment-form-tier" className="text-xs font-medium text-muted">
            Tier
          </label>
          <select
            id="environment-form-tier"
            value={tier}
            onChange={(event) => setTier(event.target.value as EnvironmentTier)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
          >
            {TIERS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor="environment-form-base-url" className="text-xs font-medium text-muted">
            Base URL
          </label>
          <input
            id="environment-form-base-url"
            type="text"
            placeholder="https://api.example.com"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="environment-form-delay" className="text-xs font-medium text-muted">
            Pause between requests (ms)
          </label>
          <input
            id="environment-form-delay"
            type="number"
            min={0}
            value={requestDelayMs}
            onChange={(event) => setRequestDelayMs(Math.max(0, Number(event.target.value) || 0))}
            className="w-32 rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted">
          Variable values (e.g. credentials the collection references)
        </p>
        {rows.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="text"
              placeholder="variable name"
              value={row.key}
              onChange={(event) => updateRow(index, { key: event.target.value })}
              className="w-40 rounded-md border border-border bg-surface px-2 py-1 text-sm font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
            />
            <input
              type="text"
              placeholder="value"
              value={row.value}
              onChange={(event) => updateRow(index, { value: event.target.value })}
              className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
            />
            <button
              type="button"
              aria-label={`Remove variable row ${index + 1}`}
              onClick={() => removeRow(index)}
              className="text-sm text-muted hover:text-danger-700"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRows((current) => [...current, { key: "", value: "" }])}
          className="text-sm font-medium text-brand-700 hover:text-brand-800"
        >
          + Add variable
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger-700">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={BUTTON_STYLES.primary}
        >
          {saving ? "Saving…" : initial ? "Save changes" : "Add environment"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={BUTTON_STYLES.secondary}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
