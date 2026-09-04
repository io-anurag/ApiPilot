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
    <section data-testid="api-review-stage">
      <h2>Review Discovered APIs</h2>
      <AnalysisSummary summary={apiModel.summary} />
      <OperationList operations={apiModel.operations} onSelect={setSelected} />
      {selected && <OperationDetail operation={selected} />}
      <div>
        <button type="button" onClick={handleContinue} disabled={continuing}>
          {continuing ? "Continuing…" : "Continue"}
        </button>
        {error && (
          <p role="alert" data-testid="api-review-error">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
