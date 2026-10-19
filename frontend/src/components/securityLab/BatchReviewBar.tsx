import { useId, useMemo, useState, type ReactNode } from "react";
import { SECURITY_REVIEW_ACTIONS, type SecurityReviewAction } from "@apipilot/shared-domain";
import { useSecurityResource } from "../../hooks/useSecurityResource";
import { listAllScenarios, listScenarioIds, reviewScenarios, type ScenarioFilterQuery } from "../../services/securityLabClient";
import { BUTTON_STYLES, FIELD_STYLES } from "../controlStyles";
import { ConfirmDialog } from "../ConfirmDialog";
import { ErrorState } from "../ErrorState";
import { Banner } from "../patterns/Banner";
import { Card, CardHeader } from "../patterns/Card";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { Skeleton } from "../Skeleton";
import { StatusBadge } from "../StatusBadge";
import type { ReviewReport } from "./ReviewOutcomes";
import {
  ACTION_LABEL,
  actionsOffered,
  joinCandidates,
  partitionBatch,
  splitOperationKey,
  totalExcluded,
  type BatchCandidate,
} from "./scenarioViewModel";
import { reviewStateVariant } from "./securityViewModel";

/** The most rows of the exact set listed at once; the count above it always covers every scenario. */
const MAX_LISTED = 200;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function SetTable({ candidates }: Readonly<{ candidates: readonly BatchCandidate[] }>) {
  const shown = candidates.slice(0, MAX_LISTED);
  return (
    <div className="space-y-1">
      <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label="Scenarios in this batch">
        <table className={TABLE_STYLES.table}>
          <caption className="sr-only">The exact scenarios this batch action will be sent for</caption>
          <thead>
            <tr>
              <th scope="col" className={TABLE_STYLES.th}>Scenario</th>
              <th scope="col" className={TABLE_STYLES.th}>Operation</th>
              <th scope="col" className={TABLE_STYLES.th}>Review state</th>
              <th scope="col" className={TABLE_STYLES.th}>Version</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((candidate) => {
              const state = reviewStateVariant(candidate.reviewState);
              return (
                <tr key={candidate.id} data-testid="batch-set-row">
                  <th scope="row" className={`${TABLE_STYLES.td} text-left font-medium`}>
                    {candidate.title}
                    {candidate.destructive && (
                      <span className="ml-2 inline-block align-middle">
                        <StatusBadge label="Destructive" tone="danger" />
                      </span>
                    )}
                  </th>
                  <td className={TABLE_STYLES.tdMono}>
                    <span className="break-all">{candidate.operationKey}</span>
                  </td>
                  <td className={TABLE_STYLES.td}>
                    <StatusBadge label={state.label} tone={state.tone} />
                  </td>
                  <td className={TABLE_STYLES.td}>{candidate.version}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {candidates.length > MAX_LISTED && (
        <p className="text-xs text-text-secondary">
          Showing the first {MAX_LISTED} of {candidates.length}. The action is sent for all {candidates.length}.
        </p>
      )}
    </div>
  );
}

/**
 * The panel for one resolved set: the action, what it will be sent for, what is left out and why, and the apply
 * control. Destructive and incomplete scenarios are left out by default with their counts visible; including the
 * destructive ones opens a separate confirmation that names each (specs/057 FR-031, FR-033).
 */
function BatchPanel({ candidates, onReviewed }: Readonly<{ candidates: readonly BatchCandidate[]; onReviewed: (report: ReviewReport) => void }>) {
  const [chosen, setChosen] = useState<SecurityReviewAction | null>(null);
  const [includeDestructive, setIncludeDestructive] = useState(false);
  const [includeIncomplete, setIncludeIncomplete] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const reasonId = useId();
  const groupId = useId();

  const offered = useMemo(() => actionsOffered(candidates), [candidates]);
  const action: SecurityReviewAction | undefined = chosen && offered.includes(chosen) ? chosen : offered[0];
  const partition = useMemo(
    () => (action ? partitionBatch(candidates, action, { includeDestructive, includeIncomplete }) : undefined),
    [candidates, action, includeDestructive, includeIncomplete],
  );

  if (!action || !partition) {
    return <p className="text-sm text-text-secondary">No scenario in this set can take a review action.</p>;
  }

  const { send, destructiveSent, excluded } = partition;
  const needsReason = action === "reject";
  const reasonMissing = needsReason && reason.trim() === "";
  const disabledReason = send.length === 0 ? "Nothing in this set can be sent for this action with the current choices." : reasonMissing ? "Rejecting needs a reason." : undefined;

  async function perform(confirmedDestructive: boolean) {
    if (!action) return;
    setConfirming(false);
    setBusy(true);
    setError(null);
    const result = await reviewScenarios({
      action,
      items: send.map(({ id, version }) => ({ id, version })),
      ...(needsReason ? { reason: reason.trim() } : {}),
      ...(confirmedDestructive ? { destructiveConfirmations: destructiveSent.map((candidate) => candidate.id) } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setReason("");
    onReviewed({
      action,
      applied: result.data.applied,
      refused: result.data.refused,
      titles: Object.fromEntries(send.map((candidate) => [candidate.id, candidate.title])),
    });
  }

  return (
    <div className="space-y-3" data-testid="batch-panel">
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-text-primary">Action for this set</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {SECURITY_REVIEW_ACTIONS.filter((candidate) => offered.includes(candidate)).map((candidate) => {
            const allowed = candidates.length - partitionBatch(candidates, candidate, { includeDestructive: true, includeIncomplete: true }).excluded.notAllowedFromState;
            const optionId = `${groupId}-${candidate}`;
            return (
              <label key={candidate} htmlFor={optionId} className="flex items-center gap-1.5 text-sm text-text-primary">
                <input
                  id={optionId}
                  type="radio"
                  name={groupId}
                  value={candidate}
                  checked={action === candidate}
                  onChange={() => setChosen(candidate)}
                  className="h-4 w-4 border-border-control"
                />
                {ACTION_LABEL[candidate]}
                <span className="text-xs text-text-secondary">
                  ({allowed} of {candidates.length} can take it)
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={includeIncomplete} onChange={(event) => setIncludeIncomplete(event.target.checked)} className="h-4 w-4 rounded border-border-control" />
          Include incomplete scenarios (an unmet prerequisite)
        </label>
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={includeDestructive} onChange={(event) => setIncludeDestructive(event.target.checked)} className="h-4 w-4 rounded border-border-control" />
          Include destructive scenarios (each is confirmed by name before anything is sent)
        </label>
      </div>

      {needsReason && (
        <div className="flex flex-col gap-1">
          <label htmlFor={reasonId} className="text-sm font-medium text-text-primary">
            Reason for rejecting (required, applied to every scenario)
          </label>
          <textarea id={reasonId} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} className={`${FIELD_STYLES} w-full`} />
        </div>
      )}

      <div className="space-y-1 text-sm text-text-secondary" aria-live="polite" data-testid="batch-summary">
        <p className="font-medium text-text-primary">
          {ACTION_LABEL[action]} will be sent for {plural(send.length, "scenario", "scenarios")} of {candidates.length}.
        </p>
        {totalExcluded(excluded) > 0 && (
          <>
            <p>Left out ({totalExcluded(excluded)}):</p>
            <ul className="list-disc pl-5" data-testid="batch-exclusions">
              {excluded.notAllowedFromState > 0 && <li>{excluded.notAllowedFromState} not allowed from their current review state.</li>}
              {excluded.needsCurrentSpecification > 0 && (
                <li>{excluded.needsCurrentSpecification} cannot be checked against a current specification (stale, orphaned, or no specification loaded).</li>
              )}
              {excluded.destructive > 0 && <li>{excluded.destructive} destructive, not included. Tick the destructive option to include them.</li>}
              {excluded.incomplete > 0 && <li>{excluded.incomplete} incomplete, not included. Tick the incomplete option to include them.</li>}
            </ul>
          </>
        )}
      </div>

      <details>
        <summary className="cursor-pointer text-sm font-medium text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
          List the {plural(send.length, "scenario", "scenarios")} this will be sent for
        </summary>
        <div className="mt-2">
          <SetTable candidates={send} />
        </div>
      </details>

      {error && <ErrorState testId="batch-error" message="The batch was not applied" detail={error} />}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || disabledReason !== undefined}
          aria-describedby={disabledReason ? `${groupId}-disabled` : undefined}
          onClick={() => (destructiveSent.length > 0 ? setConfirming(true) : void perform(false))}
          className={BUTTON_STYLES.primary}
        >
          {busy ? "Applying..." : `${ACTION_LABEL[action]}: ${plural(send.length, "scenario", "scenarios")}`}
        </button>
        {disabledReason && (
          <span id={`${groupId}-disabled`} className="text-xs text-text-secondary">
            {disabledReason}
          </span>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          message={`This batch includes ${plural(destructiveSent.length, "destructive scenario", "destructive scenarios")}. Confirm ${destructiveSent.length === 1 ? "it" : "each one"} by name.`}
          affectedCount={destructiveSent.length}
          confirmLabel={`${ACTION_LABEL[action]} destructive`}
          details={
            <div className="space-y-1 text-sm text-text-secondary">
              <p>Each of these may change or delete data on the target. The other {send.length - destructiveSent.length} in the batch are not destructive.</p>
              <ul className="list-disc pl-5" data-testid="destructive-confirmation-list">
                {destructiveSent.map((candidate) => {
                  const operation = splitOperationKey(candidate.operationKey);
                  return (
                    <li key={candidate.id}>
                      <span className="font-medium text-text-primary">{candidate.title}</span>{" "}
                      <span className="font-mono text-xs">
                        ({operation.method} {operation.path})
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          }
          onConfirm={() => void perform(true)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

/**
 * Batch review over the current filter (specs/057 FR-031, FR-032, contracts "Batch rules"). The filter is resolved
 * through `GET /scenarios/ids` into an explicit list of `{id, version}`, whose count is always shown; the exact set can
 * be listed before anything is sent. A set the server had to cap is refused outright: acting on part of it would be a
 * silent subset, so the engineer is asked to narrow the filter. The server never expands a filter; this bar names
 * every scenario.
 */
export function BatchReviewBar({
  filters,
  refreshToken,
  onReviewed,
}: Readonly<{ filters: ScenarioFilterQuery; refreshToken: number; onReviewed: (report: ReviewReport) => void }>) {
  const [open, setOpen] = useState(false);
  const ids = useSecurityResource((signal) => listScenarioIds(filters, { signal }), [filters, refreshToken]);
  const resolved = ids.data !== null && !ids.data.capped && ids.data.total > 0;
  const set = useSecurityResource((signal) => listAllScenarios(filters, { signal }), [filters, refreshToken], open && resolved);

  const joined = useMemo(() => (ids.data && set.data ? joinCandidates(ids.data.items, set.data) : undefined), [ids.data, set.data]);
  const settling = ids.loading || set.loading;

  function reload() {
    ids.refresh();
    set.refresh();
  }

  let body: ReactNode;
  if (ids.problem && !ids.data) {
    body = (
      <ErrorState testId="batch-ids-error" message="The set to review could not be resolved" detail={`${ids.problem.message} No batch action is offered until it can.`}>
        <button type="button" onClick={ids.refresh} className={BUTTON_STYLES.secondary}>
          Retry
        </button>
      </ErrorState>
    );
  } else if (!ids.data) {
    body = (
      <div role="status" aria-label="Resolving the set to review">
        <Skeleton className="h-10 w-full rounded bg-surface-strong" />
      </div>
    );
  } else if (ids.data.total === 0) {
    body = <p className="text-sm text-text-secondary">No scenarios match the current filters, so there is nothing to review in bulk.</p>;
  } else if (ids.data.capped) {
    body = (
      <Banner tone="warning" title="Too many scenarios match to review as one batch" role="status" testId="batch-capped">
        The current filters match {ids.data.total} scenarios, more than the {ids.data.items.length} a batch can name. No batch action is offered on part of the set. Narrow the
        filters, by category, operation or review state, until the set is small enough.
      </Banner>
    );
  } else {
    body = (
      <>
        <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} className={BUTTON_STYLES.secondary}>
          {open ? "Hide batch review" : `Review these ${ids.data.total} ${ids.data.total === 1 ? "scenario" : "scenarios"} as a batch`}
        </button>
        {open &&
          (set.problem && !set.data ? (
            <ErrorState testId="batch-set-error" message="The scenarios in this set could not be read" detail={set.problem.message}>
              <button type="button" onClick={set.refresh} className={BUTTON_STYLES.secondary}>
                Retry
              </button>
            </ErrorState>
          ) : !joined || settling ? (
            <div role="status" aria-label="Loading the exact set" className="space-y-2">
              <Skeleton className="h-24 w-full rounded bg-surface-strong" />
            </div>
          ) : joined.missing > 0 ? (
            <ErrorState
              testId="batch-set-changed"
              message="The set changed while it was loading"
              detail={`${joined.missing} of the ${ids.data.total} scenarios could not be read, so no action is offered on part of the set.`}
            >
              <button type="button" onClick={reload} className={BUTTON_STYLES.secondary}>
                Reload the set
              </button>
            </ErrorState>
          ) : (
            <BatchPanel candidates={joined.candidates} onReviewed={onReviewed} />
          ))}
      </>
    );
  }

  return (
    <Card as="section" aria-labelledby="batch-heading" data-testid="batch-review-bar">
      <CardHeader title="Review in bulk" titleId="batch-heading" subtitle="Acts only on the exact set you can see and list; destructive scenarios need their own confirmation." />
      {ids.data && (
        <p className="mb-3 text-sm text-text-secondary" data-testid="batch-count">
          {ids.data.capped
            ? `More than ${ids.data.items.length} scenarios match the current filters.`
            : `${plural(ids.data.total, "scenario matches", "scenarios match")} the current filters.`}
        </p>
      )}
      <div className="space-y-3">{body}</div>
    </Card>
  );
}
