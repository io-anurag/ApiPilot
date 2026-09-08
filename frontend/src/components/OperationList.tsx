import type { ApiOperation } from "@apipilot/shared-domain";
import { HttpMethodBadge } from "./HttpMethodBadge";

export function OperationList({
  operations,
  onSelect,
}: {
  operations: ApiOperation[];
  onSelect: (operation: ApiOperation) => void;
}) {
  if (operations.length === 0) {
    return (
      <p data-testid="operation-list-empty" className="text-sm text-muted">
        No operations were discovered in this specification.
      </p>
    );
  }

  return (
    <ul data-testid="operation-list" className="divide-y divide-border rounded-md border border-border">
      {operations.map((operation) => (
        <li key={`${operation.method} ${operation.path}`}>
          <button
            type="button"
            onClick={() => onSelect(operation)}
            // Method badge width varies with its text ("GET" vs "DELETE"), so a plain flex row
            // starts the path at a different x-position per row. A fixed-width first column
            // keeps every path aligned regardless of which verb precedes it.
            className="grid w-full grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
          >
            <HttpMethodBadge method={operation.method} />
            <span className="min-w-0 truncate font-mono text-slate-800" title={operation.path}>
              {operation.path}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
