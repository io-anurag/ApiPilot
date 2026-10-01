import { useEffect, useState } from "react";
import type { MappedValueStatus, UserScriptValueMapping, UserScriptValueSource } from "@apipilot/shared-domain";
import { MAPPING_NAME_REFUSAL_TEXT, validateMappingName } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { StatusBadge } from "../StatusBadge";

type Entry = Pick<UserScriptValueMapping, "name" | "source"> & { foundInScript: boolean };

/**
 * The names the script receives and where each value comes from (AP-034 FR-025, FR-026; research
 * R12). Names and sources only: a value is never shown, so every row says "value hidden" in text.
 * Present or missing is shown for the chosen environment; a missing value never blocks a run.
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
    <div className="space-y-3" data-testid="value-mapping-editor">
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted">The script reads no environment values that ApiPilot could find. Add a name it builds at run time below.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Environment values the script receives</caption>
            <thead>
              <tr className="bg-chrome text-left text-xs text-muted">
                <th scope="col" className="px-3 py-2 font-semibold">Name the script reads</th>
                <th scope="col" className="px-3 py-2 font-semibold">Comes from</th>
                <th scope="col" className="px-3 py-2 font-semibold">In the chosen environment</th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = statusOf(row.name);
                return (
                  <tr key={row.name} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <code className="font-mono text-xs">{row.name}</code>
                      {!row.foundInScript && (
                        <div>
                          <StatusBadge label="Not found in the script" tone="neutral" />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`mapping-source-${row.name}`}>
                          Source of {row.name}
                        </label>
                        <select
                          id={`mapping-source-${row.name}`}
                          value={row.source.kind}
                          disabled={busy}
                          onChange={(event) => setSource(row.name, event.target.value === "base-url" ? { kind: "base-url" } : { kind: "environment-value", valueName: row.name })}
                          className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
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
                              className="w-44 rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
                            />
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {status ? <StatusBadge label={status.present ? "Present" : "Missing"} tone={status.present ? "success" : "warning"} /> : <span className="text-muted">Choose an environment</span>}
                      <div className="mt-1 text-muted">Value hidden</div>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className={BUTTON_STYLES.ghost}
                        disabled={busy}
                        onClick={() => {
                          const next = rows.filter((candidate) => candidate.name !== row.name);
                          save(next, row.foundInScript ? [...removedNames, row.name] : [...removedNames]);
                        }}
                      >
                        Remove {row.name}
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
        <button type="button" className={BUTTON_STYLES.primary} disabled={busy} onClick={() => save(rows, [...removedNames])}>
          Save sources
        </button>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Add a name the script builds at run time
          <input value={newName} onChange={(event) => setNewName(event.target.value)} disabled={busy} className="w-56 rounded-md border border-border bg-surface px-2 py-1 font-mono text-sm" aria-describedby="mapping-name-refusal" />
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
      <p id="mapping-name-refusal" role={refusal || duplicate ? "alert" : undefined} className="text-xs text-danger-700 dark:text-danger-200">
        {refusal ? MAPPING_NAME_REFUSAL_TEXT[refusal] : duplicate ? "This name is already mapped." : ""}
      </p>
    </div>
  );
}
