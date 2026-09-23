/**
 * A single monospace block for JSON/YAML/request-or-response-body content (project convention:
 * monospace typography is reserved for API paths, JSON/YAML, and code — never the whole
 * application). Bounded in both directions so a large payload never dictates the surrounding
 * panel's size: long lines wrap within the panel's width (`whitespace-pre-wrap` keeps the
 * content's own indentation/newlines; `wrap-anywhere` breaks unbroken tokens), and anything taller
 * than `max-h-96` scrolls inside the block. Shared by `ExternalCollectionRunPanel`'s
 * request/response body panes and `RequestEditorPanel`'s preview.
 */
export function CodeBlock({ label, content }: Readonly<{ label?: string; content: string }>) {
  return (
    <div className="min-w-0 space-y-1">
      {label && <p className="text-xs font-semibold uppercase text-muted">{label}</p>}
      <pre
        data-testid="code-block"
        className="max-h-96 overflow-auto whitespace-pre-wrap wrap-anywhere rounded-md border border-border bg-slate-900 p-3 font-mono text-xs text-slate-100"
      >
        <code>{content}</code>
      </pre>
    </div>
  );
}
