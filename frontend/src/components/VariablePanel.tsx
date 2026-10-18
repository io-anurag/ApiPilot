import { useEffect, useRef, useState } from "react";
import type { VariableBinding } from "@apipilot/shared-domain";
import { BUTTON_STYLES, FIELD_STYLES } from "./controlStyles";
import { ErrorState } from "./ErrorState";
import { Banner } from "./patterns/Banner";
import { Card } from "./patterns/Card";
import { Pill } from "./patterns/Pill";

interface VariableRow {
  name: string;
  value: string;
  source: VariableBinding["source"] | "new";
  referenced: boolean;
}

function toRows(variables: VariableBinding[]): VariableRow[] {
  return variables.map((v) => ({
    name: v.name,
    value: v.value ?? "",
    source: v.source,
    referenced: v.referenced,
  }));
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
  onClose,
}: Readonly<{
  variables: VariableBinding[];
  locked: boolean;
  onSave: (variableValues: Record<string, string>) => Promise<void>;
  /** Deselects this panel (returns the main pane to its empty-selection placeholder) — mirrors
   * `RequestEditorPanel`'s own close control, rather than a single button that dismissed the
   * whole tree+editor section. */
  onClose: () => void;
}>) {
  const [rows, setRows] = useState<VariableRow[]>(() => toRows(variables));
  const initialValues = useRef<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.name, r.value])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-syncs the local edit buffer from `variables` whenever the parent's own copy actually
  // changes — most importantly right after a successful save, when the parent re-fetches the
  // collection view and passes back the just-saved values. Without this, `rows` stayed exactly
  // as it was when the panel first mounted (a plain `useState` initializer only ever runs once),
  // so a freshly saved variable kept showing its pre-save "Not yet saved" source label forever.
  // Deliberately keyed on this joined string, not `variables` itself (a fresh array every render).
  const variablesKey = variables
    .map((v) => `${v.name}=${v.value ?? ""}|${v.source}|${v.referenced}`)
    .join(";");
  useEffect(() => {
    const nextRows = toRows(variables);
    setRows(nextRows);
    initialValues.current = Object.fromEntries(nextRows.map((r) => [r.name, r.value]));
  }, [variablesKey]);

  function updateRow(index: number, patch: Partial<Pick<VariableRow, "name" | "value">>) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const variableValues = Object.fromEntries(
      rows
        .filter((row) => row.name.trim().length > 0)
        .map((row) => [row.name.trim(), row.value]),
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
    <Card data-testid="variable-panel" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-text-secondary">
          Values used to resolve every <code>{"{{variable}}"}</code> placeholder in this
          collection's requests.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={locked || saving}
            className={BUTTON_STYLES.primary}
          >
            {saving ? "Saving…" : "Save variables"}
          </button>
          <button type="button" onClick={onClose} className={BUTTON_STYLES.secondary}>
            ✕ Close
          </button>
        </div>
      </div>
      {locked && (
        <Banner tone="warning" role="status" title="This collection is read-only while a run is in progress." />
      )}
      <div className="space-y-3">
        {rows.map((row, index) => {
          const changedThisSession =
            initialValues.current[row.name] !== undefined &&
            initialValues.current[row.name] !== row.value;
          // Whether this row currently has a value, computed from the live edit buffer rather
          // than the `VariableBinding.resolved` snapshot the view loaded with — that snapshot
          // reflects the server's state as of the last fetch, so it went stale (and kept the
          // "missing" red styling) the moment a user typed a value into a previously-unresolved
          // row, before saving.
          const hasValue = row.value.trim().length > 0;
          return (
            <div key={index} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
              {row.source === "new" ? (
                <input
                  type="text"
                  aria-label={`Name for new variable ${index + 1}`}
                  placeholder="variable name"
                  value={row.name}
                  disabled={locked}
                  onChange={(event) => updateRow(index, { name: event.target.value })}
                  className={`w-full min-w-0 font-mono ${FIELD_STYLES}`}
                />
              ) : (
                <span
                  className="min-w-0 truncate font-mono text-sm text-text-primary"
                  title={row.name}
                >
                  {row.name}
                </span>
              )}
              <input
                type="text"
                aria-label={
                  row.source === "new"
                    ? `Value for new variable ${index + 1}`
                    : `Value for ${row.name}`
                }
                placeholder={hasValue ? undefined : "missing"}
                value={row.value}
                disabled={locked}
                onChange={(event) => updateRow(index, { value: event.target.value })}
                className={`w-full min-w-0 rounded-md border px-2 py-1.5 font-mono text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${hasValue ? "border-border-control bg-surface" : "border-danger-600 bg-danger-50 dark:bg-danger-500/10"}`}
              />
              <button
                type="button"
                aria-label={
                  row.source === "new"
                    ? `Remove new variable ${index + 1}`
                    : `Remove ${row.name}`
                }
                disabled={locked}
                onClick={() => removeRow(index)}
                className="rounded text-sm text-muted hover:text-danger-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-danger-400"
              >
                ✕
              </button>
              {/* What the row is, on its own line under the value, so the three columns above line up. */}
              <div className="col-start-2 col-end-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <span>{SOURCE_LABEL[row.source]}</span>
                {changedThisSession && (
                  <span
                    aria-label="Changed in this session"
                    title="Changed in this session"
                    className="h-2 w-2 shrink-0 rounded-full bg-brand-500"
                  />
                )}
                {!row.referenced && (
                  <span className="shrink-0 uppercase">
                    <Pill tone="line">unreferenced</Pill>
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <button
          type="button"
          disabled={locked}
          onClick={() =>
            setRows((current) => [
              ...current,
              { name: "", value: "", source: "new", referenced: false },
            ])
          }
          className={BUTTON_STYLES.ghost}
        >
          + Add variable
        </button>
      </div>

      {error && <ErrorState message={error} />}
    </Card>
  );
}
