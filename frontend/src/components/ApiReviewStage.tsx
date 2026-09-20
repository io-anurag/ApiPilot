import { useState } from "react";
import type { ApiModel, ApiOperation } from "@apipilot/shared-domain";
import { AnalysisSummary } from "./AnalysisSummary";
import { ErrorState } from "./ErrorState";
import { OperationDetail } from "./OperationDetail";
import { OperationList } from "./OperationList";
import { BUTTON_STYLES } from "./controlStyles";
import {
  continueApiReview,
  type WorkflowResult,
} from "../services/testGenerationWorkflowClient";

/**
 * The apiReview confirmation gate (research.md D3): there is no selectable data here, only an
 * explicit "Continue" action over the existing analysis display (AP-002 components, unmodified).
 *
 * `readOnly` renders the same analysis display without the "Continue" action, for a QA engineer
 * looking back at an already-completed apiReview stage (research.md D3 addendum) — nothing here
 * can be redone since the stage carries no revisable decision.
 */
export function ApiReviewStage({
  apiModel,
  onAdvanced,
  readOnly = false,
}: Readonly<{
  apiModel: ApiModel;
  onAdvanced: (result: WorkflowResult) => void;
  readOnly?: boolean;
}>) {
  const [selected, setSelected] = useState<ApiOperation | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setContinuing(true);
    setError(null);
    const result = await continueApiReview();
    setContinuing(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onAdvanced(result);
  }

  return (
    <section
      data-testid="api-review-stage"
      className="space-y-4 rounded-lg border border-border bg-surface p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-slate-900">Review Discovered APIs</h2>
      <AnalysisSummary summary={apiModel.summary} />
      <OperationList
        operations={apiModel.operations}
        selected={selected}
        onSelect={setSelected}
        renderSelected={(operation) => (
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                Operation details
              </p>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className={BUTTON_STYLES.secondary}
              >
                Close details
              </button>
            </div>
            <OperationDetail operation={operation} />
          </div>
        )}
      />
      {!readOnly && (
        // Sticky rather than in normal flow: with dozens of discovered operations to review, the
        // continue action must stay reachable without scrolling past the entire list (matches
        // the same fix applied to ScenarioReviewStage's "Finalize Review" bar).
        <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center gap-3 rounded-b-lg border-t border-border bg-surface px-5 pt-4 pb-5 shadow-[0_-4px_6px_-4px_rgba(0,0,0,0.15)]">
          <button
            type="button"
            onClick={handleContinue}
            disabled={continuing}
            className={BUTTON_STYLES.primary}
          >
            {continuing ? "Continuing…" : "Continue"}
          </button>
          {error && <ErrorState testId="api-review-error" message={error} />}
        </div>
      )}
    </section>
  );
}
