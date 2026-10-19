import { useEffect, useRef, useState, type ReactNode } from "react";
import { SCENARIO_OUTCOME_KINDS, type RunDetail, type ScenarioResult } from "@apipilot/shared-domain";
import { useSecurityRun } from "../../hooks/useSecurityRun";
import { cancelRun } from "../../services/securityLabClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ConfirmDialog } from "../ConfirmDialog";
import { ErrorState } from "../ErrorState";
import { Skeleton } from "../Skeleton";
import { StatusBadge } from "../StatusBadge";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { CLEANUP_STATE, OUTCOME_EXPLANATION, RUN_STATUS, failedCleanup, isRunFinal } from "./runViewModel";
import { formatTimestamp } from "./scenarioViewModel";
import { outcomeVariant } from "./securityViewModel";

/**
 * Following a run and reading its results (specs/057 FR-044 to FR-047). It polls once a second until the run is
 * final, shows how far it has got, offers Cancel behind a confirmation, and shows every result with its outcome as a
 * text badge and a sentence saying what that outcome does and does not mean: "blocked", "errored" and "not run" are
 * worded so none can be read as a pass. A cancelled or failed run is shown as partial, with the scenarios that never
 * got a result named. Cleanup that did not finish is shown with what was left behind and how to remove it by hand.
 *
 * `renderResultExtra` is the extension point for the findings view (task T124): it is called for each result row and
 * its content is shown under the result, so findings and links to them can be added without changing this component.
 */
export function RunProgress({
  runId,
  titles,
  onFinished,
  onDismiss,
  renderResultExtra,
}: Readonly<{
  runId: string;
  titles: Readonly<Record<string, string>>;
  /** Called once when the run reaches a final state, so lists that show execution status can be read again. */
  onFinished?: (detail: RunDetail) => void;
  onDismiss?: () => void;
  renderResultExtra?: (result: ScenarioResult) => ReactNode;
}>) {
  const { detail, error, polling, retry, refreshNow } = useSecurityRun(runId);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const reported = useRef<string | null>(null);

  const finalStatus = detail !== null && isRunFinal(detail.run.status);
  useEffect(() => {
    if (detail && finalStatus && reported.current !== detail.run.id) {
      reported.current = detail.run.id;
      onFinished?.(detail);
    }
  }, [detail, finalStatus, onFinished]);

  async function cancel() {
    setConfirmingCancel(false);
    setCancelError(null);
    const result = await cancelRun(runId);
    if (!result.ok) {
      setCancelError(result.message);
      return;
    }
    refreshNow();
  }

  if (!detail) {
    if (error) {
      return (
        <ErrorState testId="run-progress-error" message="The run could not be read" detail={`${error.message} The run may still be executing on the server.`}>
          <button type="button" onClick={retry} className={BUTTON_STYLES.secondary}>
            Retry
          </button>
        </ErrorState>
      );
    }
    return (
      <div role="status" aria-label="Reading the run" className="space-y-2">
        <Skeleton className="h-8 w-1/3 rounded bg-surface-strong" />
        <Skeleton className="h-24 w-full rounded bg-surface-strong" />
      </div>
    );
  }

  const { run, results, progress } = detail;
  const status = RUN_STATUS[run.status];
  const planned = progress.planned;
  const failedCleanups = failedCleanup(run.cleanup);
  const resultIds = new Set(results.map((result) => result.scenarioId));
  const withoutResult = run.plan.filter((item) => !resultIds.has(item.scenarioId));
  const nameOf = (id: string) => titles[id] ?? id;

  return (
    <section aria-label="Run progress" data-testid="run-progress" className="space-y-4" aria-busy={run.status === "in-progress"}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-text-primary">Run started {formatTimestamp(run.startedAt)}</h3>
        <StatusBadge label={status.label} tone={status.tone} />
        {onDismiss && finalStatus && (
          <button type="button" onClick={onDismiss} className={BUTTON_STYLES.secondary}>
            Close results
          </button>
        )}
      </div>
      <p className="text-sm text-text-secondary" data-testid="run-status-text">
        {status.explanation} Target: {run.profileSummary.environmentName} ({run.profileSummary.tier}).
        {run.cancelRequested && run.status === "in-progress" ? " Cancel requested: the run stops after the requests already in flight." : ""}
        {run.cancelReason === "backend-restart" ? " The backend restarted while this run was in progress, so it was cancelled." : ""}
      </p>

      <div className="space-y-1">
        <p role="status" className="text-sm text-text-primary" data-testid="run-progress-text">
          {progress.finished} of {planned} scenarios finished. {run.budget.used} of {run.budget.planned} planned requests used.
        </p>
        <progress className="h-2 w-full" max={Math.max(planned, 1)} value={progress.finished} aria-label="Scenarios finished" />
      </div>

      {(run.status === "cancelled" || run.status === "failed") && (
        <p className="rounded-md border border-warning-600/30 bg-warning-100 px-3 py-2 text-sm text-text-primary dark:bg-warning-500/10" data-testid="run-partial">
          Partial results: {results.length} of {planned} scenarios have a result. {withoutResult.length > 0 ? "The rest were not run and are listed below. Not run is not a pass." : ""}
        </p>
      )}

      {run.status === "in-progress" && !run.cancelRequested && (
        <button type="button" onClick={() => setConfirmingCancel(true)} className={BUTTON_STYLES.secondary}>
          Cancel run
        </button>
      )}
      {cancelError && <ErrorState testId="run-cancel-error" message="The run could not be cancelled" detail={cancelError} />}
      {error && (
        <ErrorState testId="run-progress-error" message={polling ? "The latest read of this run failed" : "The run could not be read"} detail={`${error.message} ${polling ? "Trying again." : "The run may still be executing on the server."}`}>
          {!polling && (
            <button type="button" onClick={retry} className={BUTTON_STYLES.secondary}>
              Retry
            </button>
          )}
        </ErrorState>
      )}

      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Outcomes so far" data-testid="run-summary-counts">
        {SCENARIO_OUTCOME_KINDS.map((kind) => (
          <div key={kind}>
            <dt className="inline text-text-secondary">{outcomeVariant(kind).label}: </dt>
            <dd className="inline font-medium text-text-primary">{run.summary[kind]}</dd>
          </div>
        ))}
      </dl>

      {(results.length > 0 || withoutResult.length > 0) && (
        <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label="Scenario results">
          <table className={TABLE_STYLES.table}>
            <caption className="sr-only">Results of the scenarios in this run</caption>
            <thead>
              <tr>
                <th scope="col" className={TABLE_STYLES.th}>Scenario</th>
                <th scope="col" className={TABLE_STYLES.th}>Outcome</th>
                <th scope="col" className={TABLE_STYLES.th}>What it means</th>
                <th scope="col" className={TABLE_STYLES.th}>Observed</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => {
                const variant = outcomeVariant(result.outcome);
                const extra = renderResultExtra?.(result);
                return (
                  <tr key={result.id} data-testid="run-result-row" data-outcome={result.outcome}>
                    <th scope="row" className={`${TABLE_STYLES.td} max-w-xs text-left font-medium`}>
                      {nameOf(result.scenarioId)}
                      <span className="block text-xs font-normal text-text-secondary">Version {result.version}</span>
                    </th>
                    <td className={TABLE_STYLES.td}>
                      <StatusBadge label={variant.label} tone={variant.tone} />
                    </td>
                    <td className={`${TABLE_STYLES.td} max-w-md`}>
                      <span className="block">{result.reason}</span>
                      <span className="block text-xs text-text-secondary">{OUTCOME_EXPLANATION[result.outcome]}</span>
                      {extra}
                    </td>
                    <td className={`${TABLE_STYLES.td} max-w-xs`}>
                      <span className="block text-xs">
                        {result.observed.responseStatus !== undefined ? `Status ${result.observed.responseStatus}. ` : ""}
                        {result.observed.statement}
                        {result.observed.truncated ? " (response truncated)" : ""}
                      </span>
                      <span className="block text-xs text-text-secondary">
                        {result.evidenceCount} {result.evidenceCount === 1 ? "request" : "requests"}, {result.durationMs} ms
                      </span>
                    </td>
                  </tr>
                );
              })}
              {finalStatus &&
                withoutResult.map((item) => {
                  const variant = outcomeVariant("not_run");
                  return (
                    <tr key={item.scenarioId} data-testid="run-result-row" data-outcome="not_run" data-recorded="false">
                      <th scope="row" className={`${TABLE_STYLES.td} max-w-xs text-left font-medium`}>
                        {nameOf(item.scenarioId)}
                        <span className="block text-xs font-normal text-text-secondary">Version {item.version}</span>
                      </th>
                      <td className={TABLE_STYLES.td}>
                        <StatusBadge label={variant.label} tone={variant.tone} />
                      </td>
                      <td className={`${TABLE_STYLES.td} max-w-md`}>
                        <span className="block">No result was recorded: the run ended before this scenario was attempted.</span>
                        <span className="block text-xs text-text-secondary">{OUTCOME_EXPLANATION.not_run}</span>
                      </td>
                      <td className={TABLE_STYLES.td}>
                        <span className="text-xs text-text-secondary">No request was sent for it.</span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {run.cleanup.length > 0 && (
        <section aria-label="Cleanup" className="space-y-2" data-testid="run-cleanup">
          <h4 className="text-sm font-semibold text-text-primary">Cleanup</h4>
          {failedCleanups.length > 0 && (
            <p role="alert" className="rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700 dark:border-danger-500 dark:bg-danger-500/10 dark:text-danger-100">
              Cleanup did not finish for {failedCleanups.length} {failedCleanups.length === 1 ? "item" : "items"}. Data created by this run may remain on the target.
            </p>
          )}
          <ul className="space-y-2">
            {run.cleanup.map((entry, index) => {
              const variant = CLEANUP_STATE[entry.state];
              return (
                <li key={`${entry.scenarioId ?? "run"}-${index}`} className="space-y-0.5 text-sm" data-testid="cleanup-entry" data-state={entry.state}>
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge label={variant.label} tone={variant.tone} />
                    <span className="text-text-primary">
                      {entry.scenarioId ? `${nameOf(entry.scenarioId)}: ` : ""}
                      {entry.action}
                    </span>
                  </span>
                  <span className="block text-text-secondary">{entry.detail}</span>
                  {entry.leftBehind && <span className="block text-text-primary">Left behind: {entry.leftBehind}</span>}
                  {entry.manualRemoval && <span className="block text-text-primary">To remove it yourself: {entry.manualRemoval}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {confirmingCancel && (
        <ConfirmDialog
          message="Cancel this run?"
          affectedCount={Math.max(planned - progress.finished, 0)}
          confirmLabel="Cancel run"
          details={<p className="text-sm text-text-secondary">Requests already sent cannot be recalled. Scenarios not yet run are not run, and the results so far are kept as partial results.</p>}
          onConfirm={() => void cancel()}
          onCancel={() => setConfirmingCancel(false)}
        />
      )}
    </section>
  );
}
