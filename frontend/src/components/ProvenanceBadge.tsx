const SOURCE_LABELS: Record<string, string> = {
  RULE: "Deterministic rule",
  AI: "AI-suggested",
};

const SOURCE_CLASSES: Record<string, string> = {
  RULE: "border border-slate-300 text-slate-700",
  AI: "border border-brand-300 text-brand-700",
};
const USER_MODIFIED_CLASSES = "border border-warning-300 text-warning-700";

/**
 * Single source of truth for provenance visual treatment (FR-001, FR-002; post-/speckit-analyze
 * finding U1), imported by TestScenarioReviewList and TestScenarioReviewDetail. Labels mirror the
 * `Provenance.source` values ApiPilot's domain model actually produces ("RULE" | "AI" —
 * packages/shared-domain/src/testModel.ts). A user edit (`ReviewScenario.isUserModified`) fully
 * replaces the label with "User-modified" rather than appending to it, since once a scenario has
 * been edited its original rule/AI origin is no longer what the QA engineer is reviewing.
 */
export function ProvenanceBadge({ source, modifiedByUser }: { source: string; modifiedByUser?: boolean }) {
  const label = modifiedByUser ? "User-modified" : (SOURCE_LABELS[source] ?? source);
  const toneClasses = modifiedByUser ? USER_MODIFIED_CLASSES : (SOURCE_CLASSES[source] ?? "border border-slate-300 text-slate-700");
  return (
    <span
      data-testid="provenance-badge"
      data-source={source}
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${toneClasses}`}
    >
      {label}
    </span>
  );
}
