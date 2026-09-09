import { useState } from "react";
import type {
  ReviewUpdateRequest,
  TestGenerationWorkflow,
} from "@apipilot/shared-domain";
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
import { AiEnhancementOutcomeSummary } from "./AiEnhancementOutcomeSummary";
import { TestScenarioReviewList } from "./TestScenarioReviewList";
import { TestScenarioReviewSummary } from "./TestScenarioReviewSummary";
import { TestScenarioReviewDetail } from "./TestScenarioReviewDetail";
import { TestScenarioReviewDecision } from "./TestScenarioReviewDecision";
import { TestScenarioReviewRefinement } from "./TestScenarioReviewRefinement";
import { ConfirmDialog } from "./ConfirmDialog";
import { BUTTON_STYLES } from "./controlStyles";

/**
 * Wraps AP-006's existing review components, driven by the workflow-scoped client instead of
 * the stateless `/api/test-models/reviews*` endpoints (research.md D9), plus the new explicit
 * "Finalize Review" gate this feature adds (research.md D6).
 */
export function ScenarioReviewStage({
  workflow,
  onAdvanced,
}: Readonly<{
  workflow: TestGenerationWorkflow;
  onAdvanced: (result: WorkflowResult) => void;
}>) {
  const reviewWorkspace = workflow.reviewWorkspace as unknown as ReviewWorkspaceWire;
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [submittingScenarioId, setSubmittingScenarioId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [confirmingFinalize, setConfirmingFinalize] = useState(false);
  const bulkDecision = useBulkDecision();

  function applyResult(
    scenarioId: string,
    result: ScenarioActionResult | ScenarioDecisionOutcomeResult,
  ) {
    setSubmittingScenarioId(null);
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    const outcome =
      "outcome" in result
        ? result.outcome
        : result.outcomes?.find((o) => o.scenarioId === scenarioId);
    if (outcome && !outcome.applied) {
      setActionError(outcome.finding?.message ?? "The request could not be applied.");
    } else {
      setActionError(null);
      onAdvanced({ ok: true, workflow: result.workflow });
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

  async function handleEdit(
    item: ReviewScenarioWire,
    edit: Parameters<typeof editScenario>[2],
  ) {
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
  async function handleBulkDecision(
    items: ReviewScenarioWire[],
    action: "accept" | "reject",
    reason?: string,
  ) {
    const byId = new Map(items.map((item) => [item.scenarioId, item]));
    let latestWorkflow: TestGenerationWorkflow | null = null;
    await bulkDecision.run(
      items.map((item) => item.scenarioId),
      async (chunkIds): Promise<BulkChunkResult> => {
        const updates: ReviewUpdateRequest[] = chunkIds.map((scenarioId) => {
          const item = byId.get(scenarioId)!;
          return {
            scenarioId,
            revision: item.revision,
            action,
            ...(reason ? { reason } : {}),
          };
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

  // Finalize only ever projects `accepted` scenarios forward (data-model.md); every pending
  // scenario is silently excluded. Confirming first, when any remain pending, keeps that
  // exclusion from being a surprise once the pending count is large (FR-011 companion UX).
  function handleFinalizeClick() {
    setFinalizeError(null);
    if (reviewWorkspace.summary.pending > 0) {
      setConfirmingFinalize(true);
      return;
    }
    void handleFinalize();
  }

  const noAcceptedScenarios = reviewWorkspace.summary.accepted === 0;

  return (
    <section
      data-testid="scenario-review-stage"
      className="space-y-4 rounded-md border border-border bg-surface p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-slate-900">
        Review Generated Scenarios
      </h2>
      <TestScenarioReviewSummary summary={reviewWorkspace.summary} />
      <AiEnhancementOutcomeSummary workflow={workflow} />
      <TestScenarioReviewList
        scenarios={reviewWorkspace.scenarios}
        selectedScenarioId={selectedScenarioId}
        onSelect={(item) => {
          setSelectedScenarioId(item.scenarioId);
          setActionError(null);
        }}
        onBulkDecision={handleBulkDecision}
        renderSelected={(item) => (
          <div
            className="space-y-4 border-2 border-brand-200 bg-brand-50/40 p-4"
            aria-label="Selected scenario review"
            data-testid="selected-scenario-panel"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                  Selected scenario
                </p>
                <p className="text-sm text-slate-600">
                  Review the request and decide before continuing.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedScenarioId(null)}
                className="rounded-md border border-border bg-surface px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                Close details
              </button>
            </div>
            <TestScenarioReviewDetail item={item} />
            <TestScenarioReviewDecision
              item={item}
              submitting={submittingScenarioId === item.scenarioId}
              error={actionError ?? undefined}
              onAccept={() => handleAccept(item)}
              onReject={(reason) => handleReject(item, reason)}
            />
            <TestScenarioReviewRefinement
              item={item}
              submitting={submittingScenarioId === item.scenarioId}
              error={actionError ?? undefined}
              onEdit={(edit) => handleEdit(item, edit)}
              onRegenerate={() => handleRegenerate(item)}
            />
          </div>
        )}
      />
      {bulkDecision.status === "running" && (
        <output
          data-testid="scenario-bulk-progress"
          className="block w-full rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700"
        >
          Applying decisions: {bulkDecision.processed} of {bulkDecision.total} complete…
        </output>
      )}
      {bulkDecision.status === "done" && (
        <output
          data-testid="scenario-bulk-summary"
          className="block w-full rounded-md border border-border bg-slate-50 px-3 py-3 text-sm text-slate-700"
        >
          <p className="font-semibold text-slate-900">Bulk review complete</p>
          <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
            <div>
              <dt className="inline text-muted">Accepted or rejected: </dt>
              <dd className="inline font-medium text-success-700">
                {bulkDecision.succeeded}
              </dd>
            </div>
            <div>
              <dt className="inline text-muted">Failed: </dt>
              <dd
                className={
                  bulkDecision.failed.length > 0
                    ? "inline font-medium text-danger-700"
                    : "inline font-medium text-slate-700"
                }
              >
                {bulkDecision.failed.length}
              </dd>
            </div>
          </dl>
          {bulkDecision.failed.length > 0 && (
            <div className="mt-2 rounded-md border border-danger-200 bg-danger-50 p-2 text-danger-800">
              <p className="font-medium">Items needing attention</p>
              <ul className="mt-1 ml-4 list-disc">
                {bulkDecision.failed.map((failure) => (
                  <li key={failure.id}>
                    {failure.id}: {failure.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </output>
      )}
      {/* Sticky rather than in normal flow: with hundreds of scenarios to review, the finalize
          action must stay reachable without scrolling past the entire list (matches the
          sticky app header pattern in App.tsx). Negative margins extend it to the section's
          full padded width so the opaque background fully covers scrolled-past content. */}
      <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center gap-3 rounded-b-md border-t border-border bg-surface px-5 pt-4 pb-5 shadow-[0_-4px_6px_-4px_rgba(0,0,0,0.15)]">
        <button
          type="button"
          onClick={handleFinalizeClick}
          disabled={finalizing}
          className={BUTTON_STYLES.primary}
        >
          {finalizing ? "Finalizing…" : "Finalize Review"}
        </button>
        {finalizing && (
          <p data-testid="finalize-in-progress" className="text-sm text-muted">
            Running dependency analysis with the local AI model — this can take a couple
            of minutes.
          </p>
        )}
        {finalizeError && (
          <p
            role="alert"
            data-testid="finalize-error"
            className="text-sm font-medium text-danger-700"
          >
            {finalizeError}
          </p>
        )}
      </div>
      {confirmingFinalize && (
        <ConfirmDialog
          message={`${reviewWorkspace.summary.pending} scenario${reviewWorkspace.summary.pending === 1 ? " has" : "s have"} no decision and will be excluded — finalize anyway?`}
          affectedCount={reviewWorkspace.summary.pending}
          confirmLabel="Finalize anyway"
          errorOnlyMessage={
            noAcceptedScenarios
              ? "Accept at least one scenario before finalizing the review. Rejected scenarios will not be included."
              : undefined
          }
          onConfirm={() => {
            setConfirmingFinalize(false);
            void handleFinalize();
          }}
          onCancel={() => setConfirmingFinalize(false)}
        />
      )}
    </section>
  );
}
