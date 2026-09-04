import type { ReviewScenarioWire } from "../services/reviewsClient";
import { HttpMethodBadge } from "./HttpMethodBadge";
import { StatusBadge, type StatusTone } from "./StatusBadge";
import { ProvenanceBadge } from "./ProvenanceBadge";

const STATE_TONES: Record<ReviewScenarioWire["state"], StatusTone> = {
  pending: "neutral",
  accepted: "success",
  rejected: "danger",
};

/** Semantic labels for a scenario's review state, avoiding color-only signaling (FR-002, accessibility). */
export function reviewStateLabel(state: ReviewScenarioWire["state"]): string {
  switch (state) {
    case "accepted":
      return "Accepted";
    case "rejected":
      return "Rejected";
    default:
      return "Pending review";
  }
}

function historyEntryLabel(entry: ReviewScenarioWire["history"][number]): string {
  if (entry.type !== "decision") {
    return `${entry.type} at revision ${entry.revision}`;
  }
  const reasonSuffix = entry.decision.reason ? ` — ${entry.decision.reason}` : "";
  return `${entry.decision.state} at revision ${entry.decision.revision}${reasonSuffix}`;
}

/** Shows one review scenario's request, assertions, provenance, and review status (US1, FR-001-FR-005). */
export function TestScenarioReviewDetail({ item }: { item: ReviewScenarioWire }) {
  const { scenario, state, history } = item;
  const provenance = scenario.provenance;

  return (
    <article data-testid="review-scenario-detail" className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <div>
        <h4 className="text-sm font-semibold text-slate-900">
          {scenario.category}
          {scenario.targetField ? ` — ${scenario.targetField}` : ""}
        </h4>
        <p className="mt-1 flex items-center gap-2 text-sm">
          <HttpMethodBadge method={scenario.operationMethod} />
          <span className="font-mono text-slate-700">{scenario.operationPath}</span>
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <span data-testid="review-scenario-state">
            <StatusBadge label={reviewStateLabel(state)} tone={STATE_TONES[state]} />
          </span>
          <span data-testid="review-scenario-origin">
            <ProvenanceBadge source={provenance.source} modifiedByUser={item.isUserModified} />
          </span>
        </div>
      </div>

      <section>
        <h5 className="text-xs font-medium uppercase tracking-wide text-muted">
          {provenance.source === "RULE" ? "Rule" : "AI source"}
        </h5>
        <p className="text-sm text-slate-700">{provenance.description}</p>
        {provenance.source === "AI" && (
          <dl className="mt-2 space-y-1 text-sm text-slate-700">
            <div>
              <dt className="inline text-muted">Rationale: </dt>
              <dd className="inline" data-testid="review-scenario-rationale">
                {provenance.aiRationale}
              </dd>
            </div>
            <div>
              <dt className="inline text-muted">Confidence: </dt>
              <dd className="inline" data-testid="review-scenario-confidence">
                {provenance.aiConfidence}
              </dd>
            </div>
            {provenance.aiAssumptions.length > 0 && (
              <div>
                <dt className="text-muted">Assumptions</dt>
                <dd>
                  <ul className="ml-4 list-disc">
                    {provenance.aiAssumptions.map((assumption, i) => (
                      <li key={i}>{assumption}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
        )}
      </section>

      <section>
        <h5 className="text-xs font-medium uppercase tracking-wide text-muted">Request</h5>
        <pre
          data-testid="review-scenario-request"
          className="mt-1 overflow-x-auto rounded-md border border-border bg-slate-900 p-3 font-mono text-xs text-slate-100"
        >
          {JSON.stringify(scenario.displayRequest, null, 2)}
        </pre>
      </section>

      <section>
        <h5 className="text-xs font-medium uppercase tracking-wide text-muted">Expected Assertions</h5>
        {scenario.assertions.length === 0 ? (
          <p className="text-sm text-muted">No documented response was available to assert against.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm text-slate-700">
            {scenario.assertions.map((assertion, i) => (
              <li key={i}>
                {assertion.type === "status-code"
                  ? `Status code: ${assertion.expectedStatusCode}`
                  : "Response schema conformance"}
              </li>
            ))}
          </ul>
        )}
      </section>

      {history.length > 0 && (
        <section>
          <h5 className="text-xs font-medium uppercase tracking-wide text-muted">Review History</h5>
          <ul data-testid="review-scenario-history" className="mt-1 space-y-1 text-sm text-slate-700">
            {history.map((entry, i) => (
              <li key={i}>{historyEntryLabel(entry)}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
