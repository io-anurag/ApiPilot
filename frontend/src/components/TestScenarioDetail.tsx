import type { TestScenario } from "@apipilot/shared-domain";

/** Shows a single scenario's category, provenance, generated request, and expected assertions (US2). */
export function TestScenarioDetail({ scenario }: { scenario: TestScenario }) {
  const provenanceLabel =
    scenario.provenance.source === "RULE"
      ? scenario.provenance.rule
      : `${scenario.provenance.aiProvider} / ${scenario.provenance.aiModel}`;
  return (
    <article data-testid="test-scenario-detail">
      <h4>
        {scenario.category}
        {scenario.targetField ? ` — ${scenario.targetField}` : ""}
      </h4>
      <p>
        {scenario.operationMethod} {scenario.operationPath}
      </p>
      <section>
        <h5>{scenario.provenance.source === "RULE" ? "Rule" : "AI source"}</h5>
        <p data-testid="scenario-rule">{provenanceLabel}</p>
        <p>{scenario.provenance.description}</p>
      </section>
      <section>
        <h5>Request</h5>
        <pre>{JSON.stringify(scenario.request, null, 2)}</pre>
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
      {scenario.provenance.duplicateOfRules.length > 0 && (
        <p>Also matches rules: {scenario.provenance.duplicateOfRules.join(", ")}</p>
      )}
    </article>
  );
}
