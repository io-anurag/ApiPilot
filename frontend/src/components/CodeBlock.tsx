/**
 * A single monospace, horizontally-scrollable block for JSON/YAML/request-or-response-body
 * content (project convention: monospace typography is reserved for API paths, JSON/YAML, and
 * code — never the whole application — and long code blocks scroll horizontally rather than
 * widening the page). Shared by `ExecutionResultsPanel`'s request/response body panes; kept as
 * its own file since more than one caller was already anticipated for it.
 */
export function CodeBlock({ label, content }: Readonly<{ label?: string; content: string }>) {
  return (
    <div className="space-y-1">
      {label && <p className="text-xs font-semibold uppercase text-muted">{label}</p>}
      <pre
        data-testid="code-block"
        className="overflow-x-auto rounded-md border border-border bg-slate-900 p-3 font-mono text-xs text-slate-100"
      >
        <code>{content}</code>
      </pre>
    </div>
  );
}
