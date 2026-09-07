import { useState } from "react";
import type { ReviewScenarioWire } from "../services/reviewsClient";
import { BUTTON_STYLES } from "./controlStyles";

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
      className="space-y-3 rounded-md border border-border bg-surface p-3"
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
        <div className="flex flex-col gap-1">
          <label
            htmlFor="review-rejection-reason"
            className="text-xs font-medium text-slate-700"
          >
            Rejection reason
          </label>
          <input
            id="review-rejection-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting || !isPending}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-50"
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
      {error && (
        <p
          role="alert"
          data-testid="review-decision-error"
          className="text-sm font-medium text-danger-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}
