import type { ApiOperation } from "@apipilot/shared-domain";
import { HttpMethodBadge } from "./HttpMethodBadge";

export function OperationDetail({ operation }: { operation: ApiOperation }) {
  return (
    <article data-testid="operation-detail" className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <HttpMethodBadge method={operation.method} />
        <span className="font-mono">{operation.path}</span>
      </h3>
      <section>
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted">Parameters</h4>
        {operation.parameters.length === 0 ? (
          <p className="text-sm text-muted">None</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm text-slate-700">
            {operation.parameters.map((parameter) => (
              <li key={`${parameter.location}-${parameter.name}`}>
                <code className="font-mono text-xs">{parameter.name}</code> ({parameter.location})
                {parameter.required ? " (required)" : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
      {operation.requestBody && (
        <section>
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted">
            Request Body{operation.requestBody.required ? " (required)" : ""}
          </h4>
          <ul className="mt-1 space-y-1 text-sm text-slate-700">
            {Object.keys(operation.requestBody.contentTypes).map((contentType) => (
              <li key={contentType} className="font-mono text-xs">
                {contentType}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted">Responses</h4>
        <ul className="mt-1 space-y-1 text-sm text-slate-700">
          {operation.responses.map((response) => (
            <li key={response.statusCode}>
              <span className="font-mono font-semibold">{response.statusCode}</span> - {response.description}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted">Security</h4>
        {operation.security.length === 0 ? (
          <p className="text-sm text-muted">No security requirement</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm text-slate-700">
            {operation.security.map((requirement, i) => (
              <li key={i}>{requirement.schemes.map((s) => s.name).join(" AND ")}</li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
