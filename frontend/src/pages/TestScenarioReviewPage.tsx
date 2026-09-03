import { useEffect, useState } from "react";
import type { ApiModel, TestModel } from "@apipilot/shared-domain";
import {
  applyReviewDecisions,
  loadReviewWorkspace,
  requestReviewRegeneration,
  submitReviewEdit,
  toReviewSnapshot,
  type ReviewScenarioWire,
  type ReviewWorkspaceWire,
} from "../services/reviewsClient";
import { TestScenarioReviewList } from "../components/TestScenarioReviewList";
import { TestScenarioReviewSummary } from "../components/TestScenarioReviewSummary";
import { TestScenarioReviewDetail } from "../components/TestScenarioReviewDetail";
import { TestScenarioReviewDecision } from "../components/TestScenarioReviewDecision";
import { TestScenarioReviewRefinement } from "../components/TestScenarioReviewRefinement";

/** Orchestrates scenario review: inspection, decisions, and AI refinement (AP-006 US1-US3). */
export function TestScenarioReviewPage({
  apiModel,
  testModel,
}: {
  apiModel: ApiModel;
  testModel: TestModel;
}) {
  const [workspace, setWorkspace] = useState<ReviewWorkspaceWire | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [submittingScenarioId, setSubmittingScenarioId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    loadReviewWorkspace(apiModel, testModel).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setWorkspace(result.review);
      } else {
        setLoadError(result.message);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [apiModel, testModel]);

  const selected: ReviewScenarioWire | null =
    workspace?.scenarios.find((s) => s.scenarioId === selectedScenarioId) ?? null;

  function applyResult(
    scenarioId: string,
    result: Awaited<ReturnType<typeof loadReviewWorkspace>>,
  ) {
    setSubmittingScenarioId(null);
    if (!result.ok) {
      setActionError(result.message);
      return;
    }
    setWorkspace(result.review);
    const outcome = result.outcomes.find((o) => o.scenarioId === scenarioId);
    if (outcome && !outcome.applied) {
      setActionError(outcome.finding?.message ?? "The request could not be applied.");
    } else {
      setActionError(null);
    }
  }

  async function handleAccept(item: ReviewScenarioWire) {
    setSubmittingScenarioId(item.scenarioId);
    setActionError(null);
    const result = await applyReviewDecisions(
      apiModel,
      testModel,
      toReviewSnapshot(workspace),
      [{ scenarioId: item.scenarioId, revision: item.revision, action: "accept" }],
    );
    applyResult(item.scenarioId, result);
  }

  async function handleReject(item: ReviewScenarioWire, reason: string) {
    setSubmittingScenarioId(item.scenarioId);
    setActionError(null);
    const result = await applyReviewDecisions(
      apiModel,
      testModel,
      toReviewSnapshot(workspace),
      [
        {
          scenarioId: item.scenarioId,
          revision: item.revision,
          action: "reject",
          reason,
        },
      ],
    );
    applyResult(item.scenarioId, result);
  }

  async function handleEdit(
    item: ReviewScenarioWire,
    edit: Parameters<typeof submitReviewEdit>[5],
  ) {
    setSubmittingScenarioId(item.scenarioId);
    setActionError(null);
    const result = await submitReviewEdit(
      apiModel,
      testModel,
      toReviewSnapshot(workspace),
      item.scenarioId,
      item.revision,
      edit,
    );
    applyResult(item.scenarioId, result);
  }

  async function handleRegenerate(item: ReviewScenarioWire) {
    setSubmittingScenarioId(item.scenarioId);
    setActionError(null);
    const result = await requestReviewRegeneration(
      apiModel,
      testModel,
      toReviewSnapshot(workspace),
      item.scenarioId,
      item.revision,
    );
    applyResult(item.scenarioId, result);
  }

  if (loading) {
    return <p data-testid="review-loading">Loading review workspace...</p>;
  }

  if (loadError) {
    return (
      <p role="alert" data-testid="review-load-error">
        {loadError}
      </p>
    );
  }

  if (!workspace) {
    return null;
  }

  if (workspace.scenarios.length === 0) {
    return <p data-testid="review-empty">There are no generated scenarios to review.</p>;
  }

  return (
    <section data-testid="test-scenario-review-page">
      <h2>Review Generated Scenarios</h2>
      <TestScenarioReviewSummary summary={workspace.summary} />
      <TestScenarioReviewList
        scenarios={workspace.scenarios}
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
    </section>
  );
}
