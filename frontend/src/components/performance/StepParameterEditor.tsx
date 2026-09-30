import { useId, useState } from "react";
import type { ParameterEditEntry, ParameterEditInput, StepParameterEditModel, StepParameterEditRow } from "@apipilot/shared-domain";
import type { PerformanceErrorResult } from "../../services/performanceTestingClient";
import { ConfirmDialog } from "../ConfirmDialog";
import { BUTTON_STYLES } from "../controlStyles";
import { StatusBadge } from "../StatusBadge";
import { LITERAL_VALUES_NOTE } from "./StepBodyEditor";

/**
 * AP-033 FR-020 to FR-022 (amended 2026-09-30): edits the documented path, query and header
 * parameters one step sends. Each parameter is sent with a value, or left out when it is optional.
 * The server checks and stores the step's full set of changes (`PUT /plan {parameterEdits}`),
 * keeps only those that differ from the generated request, and a refusal comes back here, on the
 * parameter it names.
 */
const NOT_EDITABLE_TEXT: Record<NonNullable<StepParameterEditRow["notEditable"]>, string> = {
  "filled-at-run-time": "Filled at run time from an earlier step.",
  "structured-value": "An array or object: it can be left out, not edited.",
};

interface Draft {
  send: boolean;
  value: string;
}

const keyOf = (row: Pick<StepParameterEditRow, "location" | "name">) => `${row.location}:${row.name}`;

function initialDrafts(model: StepParameterEditModel): Map<string, Draft> {
  return new Map(
    model.rows.map((row) => {
      if (row.edit?.action === "omit") return [keyOf(row), { send: false, value: row.generated ?? "" }];
      if (row.edit?.action === "set") return [keyOf(row), { send: true, value: row.edit.value }];
      return [keyOf(row), { send: row.generated !== null, value: row.generated ?? "" }];
    }),
  );
}

/** The step's full set of changes; rows that cannot be edited are not sent. */
function entriesOf(model: StepParameterEditModel, drafts: ReadonlyMap<string, Draft>): ParameterEditEntry[] {
  return model.rows.flatMap((row): ParameterEditEntry[] => {
    const draft = drafts.get(keyOf(row));
    if (!draft || row.notEditable === "filled-at-run-time") return [];
    if (!draft.send) return row.required ? [] : [{ location: row.location, name: row.name, action: "omit" }];
    if (row.notEditable === "structured-value") return [];
    return [{ location: row.location, name: row.name, action: "set", value: draft.value }];
  });
}

/** What the step sends for a parameter, in words, when not editing. */
function sentText(row: StepParameterEditRow): string {
  if (row.edit?.action === "omit") return "Left out";
  if (row.edit?.action === "set") return row.edit.value;
  return row.generated ?? "Not sent";
}

function schemaText(row: StepParameterEditRow): string {
  const parts = [row.type, row.format].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "—";
}

export function StepParameterEditor({
  operationKey,
  model,
  busy,
  onSave,
}: Readonly<{
  operationKey: string;
  model: StepParameterEditModel;
  busy: boolean;
  /** `null` resets every parameter to the generated request. Resolves to `null` when saved, or to the refusal. */
  onSave: (input: ParameterEditInput | null) => Promise<PerformanceErrorResult | null>;
}>) {
  const [editing, setEditing] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [drafts, setDrafts] = useState(() => initialDrafts(model));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<PerformanceErrorResult | null>(null);
  const baseId = useId();
  const errorId = `${baseId}-error`;
  const refusedKey = error?.location && error.name ? `${error.location}:${error.name}` : null;

  function update(key: string, change: Partial<Draft>) {
    setDrafts((current) => new Map(current).set(key, { ...current.get(key)!, ...change }));
  }

  function open() {
    setDrafts(initialDrafts(model));
    setError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    const refusal = await onSave({ parameters: entriesOf(model, drafts) });
    setSaving(false);
    setError(refusal);
    if (!refusal) setEditing(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold">Parameters</p>
        {model.edited && <StatusBadge label="Parameters edited" tone="info" />}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <caption className="sr-only">Documented parameters of {operationKey}</caption>
          <thead>
            <tr className="bg-chrome text-left text-muted">
              <th scope="col" className="px-2 py-1 font-semibold">Parameter</th>
              <th scope="col" className="px-2 py-1 font-semibold">In</th>
              <th scope="col" className="px-2 py-1 font-semibold">Schema</th>
              <th scope="col" className="px-2 py-1 font-semibold">Generated</th>
              <th scope="col" className="px-2 py-1 font-semibold">{editing ? "Send" : "Sent"}</th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => {
              const key = keyOf(row);
              const draft = drafts.get(key)!;
              const inputId = `${baseId}-${key}`;
              const refused = refusedKey === key;
              const listId = row.enum ? `${inputId}-values` : undefined;
              return (
                <tr key={key} className="border-t border-border align-top">
                  <td className="px-2 py-1">
                    <span className="font-mono">{row.name}</span>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {row.required && <StatusBadge label="Required" />}
                      {row.secret && <StatusBadge label="Secret" tone="warning" />}
                    </div>
                  </td>
                  <td className="px-2 py-1">{row.location}</td>
                  <td className="px-2 py-1">
                    {schemaText(row)}
                    {row.enum && <div className="text-muted">One of: {row.enum.join(", ")}</div>}
                  </td>
                  <td className="px-2 py-1 font-mono break-all">{row.generated ?? <span className="font-sans text-muted">Not sent</span>}</td>
                  <td className="px-2 py-1">
                    {!editing && <span className={`break-all ${row.edit ? "font-semibold" : ""} ${row.edit?.action === "omit" ? "" : "font-mono"}`}>{sentText(row)}</span>}
                    {editing && row.notEditable === "filled-at-run-time" && <span className="text-muted">{NOT_EDITABLE_TEXT["filled-at-run-time"]}</span>}
                    {editing && row.notEditable !== "filled-at-run-time" && (
                      <div className="space-y-1">
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={draft.send}
                            disabled={row.required}
                            onChange={(event) => update(key, { send: event.target.checked })}
                            className="h-3.5 w-3.5 accent-brand-600"
                          />
                          <span>{row.required ? "Always sent" : "Send"}</span>
                        </label>
                        {row.notEditable === "structured-value" ? (
                          <p className="text-muted">{NOT_EDITABLE_TEXT["structured-value"]}</p>
                        ) : (
                          draft.send && (
                            <>
                              <label htmlFor={inputId} className="sr-only">
                                Value of {row.location} parameter {row.name}
                              </label>
                              <input
                                id={inputId}
                                type="text"
                                list={listId}
                                spellCheck={false}
                                value={draft.value}
                                placeholder={row.secret ? "{{name}}" : undefined}
                                onChange={(event) => update(key, { value: event.target.value })}
                                aria-invalid={refused}
                                aria-describedby={refused ? errorId : undefined}
                                className={`w-full min-w-40 rounded-md border bg-surface px-2 py-1 font-mono text-xs text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-100 ${refused ? "border-danger-500" : "border-border"}`}
                              />
                              {row.enum && (
                                <datalist id={listId}>
                                  {row.enum.map((value) => (
                                    <option key={value} value={value} />
                                  ))}
                                </datalist>
                              )}
                            </>
                          )
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger-700 dark:text-danger-100">
          {error.message}
        </p>
      )}
      {editing ? (
        <div className="space-y-2">
          <p className="text-xs text-muted">{LITERAL_VALUES_NOTE}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON_STYLES.primary} disabled={busy || saving} onClick={() => void save()}>
              Save parameters
            </button>
            <button
              type="button"
              className={BUTTON_STYLES.secondary}
              disabled={saving}
              onClick={() => {
                setError(null);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-4">
          <button type="button" className={BUTTON_STYLES.ghost} onClick={open}>
            Edit parameters
          </button>
          {model.edited && (
            <button type="button" className={BUTTON_STYLES.ghost} disabled={busy} onClick={() => setConfirmingReset(true)}>
              Reset to generated parameters
            </button>
          )}
        </div>
      )}
      {confirmingReset && (
        <ConfirmDialog
          message={`The parameters of ${operationKey} go back to those generated from the specification.`}
          affectedCount={1}
          confirmLabel="Reset parameters"
          onConfirm={() => {
            setConfirmingReset(false);
            void onSave(null).then(setError);
          }}
          onCancel={() => setConfirmingReset(false)}
        />
      )}
    </div>
  );
}
