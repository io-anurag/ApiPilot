import type { ApiOperation } from "@apipilot/shared-domain";

export function OperationList({
  operations,
  onSelect,
}: {
  operations: ApiOperation[];
  onSelect: (operation: ApiOperation) => void;
}) {
  return (
    <ul data-testid="operation-list">
      {operations.map((operation) => (
        <li key={`${operation.method} ${operation.path}`}>
          <button type="button" onClick={() => onSelect(operation)}>
            {operation.method} {operation.path}
          </button>
        </li>
      ))}
    </ul>
  );
}
