import type { ReviewScenarioWire } from "../services/reviewsClient";

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

function originLabelFor(item: ReviewScenarioWire): string {
  if (item.isUserModified) return "User-modified";
  return item.scenario.provenance.source === "RULE"
    ? "Deterministic rule"
    : "AI-suggested";
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
  const originLabel = originLabelFor(item);

  return (
    <article data-testid="review-scenario-detail">
      <h4>
        {scenario.category}
        {scenario.targetField ? ` — ${scenario.targetField}` : ""}
      </h4>
      <p>
        {scenario.operationMethod} {scenario.operationPath}
      </p>
      <p data-testid="review-scenario-state">{reviewStateLabel(state)}</p>
      <p data-testid="review-scenario-origin">{originLabel}</p>

      <section>
        <h5>{provenance.source === "RULE" ? "Rule" : "AI source"}</h5>
        <p>{provenance.description}</p>
        {provenance.source === "AI" && (
          <dl>
            <dt>Rationale</dt>
            <dd data-testid="review-scenario-rationale">{provenance.aiRationale}</dd>
            <dt>Confidence</dt>
            <dd data-testid="review-scenario-confidence">{provenance.aiConfidence}</dd>
            {provenance.aiAssumptions.length > 0 && (
              <>
                <dt>Assumptions</dt>
                <dd>
                  <ul>
                    {provenance.aiAssumptions.map((assumption, i) => (
                      <li key={i}>{assumption}</li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
          </dl>
        )}
      </section>

      <section>
        <h5>Request</h5>
        <pre data-testid="review-scenario-request">
          {JSON.stringify(scenario.displayRequest, null, 2)}
        </pre>
      </section>

      <section>
        <h5>Expected Assertions</h5>
        {scenario.assertions.length === 0 ? (
          <p>No documented response was available to assert against.</p>
        ) : (
          <ul>
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
          <h5>Review History</h5>
          <ul data-testid="review-scenario-history">
            {history.map((entry, i) => (
              <li key={i}>{historyEntryLabel(entry)}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
