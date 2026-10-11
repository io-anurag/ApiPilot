import { COVERAGE_STATES } from "@apipilot/shared-domain";
import type {
  CoverageGap,
  CoverageMetric,
  CoverageRequirementResult,
  CoverageScenarioResult,
  CoverageSnapshot,
  CoverageState,
  OperationCoverage,
} from "@apipilot/shared-domain";

/** Test data only: a hand-built snapshot in the shape the backend returns. Never used by the product. */
export function stateCounts(over: Partial<Record<CoverageState, number>> = {}): Record<CoverageState, number> {
  return { ...Object.fromEntries(COVERAGE_STATES.map((s) => [s, 0])), ...over } as Record<CoverageState, number>;
}

export function metric(
  id: string,
  dimension: CoverageMetric["dimension"],
  label: string,
  numerator: number,
  denominator: number,
): CoverageMetric {
  return {
    id,
    dimension,
    kind: "operation",
    label,
    numerator,
    denominator,
    percentage: denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10,
    available: denominator > 0,
    basis: `Basis for ${label}.`,
  };
}

export function operation(over: Partial<OperationCoverage> & Pick<OperationCoverage, "operationKey">): OperationCoverage {
  const [method, ...path] = over.operationKey.split(" ");
  return {
    method,
    path: path.join(" "),
    specification: { covered: 3, total: 4 },
    runtime: { verified: 1, total: 4 },
    failedCount: 0,
    stateCounts: stateCounts({ verified: 1, "generated-not-executed": 2, "not-covered": 1 }),
    scenarioVerdicts: { passed: 1, failed: 0, inconclusive: 0, notExecuted: 2 },
    scenarioCount: 3,
    missing: ["1 of 3 documented responses have no generated scenario."],
    priority: "medium",
    categoryGroups: ["positive", "negative"],
    assertions: { evaluated: 2, passed: 2, failed: 0, notEvaluated: 0 },
    securityDeclared: false,
    ...over,
  };
}

export function requirement(
  id: string,
  kind: CoverageRequirementResult["kind"],
  state: CoverageState,
  operationKey = "POST /orders",
): CoverageRequirementResult {
  return {
    id,
    kind,
    operationKey,
    label: id,
    contractHash: "h",
    group: "positive",
    state,
    reason: "reason",
    scenarioIds: [],
    acceptedCount: 0,
    pendingCount: 0,
    tally: { passed: 0, failed: 0, inconclusive: 0, notExecuted: 0 },
    evidence: [],
  };
}

export function scenario(over: Partial<CoverageScenarioResult> & Pick<CoverageScenarioResult, "scenarioId" | "operationKey">): CoverageScenarioResult {
  return { group: "positive", reviewState: "accepted", verdict: "not-executed", cause: "never-run", assertions: { passed: 0, failed: 0, notEvaluated: 0 }, ...over };
}

export function gap(over: Partial<CoverageGap> & Pick<CoverageGap, "id" | "operationKey">): CoverageGap {
  return {
    kind: "mixed",
    requirementIds: [],
    state: "generated-not-executed",
    reason: "4 requirements have generated scenarios that were not executed.",
    categoryGroups: ["positive"],
    priority: "medium",
    score: 4,
    factors: [{ factor: "state", points: 2, explanation: "The requirement is generated not executed." }],
    evidence: [],
    ...over,
  };
}

export function snapshot(over: Partial<CoverageSnapshot> = {}): CoverageSnapshot {
  const operations = [
    operation({
      operationKey: "POST /orders",
      priority: "high",
      failedCount: 1,
      stateCounts: stateCounts({ "executed-failed": 1, verified: 2, "not-covered": 1 }),
      scenarioVerdicts: { passed: 2, failed: 1, inconclusive: 0, notExecuted: 1 },
      scenarioCount: 4,
      missing: ["1 of 3 documented responses have no generated scenario.", "1 requirements have executed scenarios that failed a check."],
    }),
    operation({ operationKey: "GET /orders/{id}", priority: "medium" }),
    operation({
      operationKey: "DELETE /orders/{id}",
      priority: "high",
      specification: { covered: 2, total: 4 },
      runtime: { verified: 0, total: 4 },
      stateCounts: stateCounts({ "generated-not-executed": 2, "not-covered": 2 }),
      scenarioVerdicts: { passed: 0, failed: 0, inconclusive: 0, notExecuted: 2 },
      scenarioCount: 2,
    }),
    operation({
      operationKey: "GET /orders",
      priority: "low",
      specification: { covered: 4, total: 4 },
      runtime: { verified: 4, total: 4 },
      stateCounts: stateCounts({ verified: 4 }),
      scenarioVerdicts: { passed: 4, failed: 0, inconclusive: 0, notExecuted: 0 },
      scenarioCount: 4,
      missing: [],
    }),
  ];
  return {
    specification: { name: "Orders API", version: "1.0.0", revision: "9f3a1c0123456789", operationCount: 4 },
    context: {
      workflowId: "wf-1",
      selectedOperationCount: 4,
      scenarioCounts: { total: 30, accepted: 26, pending: 3, rejected: 1, rule: 28, ai: 2 },
    },
    execution: {
      sources: ["uploaded"],
      runIds: ["run-2"],
      availableRuns: [
        { id: "run-2", kind: "uploaded", startedAt: "2026-10-10T11:00:00.000Z", label: "Orders collection" },
        { id: "run-1", kind: "uploaded", startedAt: "2026-10-10T09:00:00.000Z", label: "Orders collection" },
      ],
      evidenceMode: "latest-per-scenario",
      evidenceByRun: [{ runId: "run-2", scenarios: 9 }],
      environments: [{ name: "Orders collection", tier: "local" }],
      excludedRuns: [],
      lastQualifyingExecutionAt: "2026-10-10T11:00:00.000Z",
      environment: { name: "Orders collection", tier: "local" },
      unattributedResults: 0,
      editedResults: 0,
    },
    metrics: [
      metric("spec-operations", "specification", "Operations", 4, 4),
      metric("spec-parameters", "specification", "Parameters", 3, 3),
      metric("spec-request-schemas", "specification", "Request schemas", 18, 20),
      metric("spec-response-schemas", "specification", "Response schemas", 2, 3),
      metric("spec-response-codes", "specification", "Response codes", 7, 9),
      metric("runtime-operations", "runtime", "Operations with passing verification", 3, 4),
      metric("runtime-response-codes", "runtime", "Response codes verified", 2, 9),
      metric("runtime-assertions", "runtime", "Assertions evaluated and passed", 9, 11),
    ],
    operationCounts: { eligible: 4, withScenarios: 4, withPassingVerification: 3, withFailures: 1, withNoScenarios: 0 },
    assertionOutcomes: { passed: 9, failed: 2, notEvaluated: 1 },
    operations,
    scenarios: [
      scenario({ scenarioId: "s1", operationKey: "POST /orders", verdict: "failed", cause: "assertion-failed", runId: "run-2" }),
      scenario({ scenarioId: "s2", operationKey: "POST /orders", verdict: "passed", cause: undefined, runId: "run-2" }),
      scenario({ scenarioId: "s3", operationKey: "DELETE /orders/{id}" }),
    ],
    requirements: [
      requirement("op:POST /orders", "operation", "executed-failed"),
      requirement("op:GET /orders", "operation", "verified", "GET /orders"),
      requirement("op:DELETE /orders/{id}", "operation", "generated-not-executed", "DELETE /orders/{id}"),
      requirement("param:GET /orders:query:limit", "parameter", "verified", "GET /orders"),
      requirement("reqprop:POST /orders:sku", "request-schema", "not-covered"),
      requirement("respschema:POST /orders:201", "response-schema", "inconclusive"),
    ],
    gaps: [
      gap({ id: "gap:DELETE /orders/{id}:no-scenarios", operationKey: "DELETE /orders/{id}", kind: "operation", state: "not-covered", priority: "high", score: 9, reason: "The operation has no generated scenario; 4 requirements are not covered." }),
      gap({ id: "gap:POST /orders:executed-failed", operationKey: "POST /orders", state: "executed-failed", priority: "high", score: 8, reason: "1 requirements have executed scenarios that failed a check." }),
      gap({ id: "gap:GET /orders/{id}:response-code", operationKey: "GET /orders/{id}", kind: "response-code", state: "not-covered", priority: "medium", score: 4, reason: "1 of 3 documented responses have no generated scenario." }),
    ],
    recommendations: [
      {
        rank: 1,
        gapId: "gap:DELETE /orders/{id}:no-scenarios",
        operationKey: "DELETE /orders/{id}",
        requirement: "DELETE /orders/{id} (+3 more)",
        why: "The operation has no generated scenario; 4 requirements are not covered.",
        evidence: [],
        priority: "high",
        rationale: "state +3, kind +2, method +3 = 8 (heuristic)",
        action: { type: "generate-scenario", scenarioIds: [] },
      },
      {
        rank: 2,
        gapId: "gap:POST /orders:executed-failed",
        operationKey: "POST /orders",
        requirement: "op:POST /orders",
        why: "1 requirements have executed scenarios that failed a check.",
        evidence: [{ runId: "run-2", runKind: "uploaded", scenarioId: "s1", startedAt: "2026-10-10T11:00:00.000Z", outcome: "failed", verdict: "failed" }],
        priority: "high",
        rationale: "state +4, method +1 = 5 (heuristic)",
        action: { type: "open-result", scenarioIds: ["s1"], runId: "run-2" },
      },
    ],
    notMeasurable: [{ kind: "parameter", operationKey: "GET /orders", label: 'cookie parameter "session"', reason: "The scenario model cannot carry cookie parameters." }],
    categoryCoverage: [
      { group: "positive", available: true, eligible: 4, specCovered: 4, verified: 2, counts: stateCounts({ verified: 2, "generated-not-executed": 2 }) },
      { group: "negative", available: true, eligible: 3, specCovered: 2, verified: 1, counts: stateCounts({ verified: 1, "executed-failed": 1, "not-covered": 1 }) },
      { group: "boundary", available: true, eligible: 2, specCovered: 1, verified: 0, counts: stateCounts({ "generated-not-executed": 1, "not-covered": 1 }) },
      { group: "security", available: false, eligible: 0, specCovered: 0, verified: 0, counts: stateCounts(), reason: "No scenario category identifies authorization intent." },
    ],
    unclassified: { requirements: [{ operationKey: "GET /orders/{id}", label: "documented response default" }], scenarios: 0 },
    outOfScopeOperations: ["GET /health"],
    scenarioEditedAfterRun: [],
    notices: [
      { code: "evidence", severity: "info", message: "Generated scenarios contribute to specification coverage. Runtime-verified coverage requires qualifying execution evidence." },
      { code: "edited-results", severity: "warning", message: "2 results came from requests edited before the run and are shown as inconclusive." },
    ],
    totals: { operations: 4, gaps: 3 },
    calculatedAt: "2026-10-10T12:00:00.000Z",
    ...over,
  };
}
