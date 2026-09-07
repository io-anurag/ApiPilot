import { useMemo } from "react";
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
}: Readonly<{
  scenarios: TestScenario[];
  onSelect: (scenario: TestScenario) => void;
}>) {
  const groups = useMemo(() => groupByOperation(scenarios), [scenarios]);

  if (scenarios.length === 0) {
    return (
      <p
        data-testid="test-scenario-list-empty"
        className="border border-dashed border-border bg-slate-50 px-4 py-6 text-center text-sm text-muted"
      >
        No test scenarios were generated for this specification.
      </p>
    );
  }

  return (
    <div data-testid="test-scenario-list" className="space-y-3">
      {[...groups.entries()].map(([operationKey, operationScenarios]) => (
        <section
          key={operationKey}
          className="overflow-hidden rounded-md border border-border bg-surface"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border bg-slate-50 px-3 py-2">
            <h4 className="min-w-0 break-all font-mono text-xs font-semibold text-slate-800">
              {operationKey}
            </h4>
            <span className="shrink-0 text-xs text-muted">
              {operationScenarios.length} scenario
              {operationScenarios.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="divide-y divide-border">
            {operationScenarios.map((scenario) => (
              <li key={scenario.id}>
                <button
                  type="button"
                  onClick={() => onSelect(scenario)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
                >
                  <span>
                    {scenario.category}
                    {scenario.targetField ? ` — ${scenario.targetField}` : ""}
                  </span>
                  <span aria-hidden="true" className="text-muted">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
