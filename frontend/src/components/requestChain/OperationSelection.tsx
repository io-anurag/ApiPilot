import { useId, useState } from "react";
import { toOperationKey, type QuickPerformanceTestView } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { HttpMethodBadge } from "../HttpMethodBadge";

export type SpecificationOperation = QuickPerformanceTestView["specification"]["operations"][number];

/**
 * Chooses which of a specification's operations are seeded into a request-chain plan
 * (specs/037-request-chain-performance FR-021). Every operation starts checked, so doing nothing
 * keeps today's behavior; the plan is seeded from the checked ones only. A text filter and a method
 * filter narrow a long list (specs/047-unified-performance-tab R12, constitution XXXII); "Select all"
 * still acts on every operation, and "Select shown" and "Clear shown" act on the rows the filter leaves.
 */
export function OperationSelection({
  operations,
  checkedKeys,
  onChange,
}: Readonly<{ operations: readonly SpecificationOperation[]; checkedKeys: ReadonlySet<string>; onChange: (next: ReadonlySet<string>) => void }>) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState("");
  const allKeys = operations.map(toOperationKey);
  const methods = [...new Set(operations.map((operation) => operation.method))].sort();
  const needle = query.trim().toLowerCase();
  const shown = operations.map((operation, index) => ({ operation, key: allKeys[index] })).filter(({ operation, key }) => (method === "" || operation.method === method) && (needle === "" || `${key} ${operation.operationId ?? ""}`.toLowerCase().includes(needle)));
  const filtered = needle !== "" || method !== "";
  const checkedCount = allKeys.filter((key) => checkedKeys.has(key)).length;
  const allChecked = allKeys.length > 0 && checkedCount === allKeys.length;

  function toggle(key: string) {
    const next = new Set(checkedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  }

  function setShown(checked: boolean) {
    const next = new Set(checkedKeys);
    for (const { key } of shown) {
      if (checked) next.add(key);
      else next.delete(key);
    }
    onChange(next);
  }

  return (
    <div className="space-y-2" data-testid="operation-selection">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={allChecked}
            ref={(element) => {
              if (element) element.indeterminate = checkedCount > 0 && !allChecked;
            }}
            onChange={() => onChange(allChecked ? new Set() : new Set(allKeys))}
            className="h-4 w-4 rounded border-border-control text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          Select all ({allKeys.length})
        </label>
        <p className="text-sm text-muted" aria-live="polite">
          {checkedCount} of {allKeys.length} selected
          {filtered ? `, showing ${shown.length}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-filter`} className="sr-only">
          Filter operations
        </label>
        <input
          id={`${id}-filter`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by path or operation ID"
          className="w-64 max-w-full rounded-md border border-border-control bg-surface px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        />
        <label htmlFor={`${id}-method`} className="sr-only">
          Filter by method
        </label>
        <select
          id={`${id}-method`}
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          className="rounded-md border border-border-control bg-surface px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <option value="">All methods</option>
          {methods.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        {filtered && (
          <>
            <button type="button" className={BUTTON_STYLES.ghost} disabled={shown.length === 0} onClick={() => setShown(true)}>
              Select shown ({shown.length})
            </button>
            <button type="button" className={BUTTON_STYLES.ghost} disabled={shown.length === 0} onClick={() => setShown(false)}>
              Clear shown
            </button>
          </>
        )}
      </div>
      <div className="max-h-[calc(100dvh-26rem)] min-h-64 overflow-auto rounded-md border border-border" data-testid="operation-selection-scroll">
        <table className="w-full min-w-3xl border-collapse text-left text-sm">
          <caption className="sr-only">Operations to include in the plan</caption>
          <thead className="sticky top-0 z-10 bg-surface-subtle text-xs font-semibold text-muted">
            <tr>
              <th scope="col" className="w-10 px-3 py-2">
                <span className="sr-only">Include</span>
              </th>
              <th scope="col" className="px-2 py-2">Method</th>
              <th scope="col" className="px-2 py-2">Path</th>
              <th scope="col" className="px-2 py-2">Operation ID</th>
              <th scope="col" className="px-2 py-2">Variables</th>
              <th scope="col" className="px-2 py-2">Expected status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered && shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-sm text-muted">
                  No operations match the filter.
                </td>
              </tr>
            )}
            {shown.map(({ operation, key }) => {
              return (
                <tr key={key} className="hover:bg-surface-hover">
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={checkedKeys.has(key)}
                      onChange={() => toggle(key)}
                      aria-label={key}
                      className="h-4 w-4 rounded border-border-control text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <HttpMethodBadge method={operation.method} />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs break-all">{operation.path}</td>
                  <td className="px-2 py-1.5 text-xs text-muted">{operation.operationId ?? "None"}</td>
                  <td className="px-2 py-1.5">
                    {operation.parameters.length === 0 && !operation.hasRequestBody ? (
                      <span className="text-xs text-muted">None</span>
                    ) : (
                      <ul className="flex flex-wrap gap-1" aria-label={`Variables of ${key}`}>
                        {operation.parameters.map((parameter) => (
                          <li
                            key={`${parameter.location}:${parameter.name}`}
                            className="rounded border border-border px-1.5 py-0.5 font-mono text-xs"
                            title={`${parameter.location} parameter${parameter.required ? ", required" : ""}`}
                          >
                            {parameter.name}
                            <span className="text-muted"> {parameter.location}{parameter.required ? "*" : ""}</span>
                          </li>
                        ))}
                        {operation.hasRequestBody && <li className="rounded border border-border px-1.5 py-0.5 font-mono text-xs">request body</li>}
                      </ul>
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs">
                    {operation.expectedStatuses.length > 0 ? operation.expectedStatuses.join(", ") : <span className="font-sans text-muted">None documented</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
