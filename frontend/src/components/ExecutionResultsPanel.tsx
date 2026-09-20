import { useEffect, useRef, useState } from "react";
import type {
  Environment,
  EnvironmentTier,
  ExecutionConfirmationRequirement,
  ExecutionRun,
  RawHeader,
  RequestResult,
} from "@apipilot/shared-domain";
import {
  cancelExecution,
  fetchEnvironments,
  fetchRun,
  fetchRuns,
  startExecution,
} from "../services/executionClient";
import { CodeBlock } from "./CodeBlock";
import { EmptyState } from "./EmptyState";
import { EnvironmentForm } from "./EnvironmentForm";
import { ErrorState } from "./ErrorState";
import { HttpMethodBadge } from "./HttpMethodBadge";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import { BUTTON_STYLES } from "./controlStyles";

const POLL_INTERVAL_MS = 750;

const FAILURE_CATEGORY_LABEL: Record<NonNullable<RequestResult["failureCategory"]>, string> = {
  "assertion-failed": "Assertion failed",
  "unexpected-status": "Unexpected status code",
  "connectivity-failure": "Connectivity failure",
  timeout: "Timed out",
  "could-not-evaluate": "Could not be evaluated",
};

const NOT_ATTEMPTED_LABEL: Record<NonNullable<RequestResult["notAttemptedReason"]>, string> = {
  cancelled: "Cancelled",
  "dependency-not-met": "Dependency not met",
  "run-ended-before-reached": "Run ended before this request",
};

const TIER_TONE: Record<EnvironmentTier, StatusTone> = {
  local: "neutral",
  dev: "neutral",
  qa: "info",
  staging: "warning",
  production: "danger",
};

function outcomeTone(result: RequestResult): StatusTone {
  if (result.outcome === "passed") return "success";
  if (result.outcome === "failed") return "danger";
  return "neutral";
}

function outcomeLabel(result: RequestResult): string {
  if (result.outcome === "passed") return "Passed";
  if (result.outcome === "failed") {
    return result.failureCategory ? FAILURE_CATEGORY_LABEL[result.failureCategory] : "Failed";
  }
  return result.notAttemptedReason ? NOT_ATTEMPTED_LABEL[result.notAttemptedReason] : "Not attempted";
}

function runStatusLabel(status: ExecutionRun["status"]): string {
  if (status === "in-progress") return "In progress";
  if (status === "cancelled") return "Cancelled";
  return "Completed";
}

function runStatusTone(status: ExecutionRun["status"]): StatusTone {
  if (status === "in-progress") return "info";
  if (status === "cancelled") return "warning";
  return "success";
}

/** Explicit environment choice + risk-tier visibility (FR-002, FR-003) — no environment is
 * pre-selected once more than one exists. */
function EnvironmentPicker({
  environments,
  selectedEnvironmentId,
  onSelect,
  onStart,
  onAddAnother,
  starting,
  runInProgress,
}: Readonly<{
  environments: Environment[];
  selectedEnvironmentId: string;
  onSelect: (id: string) => void;
  onStart: () => void;
  onAddAnother: () => void;
  starting: boolean;
  runInProgress: boolean;
}>) {
  const requiresExplicitChoice = environments.length > 1;
  const selected = environments.find((e) => e.id === selectedEnvironmentId);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="execution-env-select" className="text-xs font-medium text-muted">
        Environment
      </label>
      <select
        id="execution-env-select"
        data-testid="execution-env-select"
        value={selectedEnvironmentId}
        onChange={(event) => onSelect(event.target.value)}
        className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
      >
        {requiresExplicitChoice && (
          <option value="" disabled={selectedEnvironmentId !== ""}>
            Select an environment…
          </option>
        )}
        {environments.map((environment) => (
          <option key={environment.id} value={environment.id}>
            {environment.name} ({environment.tier})
          </option>
        ))}
      </select>
      {selected && <StatusBadge label={selected.tier} tone={TIER_TONE[selected.tier]} />}
      <button
        type="button"
        onClick={() => onStart()}
        disabled={starting || !selectedEnvironmentId || runInProgress}
        className={BUTTON_STYLES.primary}
      >
        {starting ? "Starting…" : "Run"}
      </button>
      <button type="button" onClick={onAddAnother} className={BUTTON_STYLES.ghost}>
        + Add another environment
      </button>
    </div>
  );
}

/** One labeled number in `RunOverview`'s stat row. */
function OverviewStat({ label, value, tone }: Readonly<{ label: string; value: string; tone?: StatusTone }>) {
  const toneClass: Record<StatusTone, string> = {
    neutral: "text-slate-900",
    info: "text-info-700",
    success: "text-success-700",
    warning: "text-warning-700",
    danger: "text-danger-700",
  };
  return (
    <div className="min-w-[6rem]">
      <dt className="text-xs font-medium uppercase text-muted">{label}</dt>
      <dd className={`text-lg font-semibold ${toneClass[tone ?? "neutral"]}`}>{value}</dd>
    </div>
  );
}

/** Endpoint coverage and aggregate timing for one run (asks #1/#4: how many endpoints this run
 * covers, and its overall result, at a glance — mirrors `PostmanGenerationStage`'s own
 * "N request(s) in M folder(s)" summary-line convention, extended into a small stat row). */
function RunOverview({ run }: Readonly<{ run: ExecutionRun }>) {
  const endpointCount = new Set(run.results.map((r) => `${r.operationMethod} ${r.operationPath}`)).size;
  const settledDurations = run.results
    .filter((r) => r.outcome !== "not-attempted")
    .map((r) => r.durationMs);
  const avgResponseMs =
    settledDurations.length > 0
      ? Math.round(settledDurations.reduce((sum, ms) => sum + ms, 0) / settledDurations.length)
      : 0;

  return (
    <dl data-testid="execution-run-overview" className="flex flex-wrap gap-4 rounded-md border border-border bg-slate-50 p-3">
      <OverviewStat label="Endpoints" value={String(endpointCount)} />
      <OverviewStat label="Requests" value={String(run.summary.total)} />
      <OverviewStat label="Passed" value={String(run.summary.passed)} tone="success" />
      <OverviewStat label="Failed" value={String(run.summary.failed)} tone={run.summary.failed > 0 ? "danger" : "neutral"} />
      <OverviewStat label="Not attempted" value={String(run.summary.notAttempted)} />
      <OverviewStat label="Duration" value={`${run.summary.durationMs} ms`} />
      <OverviewStat label="Avg. response time" value={`${avgResponseMs} ms`} />
    </dl>
  );
}

/** A `RawHeader[]` as a compact key/value table (ask #2 — every captured header, not a subset). */
function HeaderTable({ headers }: Readonly<{ headers: RawHeader[] }>) {
  if (headers.length === 0) {
    return <p className="text-xs text-muted">No headers.</p>;
  }
  return (
    <table className="w-full text-xs">
      <tbody>
        {headers.map((header) => (
          <tr key={header.key} className="border-b border-border last:border-0">
            <td className="w-1/3 py-1 pr-2 align-top font-mono font-medium text-slate-600">{header.key}</td>
            <td className="py-1 font-mono text-slate-700 break-all">{header.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Full raw request/response detail (ask #3), present only when `RequestResult.rawCapture` is
 * set — i.e. only for a `"local"`-tier run (FR-017a). */
function RawCaptureDetail({ rawCapture }: Readonly<{ rawCapture: NonNullable<RequestResult["rawCapture"]> }>) {
  return (
    <div className="mt-2 grid gap-3 sm:grid-cols-2">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase text-muted">Request</p>
        <p className="break-all font-mono text-xs text-slate-600">{rawCapture.requestUrl}</p>
        <HeaderTable headers={rawCapture.requestHeaders} />
        {rawCapture.requestBody && <CodeBlock label="Body" content={rawCapture.requestBody} />}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase text-muted">Response</p>
        <HeaderTable headers={rawCapture.responseHeaders} />
        {rawCapture.responseBody && <CodeBlock label="Body" content={rawCapture.responseBody} />}
      </div>
    </div>
  );
}

function assertionOutcomeTone(outcome: "passed" | "failed" | "could-not-evaluate"): StatusTone {
  if (outcome === "passed") return "success";
  if (outcome === "failed") return "danger";
  return "neutral";
}

/** Per-request diagnostic detail (FR-016): failure category, each assertion evaluated and its
 * outcome, duration, and response status. `rawCapture` (ask #2/#3) adds every request/response
 * header and body exactly as sent/received — present only for a `"local"`-tier run (FR-017a); for
 * every other tier this stays exactly the non-sensitive summary FR-017 always required. */
function ResultDetail({ result, tier }: Readonly<{ result: RequestResult; tier: EnvironmentTier }>) {
  return (
    <div
      data-testid="execution-result-detail"
      className="mt-2 space-y-2 rounded-md border border-border bg-slate-50 p-3 text-xs text-slate-600"
    >
      <p>
        {result.durationMs}ms
        {result.responseStatusCode !== undefined && ` · Response status ${result.responseStatusCode}`}
      </p>
      {result.assertionOutcomes.length > 0 && (
        <ul className="space-y-1">
          {result.assertionOutcomes.map((assertion) => (
            <li key={assertion.assertionIndex} className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-700">
                {assertion.type === "status-code" ? "Status code" : "Schema conformance"}
              </span>
              <StatusBadge
                label={assertion.outcome}
                tone={assertionOutcomeTone(assertion.outcome)}
              />
              {assertion.detail && <span>{assertion.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {result.rawCapture ? (
        <RawCaptureDetail rawCapture={result.rawCapture} />
      ) : (
        tier !== "local" && (
          <p className="text-slate-500">
            Full request/response headers and bodies are only captured for Local-tier runs.
          </p>
        )
      )}
    </div>
  );
}

function ExecutionResultRow({ result, tier }: Readonly<{ result: RequestResult; tier: EnvironmentTier }>) {
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
          <HttpMethodBadge method={result.operationMethod} />
          <span className="min-w-0 truncate font-mono text-xs text-slate-700" title={result.operationPath}>
            {result.operationPath}
          </span>
        </div>
        <StatusBadge label={outcomeLabel(result)} tone={outcomeTone(result)} />
      </button>
      {expanded && <ResultDetail result={result} tier={tier} />}
    </li>
  );
}

/** Client-side failure-only filter over the already-returned full result list (FR-021) — no
 * server-side filter parameter exists (contracts/execution-api.md). */
function ExecutionResultList({ results, tier }: Readonly<{ results: RequestResult[]; tier: EnvironmentTier }>) {
  const [failuresOnly, setFailuresOnly] = useState(false);
  const visible = failuresOnly ? results.filter((result) => result.outcome === "failed") : results;

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs font-medium text-muted">
        <input
          type="checkbox"
          checked={failuresOnly}
          onChange={(event) => setFailuresOnly(event.target.checked)}
        />
        Show failures only
      </label>
      <ul data-testid="execution-result-list" className="divide-y divide-border">
        {visible.map((result, index) => (
          <ExecutionResultRow key={`${result.scenarioId}-${index}`} result={result} tier={tier} />
        ))}
      </ul>
      {visible.length === 0 && (
        <EmptyState compact message="No results match the current filter." />
      )}
    </div>
  );
}

/** Required before a Staging/Production or destructive run may proceed (FR-007) — a distinct
 * action beyond the ordinary "Run" click, naming the tier and every destructive operation. */
function ConfirmationBanner({
  requirement,
  onConfirm,
  onCancel,
}: Readonly<{
  requirement: ExecutionConfirmationRequirement;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  return (
    <div
      role="alertdialog"
      data-testid="execution-confirmation-banner"
      className="space-y-3 border-l-4 border-warning-500 bg-warning-50 p-4 shadow-sm"
    >
      <p className="text-sm text-warning-700">
        This run targets a <strong>{requirement.environmentTier}</strong> environment
        {requirement.destructiveOperations.length > 0 && " and includes destructive requests"}.
      </p>
      {requirement.destructiveOperations.length > 0 && (
        <ul className="space-y-1 text-sm text-warning-700">
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

function RunSummary({
  run,
  onCancel,
  cancelling,
}: Readonly<{ run: ExecutionRun; onCancel: () => void; cancelling: boolean }>) {
  return (
    <div data-testid="execution-run-summary" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label={runStatusLabel(run.status)} tone={runStatusTone(run.status)} />
        {/* Static label (US3, FR-010, specs/026-external-collection-execution): this panel only
         * ever renders ApiPilot-generated runs — no shared `source` field on `ExecutionRun` is
         * needed, since an uploaded-collection run is always rendered in its own separate panel
         * (research.md D8/D9). */}
        <StatusBadge label="Generated" tone="neutral" />
        <StatusBadge label={run.environmentSnapshot.tier} tone={TIER_TONE[run.environmentSnapshot.tier]} />
        <p className="text-sm text-slate-600">
          {run.summary.passed} passed · {run.summary.failed} failed · {run.summary.notAttempted}{" "}
          not attempted · {run.results.length} result{run.results.length === 1 ? "" : "s"} so far
        </p>
        {run.status === "in-progress" && (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling || run.cancelRequested}
            className={BUTTON_STYLES.secondary}
          >
            {run.cancelRequested ? "Cancelling…" : cancelling ? "Cancelling…" : "Cancel run"}
          </button>
        )}
      </div>
      <RunOverview run={run} />
      <ExecutionResultList results={run.results} tier={run.environmentSnapshot.tier} />
    </div>
  );
}

/** A past run's summary row, selectable to view its full detail again (US5, FR-019/FR-020) — no
 * separate results screen: selecting one renders it through the same `RunSummary` above. */
function RunHistory({
  runs,
  selectedRunId,
  onSelect,
}: Readonly<{
  runs: Omit<ExecutionRun, "results">[];
  selectedRunId: string | undefined;
  onSelect: (runId: string) => void;
}>) {
  if (runs.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase text-muted">Run history</h3>
      <ul data-testid="execution-run-history" className="divide-y divide-border">
        {runs.map((historyRun) => (
          <li key={historyRun.id}>
            <button
              type="button"
              onClick={() => onSelect(historyRun.id)}
              aria-current={historyRun.id === selectedRunId}
              className={`flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 py-2 text-left text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                historyRun.id === selectedRunId ? "bg-slate-50" : ""
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <StatusBadge label={runStatusLabel(historyRun.status)} tone={runStatusTone(historyRun.status)} />
                <StatusBadge label="Generated" tone="neutral" />
                <span className="min-w-0 truncate text-slate-700">{historyRun.environmentSnapshot.name}</span>
                <StatusBadge
                  label={historyRun.environmentSnapshot.tier}
                  tone={TIER_TONE[historyRun.environmentSnapshot.tier]}
                />
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
 * Triggers an execution run against a chosen environment and renders its live summary and
 * per-request results, visibly distinguishing in-progress from completed (FR-013, FR-014).
 * Environment selection is explicit — nothing is auto-selected once more than one environment
 * exists (FR-003) — and the selected environment's risk tier is always visible (FR-002).
 */
export function ExecutionResultsPanel() {
  const [environments, setEnvironments] = useState<Environment[] | null>(null);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string>("");
  const [showEnvironmentForm, setShowEnvironmentForm] = useState(false);

  const [run, setRun] = useState<ExecutionRun | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<ExecutionConfirmationRequirement | null>(
    null,
  );
  const [cancelling, setCancelling] = useState(false);
  const [runHistory, setRunHistory] = useState<Omit<ExecutionRun, "results">[]>([]);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function refreshHistory() {
    fetchRuns().then((result) => {
      if (result.ok) setRunHistory(result.runs);
    });
  }

  useEffect(() => {
    let cancelled = false;
    fetchEnvironments().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setEnvironments(result.environments);
        // Auto-selecting is only ever a no-op convenience when there is exactly one environment
        // to choose from — with two or more, nothing is pre-selected (FR-003).
        if (result.environments.length === 1) setSelectedEnvironmentId(result.environments[0].id);
      } else {
        setEnvironments([]);
      }
    });
    refreshHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (run?.status !== "in-progress") return;
    pollTimer.current = setTimeout(async () => {
      const result = await fetchRun(run.id);
      if (result.ok) {
        setRun(result.run);
        // A run reaching a terminal state changes its own history row's status/summary.
        if (result.run.status !== "in-progress") refreshHistory();
      }
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [run]);

  async function handleSelectRun(runId: string) {
    const result = await fetchRun(runId);
    if (result.ok) setRun(result.run);
  }

  function handleEnvironmentSaved(environment: Environment) {
    setEnvironments((current) => {
      const withoutPrior = (current ?? []).filter((e) => e.id !== environment.id);
      return [...withoutPrior, environment];
    });
    setSelectedEnvironmentId(environment.id);
    setShowEnvironmentForm(false);
  }

  async function handleStart(confirmed = false) {
    if (!selectedEnvironmentId) return;
    setStarting(true);
    setStartError(null);
    const result = await startExecution(selectedEnvironmentId, confirmed);
    setStarting(false);
    if (!result.ok) {
      if (result.error === "confirmation_required" && result.confirmation) {
        setPendingConfirmation(result.confirmation);
        return;
      }
      setStartError(result.message);
      return;
    }
    setPendingConfirmation(null);
    setRun(result.run);
    refreshHistory();
  }

  async function handleCancel() {
    setCancelling(true);
    const result = await cancelExecution();
    setCancelling(false);
    if (result.ok) setRun(result.run);
  }

  const hasEnvironments = (environments?.length ?? 0) > 0;

  return (
    <section
      aria-labelledby="execution-results-heading"
      data-testid="execution-results-panel"
      className="space-y-4 rounded-lg border border-border bg-surface p-5 shadow-sm"
    >
      <h2 id="execution-results-heading" className="text-base font-semibold text-slate-900">
        Run &amp; Results
      </h2>
      <p className="text-sm text-slate-600">
        Execute the approved collection against a real environment and see pass/fail results per
        request.
      </p>

      {hasEnvironments && !showEnvironmentForm && (
        <EnvironmentPicker
          environments={environments!}
          selectedEnvironmentId={selectedEnvironmentId}
          onSelect={setSelectedEnvironmentId}
          onStart={handleStart}
          onAddAnother={() => setShowEnvironmentForm(true)}
          starting={starting}
          runInProgress={run?.status === "in-progress"}
        />
      )}

      {(!hasEnvironments || showEnvironmentForm) && (
        <EnvironmentForm
          onSaved={handleEnvironmentSaved}
          onCancel={hasEnvironments ? () => setShowEnvironmentForm(false) : undefined}
        />
      )}

      {pendingConfirmation && (
        <ConfirmationBanner
          requirement={pendingConfirmation}
          onConfirm={() => handleStart(true)}
          onCancel={() => setPendingConfirmation(null)}
        />
      )}

      {startError && <ErrorState testId="execution-start-error" message={startError} />}

      {run && <RunSummary run={run} onCancel={handleCancel} cancelling={cancelling} />}

      <RunHistory runs={runHistory} selectedRunId={run?.id} onSelect={handleSelectRun} />
    </section>
  );
}
