import { useState } from "react";
import type { ApiModel, ApiOperation } from "@apipilot/shared-domain";
import { AnalysisSummary } from "./AnalysisSummary";
import { OperationDetail } from "./OperationDetail";
import { OperationList } from "./OperationList";
import { continueApiReview, type WorkflowResult } from "../services/testGenerationWorkflowClient";

/**
 * The apiReview confirmation gate (research.md D3): there is no selectable data here, only an
 * explicit "Continue" action over the existing analysis display (AP-002 components, unmodified).
 */
export function ApiReviewStage({
  apiModel,
  onAdvanced,
}: {
  apiModel: ApiModel;
  onAdvanced: (result: WorkflowResult) => void;
}) {
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
    <section data-testid="api-review-stage" className="space-y-4 rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Review Discovered APIs</h2>
      <AnalysisSummary summary={apiModel.summary} />
      <OperationList operations={apiModel.operations} onSelect={setSelected} />
      {selected && <OperationDetail operation={selected} />}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleContinue}
          disabled={continuing}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {continuing ? "Continuing…" : "Continue"}
        </button>
        {error && (
          <p role="alert" data-testid="api-review-error" className="text-sm font-medium text-danger-700">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
