import { useState } from "react";
import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import type { ReviewScenarioWire, ReviewWorkspaceWire } from "../services/reviewsClient";
import {
  applyScenarioDecisions,
  editScenario,
  finalizeScenarioReview,
  regenerateScenario,
  type ScenarioActionResult,
  type ScenarioDecisionOutcomeResult,
  type WorkflowResult,
} from "../services/testGenerationWorkflowClient";
import { TestScenarioReviewList } from "./TestScenarioReviewList";
import { TestScenarioReviewSummary } from "./TestScenarioReviewSummary";
import { TestScenarioReviewDetail } from "./TestScenarioReviewDetail";
import { TestScenarioReviewDecision } from "./TestScenarioReviewDecision";
import { TestScenarioReviewRefinement } from "./TestScenarioReviewRefinement";

/**
 * Wraps AP-006's existing review components, driven by the workflow-scoped client instead of
 * the stateless `/api/test-models/reviews*` endpoints (research.md D9), plus the new explicit
 * "Finalize Review" gate this feature adds (research.md D6).
 */
export function ScenarioReviewStage({
  workflow,
  onAdvanced,
}: {
  workflow: TestGenerationWorkflow;
  onAdvanced: (result: WorkflowResult) => void;
}) {
  const reviewWorkspace = workflow.reviewWorkspace as unknown as ReviewWorkspaceWire;
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [submittingScenarioId, setSubmittingScenarioId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  const selected: ReviewScenarioWire | null =
    reviewWorkspace.scenarios.find((s) => s.scenarioId === selectedScenarioId) ?? null;

  function applyResult(scenarioId: string, result: ScenarioActionResult | ScenarioDecisionOutcomeResult) {
    setSubmittingScenarioId(null);
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    const outcome = "outcome" in result ? result.outcome : result.outcomes?.find((o) => o.scenarioId === scenarioId);
    if (outcome && !outcome.applied) {
      setActionError(outcome.finding?.message ?? "The request could not be applied.");
    } else {
      setActionError(null);
    }
  }

  async function handleAccept(item: ReviewScenarioWire) {
    setSubmittingScenarioId(item.scenarioId);
    setActionError(null);
    const result = await applyScenarioDecisions([
      { scenarioId: item.scenarioId, revision: item.revision, action: "accept" },
    ]);
    applyResult(item.scenarioId, result);
  }

  async function handleReject(item: ReviewScenarioWire, reason: string) {
    setSubmittingScenarioId(item.scenarioId);
    setActionError(null);
    const result = await applyScenarioDecisions([
      { scenarioId: item.scenarioId, revision: item.revision, action: "reject", reason },
    ]);
    applyResult(item.scenarioId, result);
  }

  async function handleEdit(item: ReviewScenarioWire, edit: Parameters<typeof editScenario>[2]) {
    setSubmittingScenarioId(item.scenarioId);
    setActionError(null);
    const result = await editScenario(item.scenarioId, item.revision, edit);
    applyResult(item.scenarioId, result);
  }

  async function handleRegenerate(item: ReviewScenarioWire) {
    setSubmittingScenarioId(item.scenarioId);
    setActionError(null);
    const result = await regenerateScenario(item.scenarioId, item.revision);
    applyResult(item.scenarioId, result);
  }

  async function handleFinalize() {
    setFinalizing(true);
    setFinalizeError(null);
    const result = await finalizeScenarioReview();
    setFinalizing(false);
    if (!result.ok) {
      setFinalizeError(result.message);
      return;
    }
    onAdvanced(result);
  }

  return (
    <section data-testid="scenario-review-stage">
      <h2>Review Generated Scenarios</h2>
      <TestScenarioReviewSummary summary={reviewWorkspace.summary} />
      <TestScenarioReviewList
        scenarios={reviewWorkspace.scenarios}
        selectedScenarioId={selectedScenarioId}
        onSelect={(item) => {
          setSelectedScenarioId(item.scenarioId);
          setActionError(null);
        }}
      />
      {selected && (
        <>
          <TestScenarioReviewDetail item={selected} />
          <TestScenarioReviewDecision
            item={selected}
            submitting={submittingScenarioId === selected.scenarioId}
            error={actionError ?? undefined}
            onAccept={() => handleAccept(selected)}
            onReject={(reason) => handleReject(selected, reason)}
          />
          <TestScenarioReviewRefinement
            item={selected}
            submitting={submittingScenarioId === selected.scenarioId}
            error={actionError ?? undefined}
            onEdit={(edit) => handleEdit(selected, edit)}
            onRegenerate={() => handleRegenerate(selected)}
          />
        </>
      )}
      <div>
        <button type="button" onClick={handleFinalize} disabled={finalizing}>
          {finalizing ? "Finalizing…" : "Finalize Review"}
        </button>
        {finalizeError && (
          <p role="alert" data-testid="finalize-error">
            {finalizeError}
          </p>
        )}
      </div>
    </section>
  );
}
