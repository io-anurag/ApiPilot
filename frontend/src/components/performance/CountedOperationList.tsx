import type { ReactNode } from "react";
import { HttpMethodBadge } from "../HttpMethodBadge";

/**
 * A counted list of operations, one per line with its method badge and path (AP-032 FR-024,
 * specs/032-quick-performance-test research Q11): left-out, removed, write and needs-status lists
 * on both paths. A list longer than `collapseAbove` starts collapsed as a native
 * `<details>`/`<summary>`, which is keyboard and screen-reader accessible and shows the count while
 * collapsed (constitution XXXII). `collapseAbove={Infinity}` renders a plain list that never
 * collapses, as the write lists must (SC-002).
 */
export interface CountedOperationEntry {
  operationKey: string;
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
  testId,
}: Readonly<{
  label: (count: number) => string;
  entries: readonly CountedOperationEntry[];
  collapseAbove?: number;
  testId: string;
}>) {
  if (entries.length === 0) return null;
  const list = (
    <ul className="divide-y divide-border rounded-md border border-border">
      {entries.map((entry) => {
        const { method, path } = splitOperationKey(entry.operationKey);
        return (
          <li key={entry.operationKey} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
            {method && <HttpMethodBadge method={method} />}
            <span className="break-all font-mono text-xs">{path}</span>
            {entry.detail && <span className="text-xs text-muted">{entry.detail}</span>}
            {entry.action && <span className="ml-auto">{entry.action}</span>}
          </li>
        );
      })}
    </ul>
  );
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
