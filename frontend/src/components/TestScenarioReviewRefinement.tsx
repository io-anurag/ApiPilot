import { useState } from "react";
import type { ReviewEditContent } from "@apipilot/shared-domain";
import type { ReviewScenarioWire } from "../services/reviewsClient";

/** Edit and AI-regeneration controls for AI-derived and user-modified scenarios (US3, FR-011-FR-016). */
export function TestScenarioReviewRefinement({
  item,
  submitting,
  error,
  onEdit,
  onRegenerate,
}: {
  item: ReviewScenarioWire;
  submitting: boolean;
  error?: string;
  onEdit: (edit: ReviewEditContent) => void;
  onRegenerate: () => void;
}) {
  const [body, setBody] = useState(
    JSON.stringify(item.scenario.request.body ?? {}, null, 2),
  );
  const [bodyError, setBodyError] = useState<string | null>(null);
  const canRegenerate = item.scenario.provenance.source === "AI";

  function handleSubmitEdit() {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      setBodyError("Request body must be valid JSON.");
      return;
    }
    setBodyError(null);
    onEdit({
      request: { ...item.scenario.request, body: parsedBody },
      assertions: item.scenario.assertions,
      targetLocation: item.scenario.targetLocation,
      targetField: item.scenario.targetField,
    });
  }

  return (
    <div data-testid="review-scenario-refinement" className="space-y-2 border-t border-border pt-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="review-edit-body" className="text-xs font-medium text-muted">
          Request body
        </label>
        <textarea
          id="review-edit-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={submitting}
          rows={6}
          className="w-full rounded-md border border-border bg-surface p-2 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
        />
      </div>
      {bodyError && (
        <p role="alert" data-testid="review-edit-body-error" className="text-sm font-medium text-danger-700">
          {bodyError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSubmitEdit}
          disabled={submitting}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save edit
        </button>

        <button
          type="button"
          onClick={onRegenerate}
          disabled={submitting || !canRegenerate}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Regenerate with AI
        </button>
        {!canRegenerate && (
          <p data-testid="review-regenerate-unavailable" className="text-sm text-muted">
            Only AI-suggested scenarios can be regenerated.
          </p>
        )}
      </div>

      {error && (
        <p role="alert" data-testid="review-refinement-error" className="text-sm font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
}
