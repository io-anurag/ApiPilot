import { useState } from "react";
import type { ReviewUpdateRequest, TestGenerationWorkflow } from "@apipilot/shared-domain";
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
import { useBulkDecision, type BulkChunkResult } from "../hooks/useBulkDecision";
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
  const bulkDecision = useBulkDecision();

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

  /**
   * Bulk accept/reject over the filtered/selected set (FR-004, FR-005, FR-007, FR-010, FR-011):
   * submits the array-accepting `applyScenarioDecisions` endpoint (research.md D2) in ordered
   * chunks via `useBulkDecision` (research.md D5), aggregating its per-item `ReviewUpdateOutcome`
   * into a succeeded/failed summary (FR-012, research.md D3) without touching the single-scenario
   * handlers above (FR-006).
   */
  async function handleBulkDecision(items: ReviewScenarioWire[], action: "accept" | "reject", reason?: string) {
    const byId = new Map(items.map((item) => [item.scenarioId, item]));
    let latestWorkflow: TestGenerationWorkflow | null = null;
    await bulkDecision.run(
      items.map((item) => item.scenarioId),
      async (chunkIds): Promise<BulkChunkResult> => {
        const updates: ReviewUpdateRequest[] = chunkIds.map((scenarioId) => {
          const item = byId.get(scenarioId)!;
          return { scenarioId, revision: item.revision, action, ...(reason ? { reason } : {}) };
        });
        const result = await applyScenarioDecisions(updates);
        if (!result.ok) {
          return { ok: false, message: result.message };
        }
        latestWorkflow = result.workflow;
        return {
          ok: true,
          perItem: result.outcomes.map((outcome) => ({
            id: outcome.scenarioId,
            applied: outcome.applied,
            message: outcome.finding?.message,
          })),
        };
      },
    );
    // Reflect the applied decisions in the visible list/summary (each chunk already returns the
    // freshly updated workflow — the single-scenario handlers above are left untouched, FR-006).
    if (latestWorkflow) onAdvanced({ ok: true, workflow: latestWorkflow });
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
    <section data-testid="scenario-review-stage" className="space-y-4 rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Review Generated Scenarios</h2>
      <TestScenarioReviewSummary summary={reviewWorkspace.summary} />
      <TestScenarioReviewList
        scenarios={reviewWorkspace.scenarios}
        selectedScenarioId={selectedScenarioId}
        onSelect={(item) => {
          setSelectedScenarioId(item.scenarioId);
          setActionError(null);
        }}
        onBulkDecision={handleBulkDecision}
      />
      {bulkDecision.status === "running" && (
        <p role="status" data-testid="scenario-bulk-progress" className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700">
          Applying to {bulkDecision.processed} of {bulkDecision.total}…
        </p>
      )}
      {bulkDecision.status === "done" && (
        <div role="status" data-testid="scenario-bulk-summary" className="rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <p>
            <span className="font-medium text-success-700">{bulkDecision.succeeded} succeeded</span>,{" "}
            <span className={bulkDecision.failed.length > 0 ? "font-medium text-danger-700" : ""}>
              {bulkDecision.failed.length} failed
            </span>
            .
          </p>
          {bulkDecision.failed.length > 0 && (
            <ul className="mt-1 ml-4 list-disc">
              {bulkDecision.failed.map((failure) => (
                <li key={failure.id}>
                  {failure.id}: {failure.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {selected && (
        <div className="space-y-4 border-t border-border pt-4">
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
        </div>
      )}
      <div className="flex items-center gap-3 border-t border-border pt-4">
        <button
          type="button"
          onClick={handleFinalize}
          disabled={finalizing}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {finalizing ? "Finalizing…" : "Finalize Review"}
        </button>
        {finalizeError && (
          <p role="alert" data-testid="finalize-error" className="text-sm font-medium text-danger-700">
            {finalizeError}
          </p>
        )}
      </div>
    </section>
  );
}
