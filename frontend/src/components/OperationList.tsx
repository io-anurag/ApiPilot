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
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
          >
            <HttpMethodBadge method={operation.method} />
            <span className="font-mono text-slate-800">{operation.path}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
