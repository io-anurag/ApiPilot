import { useEffect, useState } from "react";
import type { MappedValueStatus, UserScriptValueMapping, UserScriptValueSource } from "@apipilot/shared-domain";
import { MAPPING_NAME_REFUSAL_TEXT, validateMappingName } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { StatusBadge } from "../StatusBadge";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { SCRIPT_INPUT } from "./ScriptPanel";

type Entry = Pick<UserScriptValueMapping, "name" | "source"> & { foundInScript: boolean };

/**
 * The names the script receives and where each value comes from (AP-034 FR-025, FR-026; research
 * R12; layout: specs/051-user-script-page-redesign FR-007). Names and sources only: a value is never
 * shown, so every row says "value hidden" in text. Present or missing is shown for the chosen
 * environment; a missing value never blocks a run.
 */
export function ValueMappingEditor({
  mapping,
  removedNames,
  statuses,
  environmentValueNames,
  busy,
  onSave,
}: Readonly<{
  mapping: readonly UserScriptValueMapping[];
  removedNames: readonly string[];
  /** For the chosen environment; null when none is chosen. */
  statuses: readonly MappedValueStatus[] | null;
  /** The chosen environment's value names, suggested as sources. */
  environmentValueNames: readonly string[];
  busy: boolean;
  onSave: (mapping: Pick<UserScriptValueMapping, "name" | "source">[], removedNames: string[]) => void;
}>) {
  const [rows, setRows] = useState<Entry[]>(() => mapping.map((entry) => ({ ...entry })));
  const [newName, setNewName] = useState("");
  useEffect(() => setRows(mapping.map((entry) => ({ ...entry }))), [mapping]);

  const refusal = newName.trim() === "" ? null : validateMappingName(newName.trim());
  const duplicate = rows.some((row) => row.name === newName.trim());
  const statusOf = (name: string) => statuses?.find((status) => status.name === name);
  let nameProblem = "";
  if (refusal) nameProblem = MAPPING_NAME_REFUSAL_TEXT[refusal];
  else if (duplicate) nameProblem = "This name is already mapped.";
  const dirty = JSON.stringify(rows.map(({ name, source }) => ({ name, source }))) !== JSON.stringify(mapping.map(({ name, source }) => ({ name, source })));

  function setSource(name: string, source: UserScriptValueSource) {
    setRows((current) => current.map((row) => (row.name === name ? { ...row, source } : row)));
  }

  function save(nextRows: Entry[], removed: string[]) {
    onSave(
      nextRows.map(({ name, source }) => ({ name, source })),
      removed,
    );
  }

  return (
    <div className="space-y-4" data-testid="value-mapping-editor">
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong bg-surface-subtle p-4 text-sm text-text-secondary">The script reads no environment values that ApiPilot could find. Add a name it builds at run time below.</p>
      ) : (
        <div role="region" aria-label="Environment values table" tabIndex={0} className={`${TABLE_STYLES.scroll} focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}>
          <table className={TABLE_STYLES.table}>
            <caption className="sr-only">Environment values the script receives</caption>
            <thead>
              <tr>
                <th scope="col" className={TABLE_STYLES.th}>Name the script reads</th>
                <th scope="col" className={TABLE_STYLES.th}>Comes from</th>
                <th scope="col" className={TABLE_STYLES.th}>In the chosen environment</th>
                <th scope="col" className={TABLE_STYLES.th}>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = statusOf(row.name);
                return (
                  <tr key={row.name} className="align-top">
                    <td className={TABLE_STYLES.td}>
                      <code className="font-mono text-xs font-semibold text-text-primary">{row.name}</code>
                      {!row.foundInScript && (
                        <div className="mt-1">
                          <StatusBadge label="Not found in the script" tone="neutral" />
                        </div>
                      )}
                    </td>
                    <td className={TABLE_STYLES.td}>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`mapping-source-${row.name}`}>
                          Source of {row.name}
                        </label>
                        <select
                          id={`mapping-source-${row.name}`}
                          value={row.source.kind}
                          disabled={busy}
                          onChange={(event) => setSource(row.name, event.target.value === "base-url" ? { kind: "base-url" } : { kind: "environment-value", valueName: row.name })}
                          className={SCRIPT_INPUT}
                        >
                          <option value="base-url">Environment base URL</option>
                          <option value="environment-value">Environment value</option>
                        </select>
                        {row.source.kind === "environment-value" && (
                          <>
                            <label className="sr-only" htmlFor={`mapping-value-${row.name}`}>
                              Environment value name for {row.name}
                            </label>
                            <input
                              id={`mapping-value-${row.name}`}
                              list="mapping-environment-names"
                              value={row.source.valueName}
                              disabled={busy}
                              onChange={(event) => setSource(row.name, { kind: "environment-value", valueName: event.target.value })}
                              className={`${SCRIPT_INPUT} w-44 font-mono text-xs`}
                            />
                          </>
                        )}
                      </div>
                    </td>
                    <td className={`${TABLE_STYLES.td} text-xs`}>
                      {status ? <StatusBadge label={status.present ? "Present" : "Missing"} tone={status.present ? "success" : "warning"} /> : <span className="text-muted">Choose an environment</span>}
                      <div className="mt-1 text-muted">Value hidden</div>
                    </td>
                    <td className={`${TABLE_STYLES.td} text-right`}>
                      <button
                        type="button"
                        aria-label={`Remove ${row.name}`}
                        className={BUTTON_STYLES.ghost}
                        disabled={busy}
                        onClick={() => {
                          const next = rows.filter((candidate) => candidate.name !== row.name);
                          save(next, row.foundInScript ? [...removedNames, row.name] : [...removedNames]);
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <datalist id="mapping-environment-names">
        {environmentValueNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {dirty && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-500 bg-lime-pale px-3 py-2">
          <p className="text-sm text-text-primary">You changed where a value comes from. It is used once you save.</p>
          <button type="button" className={`${BUTTON_STYLES.primary} ml-auto`} disabled={busy} onClick={() => save(rows, [...removedNames])}>
            Save sources
          </button>
        </div>
      )}
      <div className="space-y-1.5 rounded-xl bg-surface-subtle p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted">
            Add a name the script builds at run time
            <input value={newName} onChange={(event) => setNewName(event.target.value)} disabled={busy} className={`${SCRIPT_INPUT} w-64 max-w-full font-mono`} aria-describedby="mapping-name-help mapping-name-refusal" />
          </label>
          <button
            type="button"
            className={BUTTON_STYLES.secondary}
            disabled={busy || newName.trim() === "" || refusal !== null || duplicate}
            onClick={() => {
              const name = newName.trim();
              save([...rows, { name, source: { kind: "environment-value", valueName: name }, foundInScript: false }], removedNames.filter((removed) => removed !== name));
              setNewName("");
            }}
          >
            + Add name
          </button>
        </div>
        <p id="mapping-name-help" className="text-left text-xs text-muted hyphens-none">
          Use this for a name the check cannot find because the script builds it while it runs, for example <code className="font-mono">__ENV[`KEY_${"{i}"}`]</code>. The name is then mapped like any other, so the script receives its value.
        </p>
        <p id="mapping-name-refusal" role={nameProblem ? "alert" : undefined} className="text-xs text-danger-700 empty:hidden dark:text-danger-100">
          {nameProblem}
        </p>
      </div>
    </div>
  );
}
