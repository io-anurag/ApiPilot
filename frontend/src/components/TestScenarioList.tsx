import type { TestScenario } from "@apipilot/shared-domain";

function groupByOperation(scenarios: TestScenario[]): Map<string, TestScenario[]> {
  const groups = new Map<string, TestScenario[]>();
  for (const scenario of scenarios) {
    const key = `${scenario.operationMethod} ${scenario.operationPath}`;
    const existing = groups.get(key);
    if (existing) existing.push(scenario);
    else groups.set(key, [scenario]);
  }
  return groups;
}

/** Lists generated scenarios grouped by operation and category (FR-016). */
export function TestScenarioList({
  scenarios,
  onSelect,
}: {
  scenarios: TestScenario[];
  onSelect: (scenario: TestScenario) => void;
}) {
  const groups = groupByOperation(scenarios);
  return (
    <div data-testid="test-scenario-list">
      {[...groups.entries()].map(([operationKey, operationScenarios]) => (
        <section key={operationKey}>
          <h4>{operationKey}</h4>
          <ul>
            {operationScenarios.map((scenario) => (
              <li key={scenario.id}>
                <button type="button" onClick={() => onSelect(scenario)}>
                  {scenario.category}
                  {scenario.targetField ? ` — ${scenario.targetField}` : ""}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
