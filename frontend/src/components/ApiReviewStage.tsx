import { useState } from "react";
import type { ApiModel, ApiOperation } from "@apipilot/shared-domain";
import { AnalysisSummary } from "./AnalysisSummary";
import { ErrorState } from "./ErrorState";
import { OperationDetail } from "./OperationDetail";
import { OperationList } from "./OperationList";
import { SummaryPanel } from "./SummaryPanel";
import { BUTTON_STYLES } from "./controlStyles";
import {
  continueApiReview,
  type WorkflowResult,
} from "../services/testGenerationWorkflowClient";
import { groupOperationsByMethod } from "../utils/operationMethodGroups";

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
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start"
    >
      <div className="min-w-0 space-y-4 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Review Discovered APIs</h2>
        <AnalysisSummary summary={apiModel.summary} />
        <OperationList
          operations={apiModel.operations}
          selected={selected}
          onSelect={setSelected}
          renderSelected={(operation) => (
            <div className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
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
        {error && <ErrorState testId="api-review-error" message={error} />}
      </div>
      <SummaryPanel
        testId="api-review-summary-panel"
        statValue={apiModel.operations.length}
        statLabel={`operation${apiModel.operations.length === 1 ? "" : "s"} discovered`}
        segments={groupOperationsByMethod(apiModel.operations)}
        description="Every discovered operation keeps its declared parameters, security, and responses for review below."
        action={
          !readOnly
            ? { label: continuing ? "Continuing…" : "Continue", onClick: handleContinue, disabled: continuing }
            : undefined
        }
      />
    </section>
  );
}
