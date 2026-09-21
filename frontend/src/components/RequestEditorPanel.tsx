import { useState } from "react";
import type { CollectionRequestView } from "@apipilot/shared-domain";
import type { RequestEdit } from "../services/externalCollectionsClient";
import { BUTTON_STYLES } from "./controlStyles";
import { ErrorState } from "./ErrorState";
import { CodeBlock } from "./CodeBlock";
import { VariableHighlightedText } from "./VariableHighlightedText";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

interface HeaderRow {
  key: string;
  value: string;
}

function toHeaderRows(headers: Array<{ key: string; value: string }>): HeaderRow[] {
  return headers.length > 0 ? headers.map((h) => ({ ...h })) : [{ key: "", value: "" }];
}

/**
 * Selected-request detail: an editable raw form (method/URL/headers/body — FR-007) plus a
 * read-only resolved preview (FR-002, FR-005) that updates immediately whenever the collection's
 * variable values change (via `request` being a freshly re-fetched `CollectionRequestView`).
 * Disabled entirely while `locked` (FR-017).
 */
export function RequestEditorPanel({
  request,
  locked,
  onSave,
}: Readonly<{
  request: CollectionRequestView;
  locked: boolean;
  onSave: (requestId: string, edit: RequestEdit) => Promise<void>;
}>) {
  const [method, setMethod] = useState(request.raw.method);
  const [url, setUrl] = useState(request.raw.url);
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(() => toHeaderRows(request.raw.headers));
  const [body, setBody] = useState(request.raw.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateHeaderRow(index: number, patch: Partial<HeaderRow>) {
    setHeaderRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeHeaderRow(index: number) {
    setHeaderRows((current) => current.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const edit: RequestEdit = {
      method,
      url: url.trim(),
      headers: headerRows.filter((row) => row.key.trim().length > 0).map((row) => ({ key: row.key.trim(), value: row.value })),
      body: body.length > 0 ? body : undefined,
    };
    try {
      await onSave(request.id, edit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the request.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid="request-editor-panel" className="space-y-4 rounded-md border border-border bg-surface p-4">
      <div>
        <h3 className="text-xs font-semibold uppercase text-muted">{request.name}</h3>
      </div>

      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <div className="flex flex-col gap-1">
          <label htmlFor="request-editor-method" className="text-xs font-medium text-muted">
            Method
          </label>
          <select
            id="request-editor-method"
            value={method}
            disabled={locked}
            onChange={(event) => setMethod(event.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {METHODS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="request-editor-url" className="text-xs font-medium text-muted">
            URL
          </label>
          <input
            id="request-editor-url"
            type="text"
            value={url}
            disabled={locked}
            onChange={(event) => setUrl(event.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted">Headers</p>
        {headerRows.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="text"
              placeholder="header name"
              value={row.key}
              disabled={locked}
              onChange={(event) => updateHeaderRow(index, { key: event.target.value })}
              className="w-48 rounded-md border border-border bg-surface px-2 py-1 text-sm font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <input
              type="text"
              placeholder="value"
              value={row.value}
              disabled={locked}
              onChange={(event) => updateHeaderRow(index, { value: event.target.value })}
              className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="button"
              aria-label={`Remove header row ${index + 1}`}
              disabled={locked}
              onClick={() => removeHeaderRow(index)}
              className="text-sm text-muted hover:text-danger-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-danger-400"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={locked}
          onClick={() => setHeaderRows((current) => [...current, { key: "", value: "" }])}
          className={BUTTON_STYLES.ghost}
        >
          + Add header
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="request-editor-body" className="text-xs font-medium text-muted">
          Body
        </label>
        <textarea
          id="request-editor-body"
          rows={6}
          value={body}
          disabled={locked}
          onChange={(event) => setBody(event.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      {error && <ErrorState message={error} />}

      <button type="button" onClick={handleSave} disabled={locked || saving} className={BUTTON_STYLES.primary}>
        {saving ? "Saving…" : "Save request"}
      </button>

      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs font-semibold uppercase text-muted">Resolved preview</p>
        <p className="text-sm">
          <span className="font-mono font-semibold">{request.resolved.method}</span>{" "}
          <span className="font-mono">
            <VariableHighlightedText text={request.resolved.url} />
          </span>
        </p>
        {request.resolved.headers.length > 0 && (
          <ul className="space-y-0.5 text-xs">
            {request.resolved.headers.map((header, index) => (
              <li key={index} className="font-mono">
                {header.key}: <VariableHighlightedText text={header.value} />
              </li>
            ))}
          </ul>
        )}
        {request.resolved.body && <CodeBlock label="Body" content={request.resolved.body} />}
        {request.unresolvedVariables.length > 0 && (
          <p className="text-xs text-warning-700 dark:text-warning-300">
            Unresolved: {request.unresolvedVariables.join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}
