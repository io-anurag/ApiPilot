import { useState, type ReactNode } from "react";
import { writeEffectLabelOf, type RemovedOperationPreview } from "@apipilot/shared-domain";
import type { Result } from "../../services/performanceTestingClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ErrorState } from "../ErrorState";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { Skeleton } from "../Skeleton";
import { StatusBadge } from "../StatusBadge";
import { AUTH_LABEL, choiceNote, variablesFor } from "./performanceViewModel";
import { StepRequestPreview } from "./StepRequestPreview";
import { WrappingPath } from "./WrappingPath";

/**
 * The operations that are not in the plan, as the operations table's "Removed" and "Left out"
 * views (AP-032 FR-024, FR-024a): one operation per row with its method, path and reason. A
 * removed row opens, under it, the step and request it would have if restored (read-only, from
 * `GET /plan/removed-operation`), and can be restored alone, with others ticked, or all at once.
 * A left-out operation has no positive scenario, so there is nothing to open or restore.
 */
export interface OtherOperation {
  /** The key the plan removes and restores by: an operation key, or an AP-036 collection item id. */
  operationKey: string;
  reason?: string;
  /** AP-036: a collection request is shown by its method, path and name, not by its key. */
  request?: { method: string; path: string; name: string };
}

function nameOf(entry: OtherOperation): string {
  return entry.request ? entry.request.name : entry.operationKey;
}

type PreviewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; preview: RemovedOperationPreview };

function splitOperationKey(operationKey: string): { method: string; path: string } {
  const space = operationKey.indexOf(" ");
  return space < 0 ? { method: "", path: operationKey } : { method: operationKey.slice(0, space), path: operationKey.slice(space + 1) };
}

function RemovedDetails({
  state,
  busy,
  onRestore,
}: Readonly<{ state: PreviewState | undefined; busy: boolean; onRestore: () => void }>) {
  if (!state || state.kind === "loading") {
    return (
      <div className="space-y-2" aria-busy="true">
        <p className="text-sm text-muted">Building the request it would send…</p>
        <Skeleton className="h-16 w-full rounded bg-slate-200 dark:bg-slate-600" />
      </div>
    );
  }
  if (state.kind === "error") {
    return <ErrorState message="This operation's details could not be loaded." detail={state.message} testId="removed-operation-error" />;
  }
  const { step, request } = state.preview;
  const note = choiceNote(step);
  const variables = variablesFor(step);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Not in the plan, so it is not sent. This is what Restore would add back.</p>
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="min-w-0 space-y-2 lg:col-span-3">
          <p className="text-sm">
            <span className="text-xs font-medium text-muted">Scenario</span> <span>{step.scenarioDescription}</span>
            {/* AP-033 FR-018: an edit is kept while the operation is removed, and comes back on restore. */}
            {step.bodyEdited && (
              <>
                {" "}
                <StatusBadge label="Body edited" tone="info" />
              </>
            )}
          </p>
          {note && <p className="text-xs text-muted">{note}</p>}
          <StepRequestPreview
            stepId={step.id}
            operationKey={step.operationKey}
            stepLabel={(stepId) => (stepId === step.id ? step.operationKey : stepId)}
            loadPreview={() => Promise.resolve({ ok: true, request })}
          />
        </div>
        <dl className="grid content-start gap-3 text-xs lg:col-span-2">
          <div>
            <dt className="text-muted">Expected status</dt>
            <dd className="mt-1 font-mono">
              {step.expectedStatuses.length > 0
                ? step.expectedStatuses.map((status) => status.code).join(", ")
                : "None documented; set one after restoring."}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Authentication</dt>
            <dd className="mt-1">
              {AUTH_LABEL[step.auth.kind]}
              {step.auth.schemeName && ` · ${step.auth.schemeName}`}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Variables</dt>
            <dd className="mt-1">{variables.length > 0 ? variables.join(", ") : "None"}</dd>
          </div>
        </dl>
      </div>
      <div className="flex border-t border-border pt-3">
        <button type="button" className={`${BUTTON_STYLES.secondary} ml-auto`} disabled={busy} onClick={onRestore}>
          Restore to the plan
        </button>
      </div>
    </div>
  );
}

export function OtherOperationsTable({
  kind,
  entries,
  busy,
  onRestore,
  loadRemoved,
}: Readonly<{
  kind: "removed" | "left-out";
  entries: readonly OtherOperation[];
  busy: boolean;
  /** Removed view only. */
  onRestore?: (operationKeys: string[], success: string) => void;
  loadRemoved?: (operationKey: string) => Promise<Result<RemovedOperationPreview>>;
}>) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const removed = kind === "removed" && onRestore !== undefined;
  const label = kind === "removed" ? "Removed operations" : "Operations left out";
  const shown = entries.filter((entry) =>
    (entry.request ? `${entry.request.method} ${entry.request.path} ${entry.request.name}` : entry.operationKey).toLowerCase().includes(query.toLowerCase()),
  );
  const presentKeys = new Set(entries.map((entry) => entry.operationKey));
  const selectedKeys = [...selected].filter((key) => presentKeys.has(key));
  const shownKeys = shown.map((entry) => entry.operationKey);
  const allShownSelected = shownKeys.length > 0 && shownKeys.every((key) => selected.has(key));
  const someShownSelected = shownKeys.some((key) => selected.has(key));
  const columnCount = removed ? 4 : 2;

  const restore = (keys: string[]) => {
    if (!onRestore) return;
    const one = entries.find((entry) => entry.operationKey === keys[0]);
    onRestore(keys, keys.length === 1 ? `${one ? nameOf(one) : keys[0]} restored.` : `${keys.length} operations restored.`);
    setSelected(new Set());
    setExpanded(null);
  };
  const toggleSelected = (keys: readonly string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  async function open(operationKey: string) {
    if (expanded === operationKey) {
      setExpanded(null);
      return;
    }
    setExpanded(operationKey);
    if (!loadRemoved || previews[operationKey]?.kind === "ready") return;
    setPreviews((current) => ({ ...current, [operationKey]: { kind: "loading" } }));
    const result = await loadRemoved(operationKey);
    setPreviews((current) => ({
      ...current,
      [operationKey]: result.ok ? { kind: "ready", preview: { step: result.step, request: result.request } } : { kind: "error", message: result.message },
    }));
  }

  const rows: ReactNode[] = [];
  for (const entry of shown) {
    const { method, path } = entry.request ?? splitOperationKey(entry.operationKey);
    const effect = writeEffectLabelOf(method);
    const isOpen = expanded === entry.operationKey;
    const request = (
      <>
        {method && <HttpMethodBadge method={method} />}
        <WrappingPath path={path} />
        {entry.request && <span className="text-xs text-muted">{entry.request.name}</span>}
        {effect && <StatusBadge label={effect} tone="warning" />}
      </>
    );
    rows.push(
      <tr key={entry.operationKey} className={`border-t border-border ${isOpen ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}>
        {removed && (
          <td className="px-3 py-1.5">
            <input
              type="checkbox"
              checked={selected.has(entry.operationKey)}
              onChange={(event) => toggleSelected([entry.operationKey], event.target.checked)}
              aria-label={`Select ${nameOf(entry)}`}
              className="accent-brand-600"
            />
          </td>
        )}
        <td className="px-2 py-1.5">
          {removed ? (
            <button
              type="button"
              onClick={() => void open(entry.operationKey)}
              aria-expanded={isOpen}
              aria-label={`Details of ${nameOf(entry)}`}
              className="flex w-full items-center gap-2 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <span aria-hidden="true" className="w-3 shrink-0 text-xs text-muted">
                {isOpen ? "▾" : "▸"}
              </span>
              {request}
            </button>
          ) : (
            <span className="flex items-center gap-2 pl-5">{request}</span>
          )}
        </td>
        <td className="px-2 py-1.5 text-xs text-muted">{entry.reason ?? "Removed by you"}</td>
        {removed && (
          <td className="px-2 py-1.5 text-right">
            <button
              type="button"
              className={BUTTON_STYLES.ghost}
              disabled={busy}
              aria-label={`Restore ${nameOf(entry)}`}
              onClick={() => restore([entry.operationKey])}
            >
              Restore
            </button>
          </td>
        )}
      </tr>,
    );
    if (removed && isOpen) {
      rows.push(
        <tr key={`${entry.operationKey}-details`}>
          <td colSpan={columnCount} className="border-t border-border bg-chrome px-4 py-4 dark:bg-white/5">
            <section aria-label={`Details for ${nameOf(entry)}`}>
              <RemovedDetails state={previews[entry.operationKey]} busy={busy} onRestore={() => restore([entry.operationKey])} />
            </section>
          </td>
        </tr>,
      );
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-52 flex-1">
          <span className="sr-only">Search {label.toLowerCase()}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search method or path"
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-100"
          />
        </label>
        {removed && entries.length > 1 && (
          <button type="button" className={BUTTON_STYLES.secondary} disabled={busy} onClick={() => restore(entries.map((entry) => entry.operationKey))}>
            Restore all {entries.length}
          </button>
        )}
      </div>

      {removed && selectedKeys.length > 0 && (
        <section
          aria-label="Selected operations"
          className="flex flex-wrap items-center gap-3 rounded-md border border-brand-500 bg-brand-50 px-3 py-2 text-sm dark:bg-brand-500/10"
        >
          <span className="font-medium">
            {selectedKeys.length} operation{selectedKeys.length === 1 ? "" : "s"} selected
          </span>
          <div className="ml-auto flex items-center gap-4">
            <button type="button" className={BUTTON_STYLES.ghost} disabled={busy} onClick={() => restore(selectedKeys)}>
              Restore to the plan
            </button>
            <button type="button" className={BUTTON_STYLES.ghost} onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          </div>
        </section>
      )}

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table aria-label={label} className="w-full min-w-160 border-collapse text-sm">
          <thead className="bg-chrome text-left text-xs text-muted dark:bg-white/5">
            <tr>
              {removed && (
                <th scope="col" className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select every operation shown"
                    checked={allShownSelected}
                    ref={(element) => {
                      if (element) element.indeterminate = someShownSelected && !allShownSelected;
                    }}
                    onChange={(event) => toggleSelected(shownKeys, event.target.checked)}
                    className="accent-brand-600"
                  />
                </th>
              )}
              <th scope="col" className="w-1/2 px-2 py-2 font-semibold">
                Request
              </th>
              <th scope="col" className="px-2 py-2 font-semibold">
                {kind === "removed" ? "Why it is not in the plan" : "Reason"}
              </th>
              {removed && (
                <th scope="col" className="px-2 py-2">
                  <span className="sr-only">Restore</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
        {shown.length === 0 && <p className="p-6 text-center text-sm text-muted">No operations match this search.</p>}
      </div>
      <p className="text-xs text-muted">
        {shown.length} of {entries.length} operation{entries.length === 1 ? "" : "s"} shown
      </p>
    </div>
  );
}
