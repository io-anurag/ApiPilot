import { useState } from "react";
import type { DependencyAnalysisResult, IntegrationWorkflow, WorkflowReviewDecision } from "@apipilot/shared-domain";
import {
  continueWorkflowReview,
  recordWorkflowDecisions,
  type WorkflowResult,
} from "../services/testGenerationWorkflowClient";

function workflowSummary(workflow: IntegrationWorkflow, graph: DependencyAnalysisResult["graph"]) {
  return workflow.steps.map((step) => {
    const relationship = graph.relationships.find((r) =>
      workflow.relationshipIds.includes(r.id) &&
      r.consumer.operationPath === step.operationPath &&
      r.consumer.operationMethod === step.operationMethod,
    );
    return { step, relationship };
  });
}

/**
 * Lists discovered IntegrationWorkflows (AP-008) with approve/reject controls. There is no
 * edit/regenerate concept for workflows (research.md D5); approved workflows are retained for
 * traceability but never rendered into the Postman artifact (research.md D2).
 */
export function WorkflowReviewStage({
  dependencyAnalysis,
  decisions,
  onAdvanced,
}: {
  dependencyAnalysis: DependencyAnalysisResult;
  decisions: Record<string, WorkflowReviewDecision> | undefined;
  onAdvanced: (result: WorkflowResult) => void;
}) {
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);

  async function decide(workflowId: string, state: "approved" | "rejected") {
    setSubmittingId(workflowId);
    setError(null);
    const result = await recordWorkflowDecisions([{ workflowId, state }]);
    setSubmittingId(null);
    if (!result.ok) setError(result.message);
  }

  async function handleContinue() {
    setContinuing(true);
    setError(null);
    const result = await continueWorkflowReview();
    setContinuing(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onAdvanced(result);
  }

  if (dependencyAnalysis.workflows.length === 0) {
    return (
      <section data-testid="workflow-review-stage">
        <h2>Review Integration Workflows</h2>
        <p data-testid="workflow-review-empty">No integration workflows were discovered.</p>
        <button type="button" onClick={handleContinue} disabled={continuing}>
          Continue
        </button>
        {error && <p role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <section data-testid="workflow-review-stage">
      <h2>Review Integration Workflows</h2>
      <ul>
        {dependencyAnalysis.workflows.map((workflow) => {
          const state = decisions?.[workflow.id]?.state ?? "pending";
          return (
            <li key={workflow.id} data-testid={`workflow-review-item-${workflow.id}`}>
              <ol>
                {workflowSummary(workflow, dependencyAnalysis.graph).map(({ step, relationship }) => (
                  <li key={`${workflow.id}-${step.position}`}>
                    {step.operationMethod} {step.operationPath}
                    {relationship && <span> — {relationship.explanation}</span>}
                  </li>
                ))}
              </ol>
              <span data-testid={`workflow-review-state-${workflow.id}`}>{state}</span>
              <button
                type="button"
                onClick={() => decide(workflow.id, "approved")}
                disabled={submittingId === workflow.id}
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => decide(workflow.id, "rejected")}
                disabled={submittingId === workflow.id}
              >
                Reject
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={handleContinue} disabled={continuing}>
        {continuing ? "Continuing…" : "Continue"}
      </button>
      {error && (
        <p role="alert" data-testid="workflow-review-error">
          {error}
        </p>
      )}
    </section>
  );
}
