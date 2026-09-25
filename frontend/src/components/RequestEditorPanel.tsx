import { useState } from "react";
import type { CollectionRequestView } from "@apipilot/shared-domain";
import type { RequestEdit } from "../services/externalCollectionsClient";
import { BUTTON_STYLES } from "./controlStyles";
import { ErrorState } from "./ErrorState";
import { CodeBlock } from "./CodeBlock";
import { VariableHighlightedText } from "./VariableHighlightedText";
import { RequestAuthSection, RequestVariablesSection } from "./RequestAuthSections";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const TABS = ["Headers", "Auth", "Body", "Tests", "Used variables"] as const;
type Tab = (typeof TABS)[number];

const PREVIEW_TABS = ["Request", "Body", "Tests"] as const;
type PreviewTab = (typeof PREVIEW_TABS)[number];

interface HeaderRow {
  key: string;
  value: string;
}

function toHeaderRows(headers: Array<{ key: string; value: string }>): HeaderRow[] {
  return headers.length > 0 ? headers.map((h) => ({ ...h })) : [{ key: "", value: "" }];
}

/** Where the auth behind `impliedAuthHeader` is defined, for the Headers tab note (FR-002a). */
function impliedAuthSourceText(request: CollectionRequestView): string {
  const source = request.auth?.source;
  if (!source) return "Added by its auth when it runs.";
  if (source.kind === "request") return "From this request's own auth.";
  if (source.kind === "collection") return "Inherited from the collection's auth.";
  return `Inherited from folder “${source.folderName}”.`;
}

const TAB_BUTTON =
  "border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";

/**
 * Selected-request detail: an editable raw form (method/URL/headers/body/tests — FR-007), the
 * read-only effective auth and used variables (FR-002a, FR-002b), plus a read-only resolved
 * preview (FR-002, FR-005) that updates immediately whenever the collection's
 * variable values change (via `request` being a freshly re-fetched `CollectionRequestView`).
 * Disabled entirely while `locked` (FR-017).
 *
 * Method/URL stay in a single always-visible top bar (a request's primary identity); headers,
 * body, and the request's own test script are tabbed rather than stacked, so only one editable
 * section is on screen at a time. The resolved preview stays outside the tabs, in a collapsible
 * section open by default, since "what will actually be sent" is the point of this panel and
 * shouldn't require picking the right tab to see.
 */
export function RequestEditorPanel({
  request,
  locked,
  onSave,
  onClose,
}: Readonly<{
  request: CollectionRequestView;
  locked: boolean;
  onSave: (requestId: string, edit: RequestEdit) => Promise<void>;
  /** Deselects this request (returns the main pane to its empty-selection placeholder) — this
   * panel's own close control, rather than a single button that dismissed the whole tree+editor
   * section (which meant closing the currently open request also hid the tree you'd need to pick
   * a different one). */
  onClose: () => void;
}>) {
  const [method, setMethod] = useState(request.raw.method);
  const [url, setUrl] = useState(request.raw.url);
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(() => toHeaderRows(request.raw.headers));
  const [body, setBody] = useState(request.raw.body ?? "");
  const [testScript, setTestScript] = useState(request.testScript ?? "");
  const [activeTab, setActiveTab] = useState<Tab>("Headers");
  const [previewTab, setPreviewTab] = useState<PreviewTab>("Request");
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
      testScript,
    };
    try {
      await onSave(request.id, edit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the request.");
    } finally {
      setSaving(false);
    }
  }

  const activeHeaderCount = headerRows.filter((row) => row.key.trim().length > 0).length;

  return (
    <div data-testid="request-editor-panel" className="rounded-md border border-border bg-surface">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase text-muted">{request.name}</h3>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={handleSave} disabled={locked || saving} className={BUTTON_STYLES.primary}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={onClose} className={BUTTON_STYLES.secondary}>
              ✕ Close
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <label htmlFor="request-editor-method" className="sr-only">
            Method
          </label>
          <select
            id="request-editor-method"
            value={method}
            disabled={locked}
            onChange={(event) => setMethod(event.target.value)}
            className="w-28 shrink-0 rounded-md border border-border bg-surface px-2 py-1.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {METHODS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <label htmlFor="request-editor-url" className="sr-only">
            URL
          </label>
          <input
            id="request-editor-url"
            type="text"
            value={url}
            disabled={locked}
            onChange={(event) => setUrl(event.target.value)}
            className="flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        {error && <ErrorState message={error} />}
      </div>

      <div role="tablist" aria-label="Request editor sections" className="flex border-b border-border px-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`${TAB_BUTTON} ${activeTab === tab ? "border-brand-600 text-brand-700 dark:text-brand-300" : "border-transparent text-muted hover:text-slate-700 dark:hover:text-slate-200"}`}
          >
            {tab}
            {tab === "Headers" && activeHeaderCount > 0 && <span className="ml-1 text-[10px] text-muted">({activeHeaderCount})</span>}
            {tab === "Used variables" && request.variableReferences.length > 0 && (
              <span className="ml-1 text-[10px] text-muted">({request.variableReferences.length})</span>
            )}
            {tab === "Tests" && testScript.trim().length > 0 && (
              <span aria-label="Has tests" className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-brand-500 align-middle" />
            )}
          </button>
        ))}
      </div>

      <div className="p-4">
        {activeTab === "Headers" && (
          <div className="space-y-2">
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
            {request.impliedAuthHeader && (
              <div className="space-y-1 rounded-md border border-border bg-slate-50 px-3 py-2 dark:bg-white/5">
                <p className="text-sm wrap-anywhere">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">Auth adds:</span>{" "}
                  <span className="font-mono">
                    {request.impliedAuthHeader.key}: <VariableHighlightedText text={request.impliedAuthHeader.rawValue} />
                  </span>
                </p>
                <p className="text-xs text-muted">
                  {impliedAuthSourceText(request)} Edit the auth or the variable, not here: it isn&apos;t an editable header.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === "Auth" && <RequestAuthSection auth={request.auth} />}

        {activeTab === "Used variables" && <RequestVariablesSection references={request.variableReferences} />}

        {activeTab === "Body" && (
          <div className="flex flex-col gap-1">
            <label htmlFor="request-editor-body" className="text-xs font-medium text-muted">
              Raw body
            </label>
            <textarea
              id="request-editor-body"
              rows={10}
              value={body}
              disabled={locked}
              onChange={(event) => setBody(event.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        )}

        {activeTab === "Tests" && (
          <div className="flex flex-col gap-1">
            <label htmlFor="request-editor-test-script" className="text-xs font-medium text-muted">
              Test script (runs after the response, same as Postman&apos;s own <code>pm.test(...)</code> checks)
            </label>
            <textarea
              id="request-editor-test-script"
              rows={10}
              value={testScript}
              disabled={locked}
              placeholder={'pm.test("Status code is 200", function () {\n  pm.response.to.have.status(200);\n});'}
              onChange={(event) => setTestScript(event.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="text-xs text-muted">
              This is what a run's pass/fail results are checked against. Clearing it removes every test from this request.
              Test scripts on its folders or on the collection also run, but they are not shown or saved here.
            </p>
          </div>
        )}

        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-xs font-semibold uppercase text-muted">Resolved preview</p>
          <div role="tablist" aria-label="Resolved preview sections" className="flex border-b border-border">
            {PREVIEW_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={previewTab === tab}
                onClick={() => setPreviewTab(tab)}
                className={`${TAB_BUTTON} ${previewTab === tab ? "border-brand-600 text-brand-700 dark:text-brand-300" : "border-transparent text-muted hover:text-slate-700 dark:hover:text-slate-200"}`}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="space-y-2 pt-3">
            {previewTab === "Request" && (
              <>
                <p className="text-sm wrap-anywhere">
                  <span className="font-mono font-semibold">{request.resolved.method}</span>{" "}
                  <span className="font-mono">
                    <VariableHighlightedText text={request.resolved.url} />
                  </span>
                </p>
                {request.resolved.headers.length > 0 || request.impliedAuthHeader ? (
                  <ul className="space-y-0.5 text-xs wrap-anywhere">
                    {request.resolved.headers.map((header, index) => (
                      <li key={index} className="font-mono">
                        {header.key}: <VariableHighlightedText text={header.value} />
                      </li>
                    ))}
                    {request.impliedAuthHeader && (
                      <li className="font-mono text-muted">
                        {request.impliedAuthHeader.key}:{" "}
                        <VariableHighlightedText text={request.impliedAuthHeader.resolvedValue} />{" "}
                        <span className="text-[10px] font-sans uppercase">(from auth)</span>
                      </li>
                    )}
                  </ul>
                ) : (
                  <p className="text-xs text-muted">No headers.</p>
                )}
              </>
            )}
            {previewTab === "Body" &&
              (request.resolved.body ? <CodeBlock label="Body" content={request.resolved.body} /> : <p className="text-xs text-muted">No body.</p>)}
            {previewTab === "Tests" &&
              (testScript.trim().length > 0 ? (
                <CodeBlock label="Test script" content={testScript} />
              ) : (
                <p className="text-xs text-muted">No test script.</p>
              ))}
            {request.unresolvedVariables.length > 0 && (
              <p className="text-xs text-warning-700 wrap-anywhere dark:text-warning-300">
                Unresolved: {request.unresolvedVariables.join(", ")}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
