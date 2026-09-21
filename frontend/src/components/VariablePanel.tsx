import { useEffect, useRef, useState } from "react";
import type { VariableBinding } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "./controlStyles";
import { ErrorState } from "./ErrorState";

interface VariableRow {
  name: string;
  value: string;
  source: VariableBinding["source"] | "new";
  referenced: boolean;
}

function toRows(variables: VariableBinding[]): VariableRow[] {
  return variables.map((v) => ({ name: v.name, value: v.value ?? "", source: v.source, referenced: v.referenced }));
}

const SOURCE_LABEL: Record<VariableRow["source"], string> = {
  "collection-default": "Collection default",
  environment: "Environment",
  new: "Not yet saved",
};

/**
 * Every variable available to the loaded collection (FR-003), editable per row (FR-004, FR-018),
 * saving via a single `PUT .../variables` call whose response immediately updates every visible
 * request preview elsewhere on the page (FR-005). Shows which of the two persisted source tiers
 * (research.md D8) a value currently resolves from, plus a client-side-only "changed in this
 * session" dot for a value the user has edited since the view loaded (Story 3) — not itself a
 * third persisted tier.
 */
export function VariablePanel({
  variables,
  locked,
  onSave,
}: Readonly<{
  variables: VariableBinding[];
  locked: boolean;
  onSave: (variableValues: Record<string, string>) => Promise<void>;
}>) {
  const [rows, setRows] = useState<VariableRow[]>(() => toRows(variables));
  const initialValues = useRef<Record<string, string>>(Object.fromEntries(rows.map((r) => [r.name, r.value])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-syncs the local edit buffer from `variables` whenever the parent's own copy actually
  // changes — most importantly right after a successful save, when the parent re-fetches the
  // collection view and passes back the just-saved values. Without this, `rows` stayed exactly
  // as it was when the panel first mounted (a plain `useState` initializer only ever runs once),
  // so a freshly saved variable kept showing its pre-save "Not yet saved" source label forever.
  // Deliberately keyed on this joined string, not `variables` itself (a fresh array every render).
  const variablesKey = variables.map((v) => `${v.name}=${v.value ?? ""}|${v.source}|${v.referenced}`).join(";");
  useEffect(() => {
    const nextRows = toRows(variables);
    setRows(nextRows);
    initialValues.current = Object.fromEntries(nextRows.map((r) => [r.name, r.value]));
  }, [variablesKey]);

  function updateRow(index: number, patch: Partial<Pick<VariableRow, "name" | "value">>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const variableValues = Object.fromEntries(
      rows.filter((row) => row.name.trim().length > 0 && row.value.trim().length > 0).map((row) => [row.name.trim(), row.value]),
    );
    try {
      await onSave(variableValues);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save variable values.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid="variable-panel" className="space-y-3 rounded-md border border-border bg-surface p-4">
      <p className="text-xs text-muted">
        Values used to resolve every <code>{"{{variable}}"}</code> placeholder in this collection's requests.
      </p>
      {locked && (
        <p role="status" className="rounded-md border border-warning-100 bg-warning-50 px-2 py-1 text-xs text-warning-700 dark:border-warning-500 dark:bg-warning-500/10 dark:text-warning-100">
          This collection is read-only while a run is in progress.
        </p>
      )}
      <div className="space-y-2">
        {rows.map((row, index) => {
          const changedThisSession = initialValues.current[row.name] !== undefined && initialValues.current[row.name] !== row.value;
          // Whether this row currently has a value, computed from the live edit buffer rather
          // than the `VariableBinding.resolved` snapshot the view loaded with — that snapshot
          // reflects the server's state as of the last fetch, so it went stale (and kept the
          // "missing" red styling) the moment a user typed a value into a previously-unresolved
          // row, before saving.
          const hasValue = row.value.trim().length > 0;
          return (
            <div key={index} className="flex items-center gap-2">
              {row.source === "new" ? (
                <input
                  type="text"
                  aria-label={`Name for new variable ${index + 1}`}
                  placeholder="variable name"
                  value={row.name}
                  disabled={locked}
                  onChange={(event) => updateRow(index, { name: event.target.value })}
                  className="w-40 shrink-0 rounded-md border border-border bg-surface px-2 py-1 text-sm font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
                />
              ) : (
                <span className="w-40 shrink-0 truncate font-mono text-sm" title={row.name}>
                  {row.name}
                </span>
              )}
              <input
                type="text"
                aria-label={row.source === "new" ? `Value for new variable ${index + 1}` : `Value for ${row.name}`}
                placeholder={hasValue ? undefined : "missing"}
                value={row.value}
                disabled={locked}
                onChange={(event) => updateRow(index, { value: event.target.value })}
                className={`flex-1 rounded-md border px-2 py-1 text-sm font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50 ${hasValue ? "border-border bg-surface" : "border-danger-200 bg-danger-50 dark:border-danger-500 dark:bg-danger-500/10"}`}
              />
              <span className="w-32 shrink-0 text-xs text-muted">{SOURCE_LABEL[row.source]}</span>
              {changedThisSession && (
                <span aria-label="Changed in this session" title="Changed in this session" className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />
              )}
              {!row.referenced && (
                <span className="shrink-0 text-[10px] uppercase text-muted">unreferenced</span>
              )}
              <button
                type="button"
                aria-label={row.source === "new" ? `Remove new variable ${index + 1}` : `Remove ${row.name}`}
                disabled={locked}
                onClick={() => removeRow(index)}
                className="text-sm text-muted hover:text-danger-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-danger-400"
              >
                ✕
              </button>
            </div>
          );
        })}
        <button
          type="button"
          disabled={locked}
          onClick={() => setRows((current) => [...current, { name: "", value: "", source: "new", referenced: false }])}
          className={BUTTON_STYLES.ghost}
        >
          + Add variable
        </button>
      </div>

      {error && <ErrorState message={error} />}

      <button type="button" onClick={handleSave} disabled={locked || saving} className={BUTTON_STYLES.primary}>
        {saving ? "Saving…" : "Save variables"}
      </button>
    </div>
  );
}
