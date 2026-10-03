import type { ReactNode } from "react";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { WrappingPath } from "./WrappingPath";

/**
 * A counted list of operations, one per line with its method badge and path (AP-032 FR-024,
 * specs/032-quick-performance-test research Q11): left-out, removed, write and needs-status lists
 * on both paths. A list longer than `collapseAbove` starts collapsed as a native
 * `<details>`/`<summary>`, which is keyboard and screen-reader accessible and shows the count while
 * collapsed (constitution XXXII). `collapseAbove={Infinity}` renders a plain list that never
 * collapses, as the write lists must (SC-002). `columns` drops the per-row borders and flows a long
 * list into two or three columns sized by the list's own container (not the viewport), so it stays
 * fully readable in less height in the wide operations panel and the narrow run-setup column alike.
 */
export interface CountedOperationEntry {
  operationKey: string;
  /** The method and path to show, when the key is not itself "METHOD path" (a request-chain step's id). */
  request?: { method: string; path: string };
  detail?: ReactNode;
  action?: ReactNode;
}

function splitOperationKey(operationKey: string): { method: string; path: string } {
  const space = operationKey.indexOf(" ");
  return space < 0 ? { method: "", path: operationKey } : { method: operationKey.slice(0, space), path: operationKey.slice(space + 1) };
}

export function CountedOperationList({
  label,
  entries,
  collapseAbove = 10,
  columns = false,
  onSelect,
  selectLabel = (operationKey) => `Show ${operationKey} in the plan`,
  testId,
}: Readonly<{
  label: (count: number) => string;
  entries: readonly CountedOperationEntry[];
  collapseAbove?: number;
  columns?: boolean;
  /** Makes each entry's path a button, e.g. to open that operation's details elsewhere. */
  onSelect?: (operationKey: string) => void;
  selectLabel?: (operationKey: string) => string;
  testId: string;
}>) {
  if (entries.length === 0) return null;
  const items = (
    <ul className={columns ? "grid gap-x-4 gap-y-1 @xl:grid-cols-2 @5xl:grid-cols-3" : "divide-y divide-border rounded-md border border-border"}>
      {entries.map((entry) => {
        const { method, path } = entry.request ?? splitOperationKey(entry.operationKey);
        return (
          <li key={entry.operationKey} className={columns ? "flex min-w-0 items-start gap-2 py-0.5 text-sm" : "flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm"}>
            {method && (
              <span className="shrink-0">
                <HttpMethodBadge method={method} />
              </span>
            )}
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(entry.operationKey)}
                aria-label={selectLabel(entry.operationKey)}
                className="min-w-0 rounded text-left text-brand-800 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-200"
              >
                <WrappingPath path={path} />
              </button>
            ) : (
              <span className="min-w-0">
                <WrappingPath path={path} />
              </span>
            )}
            {entry.detail && <span className="shrink-0 text-xs text-muted">{entry.detail}</span>}
            {entry.action && <span className="ml-auto">{entry.action}</span>}
          </li>
        );
      })}
    </ul>
  );
  // The container query sizes the columns by the list's own width, collapsed or not.
  const list = columns ? <div className="@container">{items}</div> : items;
  if (entries.length <= collapseAbove) {
    return (
      <div data-testid={testId} className="space-y-1.5">
        <p className="text-sm font-semibold">{label(entries.length)}</p>
        {list}
      </div>
    );
  }
  return (
    <details data-testid={testId} className="space-y-1.5">
      <summary className="cursor-pointer text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        {label(entries.length)}
      </summary>
      <div className="mt-1.5">{list}</div>
    </details>
  );
}
