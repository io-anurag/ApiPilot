import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { RunPlanProblem, RunPreview, RunRequestInput, SecurityRunView } from "@apipilot/shared-domain";
import { startRun } from "../../services/securityLabClient";
import { BUTTON_STYLES, FIELD_STYLES } from "../controlStyles";
import { Dialog } from "../Dialog";
import { ErrorState } from "../ErrorState";
import { StatusBadge } from "../StatusBadge";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { requiresTargetRetype } from "./profileViewModel";
import { buildConfirmation, checkStart, missingConfirmationText, parsePlanProblems, problemText } from "./runViewModel";
import { splitOperationKey } from "./scenarioViewModel";

interface StartFailure {
  readonly code: string;
  readonly message: string;
  readonly problems: RunPlanProblem[];
  readonly missing: string[];
  readonly runId?: string;
}

/**
 * Confirms a run before any request is sent (specs/057 FR-041 to FR-043, FR-045, contracts/execution-safety-rules.md
 * section 5). It shows the preview exactly as the server returned it, says plainly that real requests will be sent,
 * and enables Start only when everything the tier requires is done: the authorization attestation, for any tier but
 * local the exact target name and base URL typed out (compared exactly), and a separate confirmation of each
 * destructive scenario by title and operation. The start request carries the digest of the preview, so what runs is
 * what was shown; if the plan changed the server refuses it and this dialog says to preview again.
 */
export function RunPlanDialog({
  preview,
  request,
  onStarted,
  onPreviewAgain,
  onClose,
}: Readonly<{
  preview: RunPreview;
  request: RunRequestInput;
  onStarted: (run: SecurityRunView, titles: Readonly<Record<string, string>>) => void;
  /** The plan changed since the preview: the parent previews again and shows the new plan. */
  onPreviewAgain: () => void;
  onClose: () => void;
}>) {
  const { summary, scenarios, problems, planDigest } = preview;
  const base = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [attested, setAttested] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [typedUrl, setTypedUrl] = useState("");
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<StartFailure | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const retype = requiresTargetRetype(summary.tier);
  const inputs = useMemo(() => ({ attested, typedName, typedUrl, destructiveConfirmed: confirmed }), [attested, typedName, typedUrl, confirmed]);
  const check = checkStart(summary, problems, inputs);

  async function start() {
    setStarting(true);
    setFailure(null);
    const result = await startRun({ ...request, planDigest, confirmation: buildConfirmation(summary, inputs) });
    setStarting(false);
    if (!result.ok) {
      setFailure({
        code: result.error,
        message: result.message,
        problems: parsePlanProblems(result.details),
        missing: missingConfirmationText(result.details),
        ...(typeof result.details.runId === "string" ? { runId: result.details.runId } : {}),
      });
      return;
    }
    onStarted(result.data.run, Object.fromEntries(scenarios.map((entry) => [entry.scenarioId, entry.title])));
  }

  const toggle = (id: string, on: boolean) =>
    setConfirmed((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Dialog
      role="alertdialog"
      labelledBy={`${base}-title`}
      testId="run-plan-dialog"
      panelClassName="w-full max-w-3xl space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-xl"
      onClose={starting ? () => undefined : onClose}
    >
      <>
        <h2 id={`${base}-title`} className="text-lg font-semibold text-text-primary">
          Confirm this run
        </h2>
        <p className="rounded-md border border-warning-600/30 bg-warning-100 px-3 py-2 text-sm font-semibold text-text-primary dark:bg-warning-500/10" data-testid="run-statement">
          {summary.statement}
        </p>

        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid="run-summary">
          <div>
            <dt className="inline text-text-secondary">Profile: </dt>
            <dd className="inline font-medium text-text-primary">{summary.profileName}</dd>
          </div>
          <div>
            <dt className="inline text-text-secondary">Target: </dt>
            <dd className="inline font-medium text-text-primary">
              {summary.environmentName} <StatusBadge label={summary.tier} />
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="inline text-text-secondary">Base URL: </dt>
            <dd className="inline break-all font-mono text-xs text-text-primary">{summary.baseUrl}</dd>
          </div>
          <div>
            <dt className="inline text-text-secondary">Certificate verification: </dt>
            <dd className="inline text-text-primary">{summary.tlsPolicy}</dd>
          </div>
          <div>
            <dt className="inline text-text-secondary">Sent to: </dt>
            <dd className="inline font-mono text-xs text-text-primary">{summary.destinations.map((entry) => `${entry.host}:${entry.port}`).join(", ") || "no destination"}</dd>
          </div>
          <div>
            <dt className="inline text-text-secondary">Scenarios: </dt>
            <dd className="inline text-text-primary">{summary.scenarioCount}</dd>
          </div>
          <div>
            <dt className="inline text-text-secondary">Planned requests: </dt>
            <dd className="inline text-text-primary">
              {summary.plannedRequests} (including {summary.cleanupRequests} for cleanup)
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="inline text-text-secondary">Limits: </dt>
            <dd className="inline text-text-primary">
              at most {summary.limits.maxRequests} requests, {summary.limits.maxConcurrency} at once, {summary.limits.timeoutMs} ms per request
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="inline text-text-secondary">Permitted categories: </dt>
            <dd className="inline text-text-primary">{summary.permittedCategories.join(", ") || "none"}</dd>
          </div>
        </dl>

        {problems.length > 0 && (
          <ErrorState testId="run-plan-problems" message="This plan cannot start">
            <ul className="list-disc pl-5" aria-label="Plan problems">
              {problems.map((problem, index) => (
                <li key={`${problem.code}-${problem.scenarioId ?? ""}-${index}`}>{problemText(problem)}</li>
              ))}
            </ul>
          </ErrorState>
        )}

        <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label="Scenarios in this run">
          <table className={TABLE_STYLES.table}>
            <caption className="sr-only">The scenarios this run will execute</caption>
            <thead>
              <tr>
                <th scope="col" className={TABLE_STYLES.th}>Scenario</th>
                <th scope="col" className={TABLE_STYLES.th}>Operation</th>
                <th scope="col" className={TABLE_STYLES.th}>Requests</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((entry) => (
                <tr key={entry.scenarioId} data-testid="run-plan-row">
                  <th scope="row" className={`${TABLE_STYLES.td} text-left font-medium`}>
                    {entry.title}
                    {entry.destructive && (
                      <span className="ml-2 inline-block align-middle">
                        <StatusBadge label="Destructive" tone="danger" />
                      </span>
                    )}
                  </th>
                  <td className={TABLE_STYLES.tdMono}>
                    <span className="break-all">{entry.operationKey}</span>
                  </td>
                  <td className={TABLE_STYLES.td}>{entry.plannedRequests}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {summary.destructive.length > 0 && (
          <fieldset className="space-y-2 rounded-md border border-danger-600/40 p-3" data-testid="destructive-confirmations">
            <legend className="px-1 text-sm font-semibold text-text-primary">Destructive scenarios: confirm each one</legend>
            <p className="text-xs text-text-secondary">Each of these may change or delete data on the target. Tick each to confirm it by name.</p>
            {summary.destructive.map((entry) => {
              const operation = splitOperationKey(entry.operationKey);
              return (
                <label key={entry.scenarioId} className="flex items-start gap-2 text-sm text-text-primary">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border-control" checked={confirmed.has(entry.scenarioId)} onChange={(event) => toggle(entry.scenarioId, event.target.checked)} />
                  <span>
                    {entry.title} (<span className="font-mono text-xs">{operation.method} {operation.path}</span>) may change or delete data
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}

        {retype && (
          <fieldset className="space-y-2" data-testid="retype-target">
            <legend className="text-sm font-semibold text-text-primary">Confirm the target</legend>
            <p className="text-xs text-text-secondary">This target is not local. Type its exact name and base URL as shown above. They are compared exactly.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${base}-name`} className="text-xs font-medium text-text-secondary">Type the target name</label>
                <input id={`${base}-name`} type="text" value={typedName} onChange={(event) => setTypedName(event.target.value)} autoComplete="off" spellCheck={false} className={FIELD_STYLES} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${base}-url`} className="text-xs font-medium text-text-secondary">Type the base URL</label>
                <input id={`${base}-url`} type="text" value={typedUrl} onChange={(event) => setTypedUrl(event.target.value)} autoComplete="off" spellCheck={false} className={`${FIELD_STYLES} font-mono`} />
              </div>
            </div>
          </fieldset>
        )}

        <label className="flex items-start gap-2 text-sm text-text-primary">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border-control" checked={attested} onChange={(event) => setAttested(event.target.checked)} />
          <span>I am authorized to test this target, and I understand that real requests will be sent to it.</span>
        </label>

        {failure && (
          <ErrorState testId="run-start-error" message={failure.code === "plan_changed" ? "The plan changed since it was previewed" : "The run did not start"} detail={failure.message}>
            {failure.code === "plan_changed" && (
              <div className="space-y-1">
                <p>Preview the run again, check the new plan and confirm it. Nothing was sent.</p>
                <button type="button" onClick={onPreviewAgain} className={BUTTON_STYLES.secondary}>
                  Preview again
                </button>
              </div>
            )}
            {failure.missing.length > 0 && (
              <ul className="list-disc pl-5" aria-label="Missing confirmations">
                {failure.missing.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {failure.problems.length > 0 && (
              <ul className="list-disc pl-5" aria-label="Plan problems from the server">
                {failure.problems.map((problem, index) => (
                  <li key={`${problem.code}-${index}`}>{problemText(problem)}</li>
                ))}
              </ul>
            )}
          </ErrorState>
        )}

        <div className="space-y-2">
          {!check.canStart && (
            <ul id={`${base}-needed`} className="list-disc pl-5 text-xs text-text-secondary" data-testid="start-needed">
              {check.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" ref={closeRef} onClick={onClose} disabled={starting} className={BUTTON_STYLES.secondary}>
              Cancel
            </button>
            <button type="button" onClick={() => void start()} disabled={!check.canStart || starting} aria-describedby={check.canStart ? undefined : `${base}-needed`} className={BUTTON_STYLES.danger}>
              {starting ? "Starting..." : "Start run"}
            </button>
          </div>
        </div>
      </>
    </Dialog>
  );
}
