import { useEffect, useRef, useState } from "react";
import type {
  Environment,
  EnvironmentTier,
  ExecutionConfirmationRequirement,
  ExecutionRun,
  RequestResult,
} from "@apipilot/shared-domain";
import {
  cancelExecution,
  fetchEnvironments,
  fetchRun,
  fetchRuns,
  startExecution,
} from "../services/executionClient";
import { EnvironmentForm } from "./EnvironmentForm";
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
      <button
        type="button"
        onClick={onAddAnother}
        className="text-sm font-medium text-brand-700 hover:text-brand-800"
      >
        + Add another environment
      </button>
    </div>
  );
}

function assertionOutcomeTone(outcome: "passed" | "failed" | "could-not-evaluate"): StatusTone {
  if (outcome === "passed") return "success";
  if (outcome === "failed") return "danger";
  return "neutral";
}

/** Per-request diagnostic detail (FR-016): failure category, each assertion evaluated and its
 * outcome, duration, and response status — everything needed to understand a failure without
 * exposing a raw request/response body (FR-017). */
function ResultDetail({ result }: Readonly<{ result: RequestResult }>) {
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
    </div>
  );
}

function ExecutionResultRow({ result }: Readonly<{ result: RequestResult }>) {
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
      {expanded && <ResultDetail result={result} />}
    </li>
  );
}

/** Client-side failure-only filter over the already-returned full result list (FR-021) — no
 * server-side filter parameter exists (contracts/execution-api.md). */
function ExecutionResultList({ results }: Readonly<{ results: RequestResult[] }>) {
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
          <ExecutionResultRow key={`${result.scenarioId}-${index}`} result={result} />
        ))}
      </ul>
      {visible.length === 0 && (
        <p className="text-sm text-muted">No results match the current filter.</p>
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
      <ExecutionResultList results={run.results} />
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
      className="space-y-4 rounded-md border border-border bg-surface p-5 shadow-sm"
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

      {startError && (
        <p
          role="alert"
          data-testid="execution-start-error"
          className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {startError}
        </p>
      )}

      {run && <RunSummary run={run} onCancel={handleCancel} cancelling={cancelling} />}

      <RunHistory runs={runHistory} selectedRunId={run?.id} onSelect={handleSelectRun} />
    </section>
  );
}
