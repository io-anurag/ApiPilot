import type {
  CoverageFilter,
  CoverageGap,
  CoverageRequirementResult,
  CoverageScenarioResult,
  CoverageSnapshot,
  CoverageState,
  OperationCoverage,
} from "@apipilot/shared-domain";
import {
  assertionOutcomesFor,
  categoryCoverageFor,
  metricsFor,
  operationCountsFor,
  recommendationsFor,
  recomputeRow,
  unclassifiedFor,
} from "./summarize";

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

/** Gap-type families (coverage-rules.md 13.2): a requirement state belongs to exactly one. */
const GAP_KIND_STATES: Record<NonNullable<CoverageFilter["gapKind"]>, ReadonlySet<CoverageState>> = {
  missing: new Set(["not-covered", "generated-not-executed"]),
  failed: new Set(["executed-failed"]),
  insufficient: new Set(["inconclusive"]),
  stale: new Set(["stale"]),
};

function sortKeyValue(row: OperationCoverage, key: NonNullable<CoverageFilter["sort"]>): number | string {
  switch (key) {
    case "priority":
      return PRIORITY_RANK[row.priority];
    case "method":
      return row.method;
    case "path":
      return row.path;
    case "specification":
      return row.specification.total === 0 ? 1 : row.specification.covered / row.specification.total;
    case "runtime":
      return row.runtime.total === 0 ? 1 : row.runtime.verified / row.runtime.total;
  }
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(key(item));
    if (list) list.push(item);
    else map.set(key(item), [item]);
  }
  return map;
}

/** Does a requirement satisfy the state and gap-type filters (both when both are given)? */
function matchesState(requirement: CoverageRequirementResult, filter: CoverageFilter): boolean {
  if (filter.states?.length && !filter.states.includes(requirement.state)) return false;
  if (filter.gapKind && !GAP_KIND_STATES[filter.gapKind].has(requirement.state)) return false;
  return true;
}

/**
 * Applies a view filter and sort to a full snapshot. The same function serves the screen route
 * and both exports, so exported figures cannot diverge from what is shown (FR-024, FR-037).
 *
 * Row filters (method, path, priority, state, gap type) choose operations. The category filter
 * also restricts the requirements and scenarios considered, so every operation figure, card and
 * breakdown is recomputed over that category; the category section itself always shows all four
 * categories for the chosen operations. Priorities and gap contents are never recomputed: they
 * are filtered, so they stay stable. `totals` always describes the unfiltered snapshot.
 */
export function filterSnapshot(snapshot: CoverageSnapshot, filter: CoverageFilter): CoverageSnapshot {
  const q = filter.q?.trim().toLowerCase();
  const requirementsByOp = groupBy(snapshot.requirements, (r) => r.operationKey);
  const scenariosByOp = groupBy(snapshot.scenarios, (s) => s.operationKey);
  const stateFilterActive = Boolean(filter.states?.length) || filter.gapKind !== undefined;

  const restrict = <T extends { group: string }>(items: readonly T[]): T[] =>
    filter.category ? items.filter((item) => item.group === filter.category) : [...items];

  const rows: OperationCoverage[] = [];
  const scopedRequirements = new Map<string, CoverageRequirementResult[]>();
  const scopedScenarios = new Map<string, CoverageScenarioResult[]>();
  for (const row of snapshot.operations) {
    if (filter.methods?.length && !filter.methods.map((m) => m.toUpperCase()).includes(row.method)) continue;
    if (q && !row.path.toLowerCase().includes(q)) continue;
    if (filter.priorities?.length && !filter.priorities.includes(row.priority)) continue;
    const requirements = restrict(requirementsByOp.get(row.operationKey) ?? []);
    if (filter.category && requirements.length === 0) continue;
    const matching = stateFilterActive ? requirements.filter((r) => matchesState(r, filter)) : [];
    if (stateFilterActive && matching.length === 0) continue;
    const scenarios = restrict(scenariosByOp.get(row.operationKey) ?? []);
    scopedRequirements.set(row.operationKey, requirements);
    scopedScenarios.set(row.operationKey, scenarios);
    const recomputed = recomputeRow(row, requirements, scenarios);
    rows.push(stateFilterActive ? { ...recomputed, matchingRequirements: matching.length } : recomputed);
  }

  const sort = filter.sort ?? "priority";
  const direction = (filter.order ?? "asc") === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const x = sortKeyValue(a, sort);
    const y = sortKeyValue(b, sort);
    const primary = x < y ? -1 : x > y ? 1 : 0;
    return (primary || a.operationKey.localeCompare(b.operationKey)) * direction;
  });

  const keys = new Set(rows.map((r) => r.operationKey));
  const gapKept = (gap: CoverageGap): boolean => {
    if (!keys.has(gap.operationKey)) return false;
    if (filter.states?.length && !filter.states.includes(gap.state)) return false;
    if (filter.gapKind && !GAP_KIND_STATES[filter.gapKind].has(gap.state)) return false;
    if (filter.category && !gap.categoryGroups.includes(filter.category)) return false;
    if (filter.priorities?.length && !filter.priorities.includes(gap.priority)) return false;
    return true;
  };
  const gaps = snapshot.gaps.filter(gapKept);
  const requirements = rows.flatMap((r) => scopedRequirements.get(r.operationKey) ?? []);
  const scenarios = rows.flatMap((r) => scopedScenarios.get(r.operationKey) ?? []);
  const allRequirementsOfKept = snapshot.requirements.filter((r) => keys.has(r.operationKey));
  const operationCounts = operationCountsFor(rows);
  const assertionOutcomes = assertionOutcomesFor(rows);

  return {
    ...snapshot,
    operations: rows,
    scenarios,
    requirements,
    gaps,
    recommendations: recommendationsFor(gaps, requirements),
    operationCounts,
    assertionOutcomes,
    metrics: metricsFor(requirements, operationCounts, assertionOutcomes),
    categoryCoverage: categoryCoverageFor(allRequirementsOfKept),
    unclassified: unclassifiedFor(allRequirementsOfKept, snapshot.unclassified.scenarios),
  };
}
