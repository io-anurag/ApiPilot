import { useEffect, useRef, useState } from "react";
import type {
  CollectionRequestView,
  ExecutionConfirmationRequirement,
  RawHeader,
  UploadedCollectionExecutionRun,
  UploadedRequestResult,
} from "@apipilot/shared-domain";
import {
  cancelUploadedCollectionExecution,
  fetchUploadedCollectionRun,
  fetchUploadedCollectionRuns,
  startUploadedCollectionExecution,
  type UploadedCollectionSummary,
} from "../services/externalCollectionsClient";
import { CodeBlock } from "./CodeBlock";
import { ErrorState } from "./ErrorState";
import { HttpMethodBadge } from "./HttpMethodBadge";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import { BUTTON_STYLES } from "./controlStyles";

const POLL_INTERVAL_MS = 750;

function outcomeTone(result: UploadedRequestResult): StatusTone {
  if (result.outcome === "passed") return "success";
  if (result.outcome === "failed") return "danger";
  return "neutral";
}

function outcomeLabel(result: UploadedRequestResult): string {
  if (result.outcome === "passed") return "Passed";
  if (result.outcome === "failed") return result.failureCategory ?? "Failed";
  return result.notAttemptedReason ?? "Not attempted";
}

function runStatusTone(status: UploadedCollectionExecutionRun["status"]): StatusTone {
  if (status === "in-progress") return "info";
  if (status === "cancelled") return "warning";
  return "success";
}

/** One labeled number in the run overview stat row (mirrors ExecutionResultsPanel's `OverviewStat`). */
function OverviewStat({ label, value, tone }: Readonly<{ label: string; value: string; tone?: StatusTone }>) {
  const toneClass: Record<StatusTone, string> = {
    neutral: "text-slate-900 dark:text-white",
    info: "text-info-700 dark:text-info-400",
    success: "text-success-700 dark:text-success-400",
    warning: "text-warning-700 dark:text-warning-400",
    danger: "text-danger-700 dark:text-danger-400",
  };
  return (
    <div className="min-w-[6rem]">
      <dt className="text-xs font-medium uppercase text-muted">{label}</dt>
      <dd className={`text-lg font-semibold ${toneClass[tone ?? "neutral"]}`}>{value}</dd>
    </div>
  );
}

function RunOverview({ run }: Readonly<{ run: UploadedCollectionExecutionRun }>) {
  return (
    <dl className="flex flex-wrap gap-4 rounded-md border border-border bg-slate-50 p-3 dark:bg-white/5">
      <OverviewStat label="Requests" value={String(run.summary.total)} />
      <OverviewStat label="Passed" value={String(run.summary.passed)} tone="success" />
      <OverviewStat
        label="Failed"
        value={String(run.summary.failed)}
        tone={run.summary.failed > 0 ? "danger" : "neutral"}
      />
      <OverviewStat label="Not attempted" value={String(run.summary.notAttempted)} />
      <OverviewStat label="Duration" value={`${run.summary.durationMs} ms`} />
    </dl>
  );
}

function HeaderTable({ headers }: Readonly<{ headers: RawHeader[] }>) {
  if (headers.length === 0) return <p className="text-xs text-muted">No headers.</p>;
  return (
    <table className="w-full text-xs">
      <tbody>
        {headers.map((header) => (
          <tr key={header.key} className="border-b border-border last:border-0">
            <td className="w-1/3 py-1 pr-2 align-top font-mono font-medium text-slate-600 dark:text-slate-400">{header.key}</td>
            <td className="py-1 font-mono text-slate-700 dark:text-slate-300 break-all">{header.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Per-request diagnostic detail: each named test outcome, duration, response status, and — for a
 * `"local"`-tier run only — the full raw request/response headers/bodies (FR-017a parity). */
function ResultDetail({ result }: Readonly<{ result: UploadedRequestResult }>) {
  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-slate-50 p-3 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-400">
      <p>
        {result.durationMs}ms
        {result.responseStatusCode !== undefined && ` · Response status ${result.responseStatusCode}`}
      </p>
      {result.testOutcomes.length > 0 && (
        <ul className="space-y-1">
          {result.testOutcomes.map((test) => (
            <li key={test.name} className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-700 dark:text-slate-300">{test.name}</span>
              <StatusBadge label={test.outcome} tone={test.outcome === "passed" ? "success" : "danger"} />
              {test.detail && <span>{test.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {result.rawCapture && (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-muted">Request</p>
            <p className="break-all font-mono text-xs text-slate-600 dark:text-slate-400">{result.rawCapture.requestUrl}</p>
            <HeaderTable headers={result.rawCapture.requestHeaders} />
            {result.rawCapture.requestBody && <CodeBlock label="Body" content={result.rawCapture.requestBody} />}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-muted">Response</p>
            <HeaderTable headers={result.rawCapture.responseHeaders} />
            {result.rawCapture.responseBody && <CodeBlock label="Body" content={result.rawCapture.responseBody} />}
          </div>
        </div>
      )}
    </div>
  );
}

function ExternalCollectionResultRow({ result }: Readonly<{ result: UploadedRequestResult }>) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="py-2 text-sm">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <div className="flex min-w-0 items-center gap-2">
          <HttpMethodBadge method={result.requestMethod} />
          <span className="min-w-0 truncate font-mono text-xs text-slate-700 dark:text-slate-300" title={result.requestName}>
            {result.requestName}
          </span>
        </div>
        <StatusBadge label={outcomeLabel(result)} tone={outcomeTone(result)} />
      </button>
      {expanded && <ResultDetail result={result} />}
    </li>
  );
}

/** Required before an uploaded collection's very first request ever dispatches (FR-007) — a
 * distinct action naming that this content was not generated or verified by ApiPilot. */
function UnverifiedContentDialog({
  onConfirm,
  onDecline,
}: Readonly<{ onConfirm: () => void; onDecline: () => void }>) {
  return (
    <div
      role="alertdialog"
      data-testid="unverified-content-dialog"
      className="space-y-3 border-l-4 border-warning-500 bg-warning-50 p-4 shadow-sm dark:bg-warning-500/10"
    >
      <p className="text-sm text-warning-700 dark:text-warning-100">
        This collection&apos;s requests, and any embedded pre-request/test scripts, were{" "}
        <strong>not generated or verified by ApiPilot</strong>. They will execute exactly as
        authored, with the same real network access Postman/Newman itself would give them.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onConfirm} className={BUTTON_STYLES.danger}>
          Confirm and run
        </button>
        <button type="button" onClick={onDecline} className={BUTTON_STYLES.secondary}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Risk-tier / destructive-request gate (FR-013) — identical concern to `ExecutionResultsPanel`'s
 * own confirmation banner, evaluated every run start rather than once per artifact. */
function RiskTierConfirmationBanner({
  requirement,
  onConfirm,
  onCancel,
}: Readonly<{ requirement: ExecutionConfirmationRequirement; onConfirm: () => void; onCancel: () => void }>) {
  return (
    <div
      role="alertdialog"
      data-testid="risk-tier-confirmation-banner"
      className="space-y-3 border-l-4 border-warning-500 bg-warning-50 p-4 shadow-sm dark:bg-warning-500/10"
    >
      <p className="text-sm text-warning-700 dark:text-warning-100">
        This run targets a <strong>{requirement.environmentTier}</strong> environment
        {requirement.destructiveOperations.length > 0 && " and includes destructive requests"}.
      </p>
      {requirement.destructiveOperations.length > 0 && (
        <ul className="space-y-1 text-sm text-warning-700 dark:text-warning-100">
          {requirement.destructiveOperations.map((operation) => (
            <li key={`${operation.operationMethod} ${operation.operationPath}`} className="flex items-center gap-2">
              <HttpMethodBadge method={operation.operationMethod} />
              <span className="font-mono text-xs">{operation.operationPath}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onConfirm} className={BUTTON_STYLES.danger}>
          Confirm and run
        </button>
        <button type="button" onClick={onCancel} className={BUTTON_STYLES.secondary}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function RunHistory({
  runs,
  selectedRunId,
  onSelect,
}: Readonly<{
  runs: Omit<UploadedCollectionExecutionRun, "results">[];
  selectedRunId: string | undefined;
  onSelect: (runId: string) => void;
}>) {
  if (runs.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase text-muted">Run history</h3>
      <ul className="divide-y divide-border">
        {runs.map((historyRun) => (
          <li key={historyRun.id}>
            <button
              type="button"
              onClick={() => onSelect(historyRun.id)}
              aria-current={historyRun.id === selectedRunId}
              className={`flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                historyRun.id === selectedRunId ? "bg-slate-50 dark:bg-white/5" : ""
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <StatusBadge label={historyRun.status} tone={runStatusTone(historyRun.status)} />
                <StatusBadge label="Uploaded" tone="neutral" />
              </span>
              <span className="text-xs text-muted">
                {historyRun.summary.passed} passed · {historyRun.summary.failed} failed
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Postman-Runner-style "which requests will run, in what order" checklist (AP-028 follow-up) —
 * only the parts of Postman's own Runner screen ApiPilot's backend actually supports: choosing a
 * subset of the collection's own requests to run. Performance/load mode, Mock, Schedule, a
 * Postman-CLI/CI-CD export, and data-driven "Iterations" have no backend behind them and are
 * deliberately left out rather than shown as non-functional controls.
 */
function RunOrderChecklist({
  requests,
  selectedIds,
  onToggle,
  onSelectAll,
  disabled,
}: Readonly<{
  requests: CollectionRequestView[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  disabled: boolean;
}>) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase text-muted">Run order</h4>
        <span className="text-xs text-muted">
          <span>
            {selectedIds.size} of {requests.length} selected
          </span>{" "}
          ·{" "}
          <button type="button" onClick={onSelectAll} disabled={disabled} className={BUTTON_STYLES.ghost}>
            Reset
          </button>
        </span>
      </div>
      <ul className="max-h-56 space-y-0.5 overflow-y-auto">
        {requests.map((item, index) => (
          <li key={item.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50 dark:hover:bg-white/5">
            <input
              type="checkbox"
              aria-label={`Include ${item.name} in this run`}
              checked={selectedIds.has(item.id)}
              disabled={disabled}
              onChange={() => onToggle(item.id)}
              className="h-4 w-4 shrink-0 rounded border-border text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed"
            />
            <span className="w-5 shrink-0 text-right font-mono text-xs text-muted">{index + 1}</span>
            <HttpMethodBadge method={item.raw.method} />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700 dark:text-slate-300" title={item.name}>
              {item.name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Runs a selected uploaded collection and renders its live/completed results (US1, US2), always
 * labeled "Uploaded" so it is never mistaken for a generated-collection run (US3, FR-010) — this
 * panel's own runs are always `source: "uploaded"`.
 */
export function ExternalCollectionRunPanel({
  uploadedCollection,
  requests = [],
}: Readonly<{
  uploadedCollection: UploadedCollectionSummary;
  /** Every request in the loaded collection, flattened (`flattenCollectionRequests`) — powers the
   * run-order checklist. Omitted/empty while the collection view hasn't loaded yet; the panel
   * still works, it just runs the whole collection with no checklist shown (pre-AP-028 behavior). */
  requests?: CollectionRequestView[];
}>) {
  const [run, setRun] = useState<UploadedCollectionExecutionRun | null>(null);
  const [runHistory, setRunHistory] = useState<Omit<UploadedCollectionExecutionRun, "results">[]>([]);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [showUnverifiedDialog, setShowUnverifiedDialog] = useState(false);
  const [pendingRiskTierConfirmation, setPendingRiskTierConfirmation] =
    useState<ExecutionConfirmationRequirement | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(requests.map((item) => item.id)));
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-selects everything whenever the *set* of runnable request ids changes (switching
  // collections, or adding/deleting a request while the editor is open) rather than trying to
  // preserve a partial selection across an edit — simplest predictable behavior, and "Reset"
  // below gets you back to it explicitly at any time regardless.
  // Deliberately keyed on this joined-ids string, not `requests` itself (a fresh array every render).
  const requestIdsKey = requests.map((item) => item.id).join(",");
  useEffect(() => {
    setSelectedIds(new Set(requests.map((item) => item.id)));
  }, [requestIdsKey]);

  function refreshHistory() {
    fetchUploadedCollectionRuns(uploadedCollection.id).then((result) => {
      if (result.ok) setRunHistory(result.runs);
    });
  }

  useEffect(() => {
    setRun(null);
    setStartError(null);
    setShowUnverifiedDialog(false);
    setPendingRiskTierConfirmation(null);
    refreshHistory();
  }, [uploadedCollection.id]);

  useEffect(() => {
    if (run?.status !== "in-progress") return;
    pollTimer.current = setTimeout(async () => {
      const result = await fetchUploadedCollectionRun(uploadedCollection.id, run.id);
      if (result.ok) {
        setRun(result.run);
        if (result.run.status !== "in-progress") refreshHistory();
      }
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [run, uploadedCollection.id]);

  async function handleSelectHistoryRun(runId: string) {
    const result = await fetchUploadedCollectionRun(uploadedCollection.id, runId);
    if (result.ok) setRun(result.run);
  }

  async function performStart(confirmed: boolean) {
    setStarting(true);
    setStartError(null);
    // Explicit ids only once the checklist has actually loaded (`requests.length > 0`) — while it
    // hasn't, omitting the field keeps the pre-AP-028 "run everything" behavior rather than
    // sending an empty selection that would 400.
    const selectedRequestIds = requests.length > 0 ? [...selectedIds] : undefined;
    const result = await startUploadedCollectionExecution(uploadedCollection.id, confirmed, selectedRequestIds);
    setStarting(false);
    if (!result.ok) {
      if (result.error === "unverified_content_confirmation_required") {
        setShowUnverifiedDialog(true);
        return;
      }
      if (result.error === "confirmation_required" && result.confirmation) {
        setPendingRiskTierConfirmation(result.confirmation);
        return;
      }
      setStartError(result.message);
      return;
    }
    setShowUnverifiedDialog(false);
    setPendingRiskTierConfirmation(null);
    setRun(result.run);
    refreshHistory();
  }

  function handleRunClick() {
    if (!uploadedCollection.confirmedAt) {
      setShowUnverifiedDialog(true);
      return;
    }
    performStart(false);
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(requests.map((item) => item.id)));
  }

  const runDisabled = starting || run?.status === "in-progress" || (requests.length > 0 && selectedIds.size === 0);

  async function handleCancel() {
    setCancelling(true);
    const result = await cancelUploadedCollectionExecution(uploadedCollection.id);
    setCancelling(false);
    if (result.ok) setRun(result.run);
  }

  return (
    <section
      data-testid="external-collection-run-panel"
      className="space-y-4 rounded-lg border border-border bg-surface p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{uploadedCollection.name}</h3>
        <button
          type="button"
          onClick={handleRunClick}
          disabled={runDisabled}
          className={BUTTON_STYLES.primary}
        >
          {starting ? "Starting…" : "Start run"}
        </button>
      </div>

      {requests.length > 0 && (
        <RunOrderChecklist
          requests={requests}
          selectedIds={selectedIds}
          onToggle={toggleSelected}
          onSelectAll={selectAll}
          disabled={starting || run?.status === "in-progress"}
        />
      )}

      {showUnverifiedDialog && (
        <UnverifiedContentDialog
          onConfirm={() => performStart(true)}
          onDecline={() => setShowUnverifiedDialog(false)}
        />
      )}

      {pendingRiskTierConfirmation && (
        <RiskTierConfirmationBanner
          requirement={pendingRiskTierConfirmation}
          onConfirm={() => performStart(true)}
          onCancel={() => setPendingRiskTierConfirmation(null)}
        />
      )}

      {startError && <ErrorState message={startError} />}

      {run && (
        <div data-testid="external-collection-run-summary" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={run.status} tone={runStatusTone(run.status)} />
            <StatusBadge label="Uploaded" tone="neutral" />
            {run.status === "in-progress" && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling || run.cancelRequested}
                className={BUTTON_STYLES.secondary}
              >
                {run.cancelRequested || cancelling ? "Cancelling…" : "Cancel run"}
              </button>
            )}
          </div>
          <RunOverview run={run} />
          <ul className="divide-y divide-border">
            {run.results.map((result, index) => (
              <ExternalCollectionResultRow key={`${result.requestName}-${index}`} result={result} />
            ))}
          </ul>
        </div>
      )}

      <RunHistory runs={runHistory} selectedRunId={run?.id} onSelect={handleSelectHistoryRun} />
    </section>
  );
}
