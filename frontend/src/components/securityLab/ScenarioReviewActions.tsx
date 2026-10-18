import { useId, useState } from "react";
import type { ScenarioListItem, SecurityReviewAction } from "@apipilot/shared-domain";
import { reviewScenarios } from "../../services/securityLabClient";
import { BUTTON_STYLES } from "../controlStyles";
import { ConfirmDialog } from "../ConfirmDialog";
import { ErrorState } from "../ErrorState";
import type { ReviewReport } from "./ReviewOutcomes";
import { ACTION_LABEL, actionBlockedReason, allowedActions, splitOperationKey } from "./scenarioViewModel";

/**
 * The review actions for one scenario (specs/057 FR-028, FR-032, FR-033): only the actions its state allows are
 * offered, and one the server would refuse is disabled with the reason beside it. Rejecting asks for the reason it
 * needs; approving a destructive scenario asks for a confirmation that names it. The request always names this one
 * scenario at the version shown.
 */
export function ScenarioReviewActions({
  scenario,
  onReviewed,
}: Readonly<{ scenario: ScenarioListItem; onReviewed: (report: ReviewReport) => void }>) {
  const [pending, setPending] = useState<SecurityReviewAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonsId = useId();
  const actions = allowedActions(scenario.reviewState);
  const blocked = actions.flatMap((action) => {
    const reason = actionBlockedReason(scenario.flags, action);
    return reason ? [{ action, reason }] : [];
  });

  async function perform(action: SecurityReviewAction, reason?: string) {
    setPending(null);
    setBusy(true);
    setError(null);
    const result = await reviewScenarios({
      action,
      items: [{ id: scenario.id, version: scenario.currentVersion }],
      ...(reason !== undefined ? { reason } : {}),
      ...(action === "approve" && scenario.destructive ? { destructiveConfirmations: [scenario.id] } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onReviewed({ action, applied: result.data.applied, refused: result.data.refused, titles: { [scenario.id]: scenario.title } });
  }

  function choose(action: SecurityReviewAction) {
    if (action === "reject" || (action === "approve" && scenario.destructive)) setPending(action);
    else void perform(action);
  }

  const operation = splitOperationKey(scenario.operationKey);

  return (
    <div className="space-y-2" data-testid="scenario-review-actions">
      <div role="group" aria-label="Review actions" className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const reason = actionBlockedReason(scenario.flags, action);
          return (
            <button
              key={action}
              type="button"
              onClick={() => choose(action)}
              disabled={busy || reason !== undefined}
              aria-describedby={reason ? reasonsId : undefined}
              className={action === "approve" ? BUTTON_STYLES.primary : BUTTON_STYLES.secondary}
            >
              {ACTION_LABEL[action]}
            </button>
          );
        })}
      </div>
      {blocked.length > 0 && (
        <ul id={reasonsId} className="list-disc pl-5 text-xs text-text-secondary" data-testid="review-action-reasons">
          {blocked.map(({ action, reason }) => (
            <li key={action}>
              {ACTION_LABEL[action]} is unavailable: {reason}
            </li>
          ))}
        </ul>
      )}
      {error && <ErrorState testId="review-action-error" message="The review action was not applied" detail={error} />}

      {pending === "reject" && (
        <ConfirmDialog
          message={`Reject "${scenario.title}"?`}
          affectedCount={1}
          requireReason
          reasonLabel="Reason for rejecting (required)"
          confirmLabel="Reject"
          onConfirm={(reason) => void perform("reject", reason?.trim())}
          onCancel={() => setPending(null)}
        />
      )}
      {pending === "approve" && (
        <ConfirmDialog
          message={`Approve the destructive scenario "${scenario.title}"?`}
          affectedCount={1}
          confirmLabel="Approve destructive scenario"
          details={
            <p className="text-sm text-text-secondary">
              It runs against <span className="font-mono text-xs">{operation.method} {operation.path}</span> and may change or delete data on the target. Approving it confirms that, by name.
            </p>
          }
          onConfirm={() => void perform("approve")}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
