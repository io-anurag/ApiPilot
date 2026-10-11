import { useState } from "react";
import type { CoverageRecommendation } from "@apipilot/shared-domain";
import { BUTTON_STYLES } from "../controlStyles";
import { EmptyState } from "../EmptyState";
import { HttpMethodBadge } from "../HttpMethodBadge";
import { PriorityBadge } from "./CoverageBadges";
import { CAUSE_LABELS, type OpenWorkflow } from "./coverageViewModel";

/** Recommendations are ranked, so the top few matter most; the rest sit behind a toggle. */
const INITIAL_VISIBLE = 5;

const ACTION_LABEL: Record<CoverageRecommendation["action"]["type"], string> = {
  "generate-scenario": "Go to scenario generation",
  "review-scenario": "Review scenarios",
  "open-result": "Open failing result",
  "re-run": "Re-run in Import & Run",
};

function describeEvidence(rec: CoverageRecommendation): string {
  if (rec.evidence.length === 0) return "No execution evidence for this gap yet.";
  // Several scenarios of one run often say the same thing; report each distinct finding once, with a count.
  const groups = new Map<string, number>();
  for (const e of rec.evidence) {
    const key = `${e.verdict}${e.cause ? ` (${CAUSE_LABELS[e.cause]})` : ""} in run ${e.runId}${e.note ? ` (${e.note})` : ""}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups].map(([text, count]) => (count > 1 ? `${text}; ${count} scenarios shown` : text)).join("; ");
}

/**
 * Ranked next tests (FR-025). Every entry names the operation, the uncovered requirement, why it
 * is a gap, the evidence behind it, its priority with the scoring rationale, and an action. All of
 * it is computed from real gaps by the backend; nothing here is generated or invented.
 */
export function Recommendations({
  recommendations,
  onOpenWorkflow,
}: Readonly<{
  recommendations: readonly CoverageRecommendation[];
  onOpenWorkflow: OpenWorkflow;
}>) {
  const [showAll, setShowAll] = useState(false);
  if (recommendations.length === 0) {
    return <EmptyState testId="recommendations-empty" message="No recommendations for the current view." description="Every requirement in view is verified, or the filters match no gap." />;
  }
  const visible = showAll ? recommendations : recommendations.slice(0, INITIAL_VISIBLE);
  return (
    <div className="space-y-3">
    <ol data-testid="recommendations" className="space-y-3">
      {visible.map((rec) => {
        const [method, ...path] = rec.operationKey.split(" ");
        return (
          <li key={rec.gapId} data-testid="recommendation" className="space-y-1.5 rounded-lg border border-border bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-muted">#{rec.rank}</span>
              <HttpMethodBadge method={method} />
              <span className="font-mono text-xs text-text-primary">{path.join(" ")}</span>
              <PriorityBadge priority={rec.priority} />
            </div>
            <p className="text-sm text-text-primary">
              <span className="font-semibold">Requirement: </span>
              {rec.requirement}
            </p>
            <p className="text-xs text-text-secondary">
              <span className="font-semibold">Why: </span>
              {rec.why}
            </p>
            <p className="text-xs text-text-secondary">
              <span className="font-semibold">Evidence: </span>
              {describeEvidence(rec)}
            </p>
            <p className="text-xs text-muted">
              <span className="font-semibold">Priority rationale: </span>
              {rec.rationale}
            </p>
            <button
              type="button"
              className={BUTTON_STYLES.secondary}
              onClick={() =>
                rec.action.type === "open-result" || rec.action.type === "re-run"
                  ? onOpenWorkflow("import-collection", { runId: rec.action.type === "open-result" ? rec.action.runId : undefined })
                  : onOpenWorkflow("guided-workflow")
              }
            >
              {ACTION_LABEL[rec.action.type]}
            </button>
          </li>
        );
      })}
    </ol>
    {recommendations.length > INITIAL_VISIBLE && (
      <button
        type="button"
        aria-expanded={showAll}
        onClick={() => setShowAll((current) => !current)}
        className={BUTTON_STYLES.ghost}
      >
        {showAll ? `Show top ${INITIAL_VISIBLE} only` : `Show all ${recommendations.length} recommendations`}
      </button>
    )}
    </div>
  );
}
