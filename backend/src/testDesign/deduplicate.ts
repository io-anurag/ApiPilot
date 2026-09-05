import type { TestScenario } from "@apipilot/shared-domain";

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

/** Stable, order-independent identity key for a scenario's method/path/request/assertions, used to detect equivalent scenarios. */
export function dedupeKey(scenario: TestScenario): string {
  return JSON.stringify(
    sortKeysDeep({
      method: scenario.operationMethod,
      path: scenario.operationPath,
      request: scenario.request,
      assertions: scenario.assertions,
    }),
  );
}

/** True when two scenarios share the same method/path/request/assertions (their `dedupeKey`s match). */
export function scenariosAreEquivalent(left: TestScenario, right: TestScenario): boolean {
  return dedupeKey(left) === dedupeKey(right);
}

/**
 * Deduplicates scenarios that share an identical request and expected assertions within the
 * same operation, retaining the first-seen scenario and merging the rest into its
 * rule and AI origin fields so traceability is preserved (FR-012, SC-004).
 */
export function deduplicate(scenarios: TestScenario[]): TestScenario[] {
  const retained = new Map<string, TestScenario>();
  const order: string[] = [];
  for (const scenario of scenarios) {
    const key = dedupeKey(scenario);
    const existing = retained.get(key);
    if (!existing) {
      retained.set(key, scenario);
      order.push(key);
      continue;
    }
    if (existing.provenance.source === "RULE" && scenario.provenance.source === "RULE") {
      if (
        existing.provenance.rule !== scenario.provenance.rule &&
        !existing.provenance.duplicateOfRules.includes(scenario.provenance.rule)
      ) {
        existing.provenance.duplicateOfRules.push(scenario.provenance.rule);
      }
    } else if (scenario.provenance.source === "AI") {
      const candidateIds =
        existing.provenance.duplicateOfAICandidates ??
        (existing.provenance.duplicateOfAICandidates = []);
      const candidateIdsToAdd = scenario.provenance.aiCandidateId
        ? [scenario.provenance.aiCandidateId]
        : [];
      for (const candidateId of candidateIdsToAdd) {
        if (!candidateIds.includes(candidateId)) candidateIds.push(candidateId);
      }
      if (existing.provenance.source === "AI") {
        for (const candidateId of scenario.provenance.duplicateOfAICandidates) {
          if (!candidateIds.includes(candidateId)) candidateIds.push(candidateId);
        }
      }
    }
  }
  return order.map((key) => retained.get(key)!);
}
