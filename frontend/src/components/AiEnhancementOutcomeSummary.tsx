import type { TestGenerationWorkflow } from "@apipilot/shared-domain";

/**
 * Read-only account of one AI enhancement run's outcome (how many AI-suggested scenarios were
 * added versus deduplicated/rejected/non-executable, plus the failure explanation for a
 * skipped/partial run). Shared between the live scenario-review screen — where the run just
 * finished — and the workflow tracker's read-only view of an already-completed aiEnhancement
 * stage, since both show the same underlying `workflow.aiEnhancement`/`stages.aiEnhancement` data.
 */
export function AiEnhancementOutcomeSummary({
  workflow,
}: Readonly<{ workflow: TestGenerationWorkflow }>) {
  const enhancement = workflow.aiEnhancement;
  if (!enhancement) return null;

  const { added, deduplicated, rejected, nonExecutable } = enhancement.aiCandidates ?? {
    added: [],
    deduplicated: [],
    rejected: [],
    nonExecutable: [],
  };
  const totalCandidates =
    added.length + deduplicated.length + rejected.length + nonExecutable.length;
  const hasUniqueScenarios = added.length > 0;
  const addedLabel = `${added.length} AI-suggested scenario${added.length === 1 ? "" : "s"} added to review`;
  const rejectedLabel = `${deduplicated.length} duplicate, ${rejected.length} rejected, and ${nonExecutable.length} non-executable candidate${totalCandidates === 1 ? "" : "s"}.`;
  const failureExplanation = workflow.stages.aiEnhancement.failureExplanation;

  return (
    <section
      data-testid="ai-review-outcome"
      className={`rounded-md border p-3 text-sm ${
        hasUniqueScenarios
          ? "border-brand-200 bg-brand-50 text-brand-900"
          : "border-warning-200 bg-warning-50 text-warning-800"
      }`}
    >
      <p className="font-semibold">
        {hasUniqueScenarios
          ? addedLabel
          : "AI enhancement completed without adding a unique scenario"}
      </p>
      <p className="mt-1">
        {totalCandidates === 0
          ? "The model returned no usable candidates. The list currently contains only deterministic scenarios."
          : rejectedLabel}
      </p>
      {failureExplanation && <p className="mt-1">{failureExplanation.summary}</p>}
    </section>
  );
}
