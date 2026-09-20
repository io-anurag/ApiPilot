import { useEffect, useRef, useState } from "react";
import type {
  DependencyAnalysisResult,
  DependencyConfidence,
  IntegrationWorkflow,
  TestGenerationWorkflow,
  WorkflowReviewDecision,
  WorkflowReviewState,
} from "@apipilot/shared-domain";
import {
  continueWorkflowReview,
  recordWorkflowDecisions,
  type WorkflowResult,
} from "../services/testGenerationWorkflowClient";
import { useBulkDecision, type BulkChunkResult } from "../hooks/useBulkDecision";
import { ConfirmDialog } from "./ConfirmDialog";
import { ErrorState } from "./ErrorState";
import { HttpMethodBadge } from "./HttpMethodBadge";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import { BUTTON_STYLES } from "./controlStyles";

function workflowSummary(
  workflow: IntegrationWorkflow,
  graph: DependencyAnalysisResult["graph"],
) {
  return workflow.steps.map((step) => {
    const relationship = graph.relationships.find(
      (r) =>
        workflow.relationshipIds.includes(r.id) &&
        r.consumer.operationPath === step.operationPath &&
        r.consumer.operationMethod === step.operationMethod,
    );
    return { step, relationship };
  });
}

const STATE_LABELS: Record<WorkflowReviewState, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};

const STATE_TONES: Record<WorkflowReviewState, StatusTone> = {
  pending: "neutral",
  approved: "success",
  rejected: "danger",
};

/** Card background tint per decision, mirroring TestScenarioReviewList's row tint — in addition
 * to the StatusBadge text, never in place of it, so an approved/rejected workflow is scannable
 * across the whole list rather than only legible one card at a time. */
const STATE_CARD_TONE_CLASSES: Record<WorkflowReviewState, string> = {
  pending: "",
  approved: "bg-success-50",
  rejected: "bg-danger-50",
};

const CONFIDENCE_LABELS: Record<DependencyConfidence, string> = {
  CONFIRMED: "Confirmed",
  LIKELY: "Likely",
  POSSIBLE: "Possible",
};

const CONFIDENCE_TONES: Record<DependencyConfidence, StatusTone> = {
  CONFIRMED: "success",
  LIKELY: "info",
  POSSIBLE: "warning",
};

type PendingBulkDecision = { state: "approved" | "rejected"; workflowIds: string[] };

/**
 * Lists discovered IntegrationWorkflows (AP-008) with approve/reject controls. There is no
 * edit/regenerate concept for workflows (AP-009 research.md D5). Approving a workflow renders it
 * as an ordered Postman request sequence with the detected data hand-offs wired between steps;
 * rejecting it omits that sequence from the export, and its steps instead render as standalone or
 * automatically-chained requests (AP-016 workflow-aware-postman; AP-009's original D2, which
 * deferred this rendering entirely, is superseded — see AP-009 research.md D2's own note).
 */
export function WorkflowReviewStage({
  dependencyAnalysis,
  decisions,
  onAdvanced,
  isActiveStage = true,
}: Readonly<{
  dependencyAnalysis: DependencyAnalysisResult;
  decisions: Record<string, WorkflowReviewDecision> | undefined;
  onAdvanced: (result: WorkflowResult) => void;
  /**
   * False while merely revisiting an already-completed workflowReview (the real active stage is
   * further ahead) — Approve/Reject remain live even then, since changing a decision legitimately
   * reopens the stage server-side (`reopenIfComplete`, workflowReviewStage.ts), but "Continue"
   * would otherwise fail with `stage_not_active` the instant it's clicked without a prior decision
   * change, since the server has nothing to advance from here yet.
   */
  isActiveStage?: boolean;
}>) {
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [manualSelectionIds, setManualSelectionIds] = useState<Set<string>>(new Set());
  const [pendingBulk, setPendingBulk] = useState<PendingBulkDecision | null>(null);
  const bulkDecision = useBulkDecision();
  const selectAllRef = useRef<HTMLInputElement>(null);
  const allWorkflowIds = dependencyAnalysis.workflows.map((w) => w.id);
  const allSelected =
    allWorkflowIds.length > 0 && manualSelectionIds.size === allWorkflowIds.length;

  // Reflects "some but not all selected" on the native checkbox — a state React's `checked`
  // prop cannot express and that must be set imperatively on the DOM node.
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = !allSelected && manualSelectionIds.size > 0;
    }
  }, [allSelected, manualSelectionIds]);

  function toggleSelectAll() {
    setManualSelectionIds(allSelected ? new Set() : new Set(allWorkflowIds));
  }

  async function decide(workflowId: string, state: "approved" | "rejected") {
    setSubmittingId(workflowId);
    setError(null);
    const result = await recordWorkflowDecisions([{ workflowId, state }]);
    setSubmittingId(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onAdvanced(result);
  }

  function toggleManualSelection(workflowId: string) {
    setManualSelectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(workflowId)) {
        next.delete(workflowId);
      } else {
        next.add(workflowId);
      }
      return next;
    });
  }

  /**
   * Bulk approve/reject over the manually selected workflows (FR-008, FR-010, FR-011): submits
   * the array-accepting `recordWorkflowDecisions` endpoint (research.md D2) in ordered chunks via
   * `useBulkDecision` (research.md D5). That endpoint is atomic per call (research.md D4), so each
   * chunk counts as wholly succeeded or wholly failed (FR-012) — never a per-item outcome, since
   * `WorkflowReviewDecision` carries no revision/staleness concept the way scenario decisions do.
   */
  async function handleConfirmBulk() {
    if (!pendingBulk) return;
    const { state, workflowIds } = pendingBulk;
    setPendingBulk(null);
    setManualSelectionIds(new Set());
    let latestWorkflow: TestGenerationWorkflow | null = null;
    await bulkDecision.run(workflowIds, async (chunkIds): Promise<BulkChunkResult> => {
      const result = await recordWorkflowDecisions(
        chunkIds.map((workflowId) => ({ workflowId, state })),
      );
      if (!result.ok) return { ok: false, message: result.message };
      latestWorkflow = result.workflow;
      return { ok: true };
    });
    // Reflect the applied decisions in the visible per-workflow state (each successful chunk
    // already returns the freshly updated workflow — the single-workflow decide() above is left
    // untouched, FR-009).
    if (latestWorkflow) onAdvanced({ ok: true, workflow: latestWorkflow });
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
      <section
        data-testid="workflow-review-stage"
        className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm"
      >
        <h2 className="text-base font-semibold text-slate-900">
          Review Integration Workflows
        </h2>
        <p className="text-sm text-muted">
          This analyzes multi-step call chains (e.g. create then reference by ID) across the
          operations you accepted a scenario for in the previous stage — a workflow describes how
          those operations relate, not which test scenarios exist.
        </p>
        <p data-testid="workflow-review-empty" className="text-sm text-muted">
          No integration workflows were discovered.
        </p>
        {isActiveStage && (
          <button
            type="button"
            onClick={handleContinue}
            disabled={continuing}
            className={BUTTON_STYLES.primary}
          >
            Continue
          </button>
        )}
        {error && <ErrorState message={error} />}
      </section>
    );
  }

  const manuallySelectedIds = dependencyAnalysis.workflows
    .map((w) => w.id)
    .filter((id) => manualSelectionIds.has(id));

  return (
    <section
      data-testid="workflow-review-stage"
      className="space-y-4 rounded-lg border border-border bg-surface p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-slate-900">
        Review Integration Workflows
      </h2>
      <p className="text-sm text-muted">
        Each item below is a call chain (e.g. create then reference by ID) discovered across the
        operations you accepted a scenario for in the previous stage. Approving a workflow renders
        it as an ordered Postman request sequence with the detected data hand-offs wired between
        steps; rejecting it excludes that sequence from the export (its steps still appear as
        standalone or automatically-chained requests). This decision never adds or removes a
        generated test scenario — it only changes how already-approved scenarios are sequenced in
        the Postman output.
      </p>
      <label className="flex w-fit items-center gap-2 text-sm text-slate-700">
        <input
          ref={selectAllRef}
          type="checkbox"
          checked={allSelected}
          onChange={toggleSelectAll}
          aria-label="Select all workflows"
          data-testid="workflow-review-select-all"
          className="h-4 w-4 rounded border-border text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        />
        Select all
      </label>
      {manuallySelectedIds.length > 0 && (
        <div data-testid="workflow-review-bulk-actions" className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              setPendingBulk({ state: "approved", workflowIds: manuallySelectedIds })
            }
            className={BUTTON_STYLES.secondary}
          >
            Approve selected ({manuallySelectedIds.length})
          </button>
          <button
            type="button"
            onClick={() =>
              setPendingBulk({ state: "rejected", workflowIds: manuallySelectedIds })
            }
            className={BUTTON_STYLES.secondary}
          >
            Reject selected ({manuallySelectedIds.length})
          </button>
        </div>
      )}
      <ul className="space-y-3">
        {dependencyAnalysis.workflows.map((workflow) => {
          const state = decisions?.[workflow.id]?.state ?? "pending";
          return (
            <li
              key={workflow.id}
              data-testid={`workflow-review-item-${workflow.id}`}
              className={`space-y-3 rounded-md border border-border p-3 ${STATE_CARD_TONE_CLASSES[state]}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={manualSelectionIds.has(workflow.id)}
                  onChange={() => toggleManualSelection(workflow.id)}
                  aria-label={`Select workflow ${workflow.id}`}
                  className="mt-1 h-4 w-4 rounded border-border text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                />
                <ol className="flex-1 space-y-1.5">
                  {workflowSummary(workflow, dependencyAnalysis.graph).map(
                    ({ step, relationship }) => (
                      <li
                        key={`${workflow.id}-${step.position}`}
                        className="flex flex-wrap items-center gap-2 text-sm"
                      >
                        <HttpMethodBadge method={step.operationMethod} />
                        <span className="font-mono text-slate-800">
                          {step.operationPath}
                        </span>
                        {relationship && (
                          <>
                            <StatusBadge
                              label={CONFIDENCE_LABELS[relationship.confidence]}
                              tone={CONFIDENCE_TONES[relationship.confidence]}
                            />
                            <span className="text-muted">
                              — {relationship.explanation}
                            </span>
                          </>
                        )}
                      </li>
                    ),
                  )}
                </ol>
              </div>
              <div className="flex items-center gap-3">
                <span data-testid={`workflow-review-state-${workflow.id}`}>
                  <StatusBadge label={STATE_LABELS[state]} tone={STATE_TONES[state]} />
                </span>
                <button
                  type="button"
                  onClick={() => decide(workflow.id, "approved")}
                  disabled={submittingId === workflow.id}
                  className={BUTTON_STYLES.success}
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => decide(workflow.id, "rejected")}
                  disabled={submittingId === workflow.id}
                  className={BUTTON_STYLES.danger}
                >
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {bulkDecision.status === "running" && (
        <output
          data-testid="workflow-bulk-progress"
          className="block rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700"
        >
          Applying to {bulkDecision.processed} of {bulkDecision.total}…
        </output>
      )}
      {bulkDecision.status === "done" && (
        <output
          data-testid="workflow-bulk-summary"
          className="block rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-slate-700"
        >
          <p>
            <span className="font-medium text-success-700">{bulkDecision.succeeded}</span>
            {" succeeded, "}
            <span
              className={
                bulkDecision.failed.length > 0 ? "font-medium text-danger-700" : ""
              }
            >
              {bulkDecision.failed.length}
            </span>
            {" failed."}
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
        </output>
      )}
      {/* Sticky rather than in normal flow: with dozens of workflows to review, the continue
          action must stay reachable without scrolling past the entire list (matches the same
          fix applied to ApiReviewStage's and ScenarioReviewStage's continue/finalize bars). */}
      <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center gap-3 rounded-b-lg border-t border-border bg-surface px-5 pt-4 pb-5 shadow-[0_-4px_6px_-4px_rgba(0,0,0,0.15)]">
        {isActiveStage && (
          <button
            type="button"
            onClick={handleContinue}
            disabled={continuing}
            className={BUTTON_STYLES.primary}
          >
            {continuing ? "Continuing…" : "Continue"}
          </button>
        )}
        {error && <ErrorState testId="workflow-review-error" message={error} />}
      </div>
      {pendingBulk && (
        <ConfirmDialog
          message={
            pendingBulk.state === "approved"
              ? "Approve the selected integration workflows?"
              : "Reject the selected integration workflows?"
          }
          affectedCount={pendingBulk.workflowIds.length}
          confirmLabel={pendingBulk.state === "approved" ? "Approve" : "Reject"}
          onConfirm={handleConfirmBulk}
          onCancel={() => setPendingBulk(null)}
        />
      )}
    </section>
  );
}
