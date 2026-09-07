import type { TestScenario } from "@apipilot/shared-domain";

/** Shows a single scenario's category, provenance, generated request, and expected assertions (US2). */
export function TestScenarioDetail({ scenario }: Readonly<{ scenario: TestScenario }>) {
  const provenanceLabel =
    scenario.provenance.source === "RULE"
      ? scenario.provenance.rule
      : `${scenario.provenance.aiProvider} / ${scenario.provenance.aiModel}`;

  return (
    <article
      data-testid="test-scenario-detail"
      className="space-y-4 rounded-md border border-border bg-surface p-4"
    >
      <div>
        <h4 className="text-sm font-semibold text-slate-900">
          {scenario.category}
          {scenario.targetField ? ` — ${scenario.targetField}` : ""}
        </h4>
        <p className="mt-1 break-all font-mono text-xs text-slate-600">
          {scenario.operationMethod} {scenario.operationPath}
        </p>
      </div>
      <section className="space-y-1">
        <h5 className="text-xs font-medium uppercase text-muted">
          {scenario.provenance.source === "RULE" ? "Rule" : "AI source"}
        </h5>
        <p data-testid="scenario-rule" className="font-mono text-xs text-slate-700">
          {provenanceLabel}
        </p>
        <p className="text-sm leading-6 text-slate-700">
          {scenario.provenance.description}
        </p>
      </section>
      <section className="space-y-1">
        <h5 className="text-xs font-medium uppercase text-muted">Request</h5>
        <pre className="max-w-full overflow-x-auto rounded-md border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100">
          {JSON.stringify(scenario.request, null, 2)}
        </pre>
      </section>
      <section className="space-y-1">
        <h5 className="text-xs font-medium uppercase text-muted">Expected Assertions</h5>
        {scenario.assertions.length === 0 ? (
          <p className="text-sm text-muted">
            No documented response was available to assert against.
          </p>
        ) : (
          <ul className="space-y-1 text-sm text-slate-700">
            {scenario.assertions.map((assertion) => (
              <li key={JSON.stringify(assertion)}>
                {assertion.type === "status-code"
                  ? `Status code: ${assertion.expectedStatusCode}`
                  : "Response schema conformance"}
              </li>
            ))}
          </ul>
        )}
      </section>
      {scenario.provenance.duplicateOfRules.length > 0 && (
        <p className="text-sm text-muted">
          Also matches rules: {scenario.provenance.duplicateOfRules.join(", ")}
        </p>
      )}
    </article>
  );
}
