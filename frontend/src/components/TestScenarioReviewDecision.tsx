import { useState } from "react";
import type { ReviewScenarioWire } from "../services/reviewsClient";
import { BUTTON_STYLES, FIELD_STYLES } from "./controlStyles";
import { ErrorState } from "./ErrorState";

/** Accept/reject controls with required rejection feedback and failure recovery (US2, FR-006-FR-010). */
export function TestScenarioReviewDecision({
  item,
  submitting,
  error,
  onAccept,
  onReject,
}: Readonly<{
  item: ReviewScenarioWire;
  submitting: boolean;
  error?: string;
  onAccept: () => void;
  onReject: (reason: string) => void;
}>) {
  const [reason, setReason] = useState("");
  const isPending = item.state === "pending";

  function handleReject() {
    onReject(reason);
  }

  return (
    <div
      data-testid="review-scenario-decision"
      className="space-y-3 rounded-xl border border-border bg-surface p-3.5"
    >
      {!isPending && (
        <p data-testid="review-decision-state" className="text-sm text-muted">
          This scenario is already {item.state}.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          onClick={onAccept}
          disabled={submitting || !isPending}
          className={BUTTON_STYLES.success}
        >
          Accept
        </button>
        <div className="flex min-w-0 flex-col gap-1">
          <label
            htmlFor="review-rejection-reason"
            className="text-xs font-medium text-text-secondary"
          >
            Rejection reason
          </label>
          <input
            id="review-rejection-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting || !isPending}
            className={FIELD_STYLES}
          />
        </div>
        <button
          type="button"
          onClick={handleReject}
          disabled={submitting || !isPending || reason.trim().length === 0}
          className={BUTTON_STYLES.danger}
        >
          Reject
        </button>
      </div>
      {error && <ErrorState testId="review-decision-error" message={error} />}
    </div>
  );
}
