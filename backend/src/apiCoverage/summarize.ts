import type {
  CoverageCategoryCoverage,
  CoverageCause,
  CoverageDimensionKind,
  CoverageGap,
  CoverageMetric,
  CoverageOperationCounts,
  CoveragePriority,
  CoverageRecommendation,
  CoverageRequirementResult,
  CoverageScenarioResult,
  CoverageSnapshot,
  CoverageState,
  OperationCoverage,
} from "@apipilot/shared-domain";
import { COVERAGE_STATES } from "@apipilot/shared-domain";
import { makeMetric } from "./metrics";
import { assessGap, priorityForScore } from "./prioritize";

/** Per-operation facts the views need besides requirement states. */
export interface OperationInfo {
  operationKey: string;
  method: string;
  path: string;
  securityDeclared: boolean;
  constrainedFieldCount: number;
  groups: ReadonlySet<"positive" | "negative" | "boundary">;
}

export interface ViewInput {
  /** Requirements already restricted to `operations`. */
  requirements: CoverageRequirementResult[];
  operations: OperationInfo[];
  /** Counted scenarios of `operations` with their verdicts. */
  scenarios: CoverageScenarioResult[];
}

export interface Views {
  metrics: CoverageMetric[];
  operationCounts: CoverageOperationCounts;
  assertionOutcomes: { passed: number; failed: number; notEvaluated: number };
  operations: OperationCoverage[];
  gaps: CoverageGap[];
  recommendations: CoverageRecommendation[];
  categoryCoverage: CoverageCategoryCoverage[];
  unclassified: CoverageSnapshot["unclassified"];
}

const MAX_RECOMMENDATIONS = 20;

/** Severity used to pick the state that represents a gap holding several states. */
const STATE_SEVERITY: Record<CoverageState, number> = {
  "executed-failed": 0,
  "not-covered": 1,
  stale: 2,
  inconclusive: 3,
  "generated-not-executed": 4,
  verified: 5,
};

const KIND_NOUN: Record<CoverageDimensionKind, string> = {
  operation: "operation",
  parameter: "parameters",
  "parameter-case": "parameter cases",
  "request-schema": "request-schema elements",
  "response-code": "documented responses",
  "response-schema": "response schemas",
};

const CAUSE_TEXT: Record<CoverageCause, string> = {
  "assertion-failed": "assertion failed",
  "transport-error": "no response (transport error)",
  "check-not-evaluated": "a check could not be evaluated",
  "no-relevant-check": "no relevant check was evaluated",
  "request-edited": "the request was edited before the run",
  "blocked-by-dependency": "blocked by a failed dependency",
  "run-cancelled": "the run was cancelled",
  "not-reached": "the run ended before it was reached",
  "never-run": "never run",
  "not-in-selected-run": "not in the selected run",
};

const emptyStateCounts = (): Record<CoverageState, number> =>
  Object.fromEntries(COVERAGE_STATES.map((s) => [s, 0])) as Record<CoverageState, number>;

/** Requirement kinds counted toward an operation's own specification/runtime fraction (the happy path is shown separately). */
const OPERATION_FRACTION_KINDS: ReadonlySet<CoverageDimensionKind> = new Set([
  "parameter",
  "parameter-case",
  "request-schema",
  "response-code",
  "response-schema",
]);

const covered = (r: CoverageRequirementResult): boolean => r.state !== "not-covered";
const verified = (r: CoverageRequirementResult): boolean => r.state === "verified";

const emptyVerdicts = (): OperationCoverage["scenarioVerdicts"] => ({ passed: 0, failed: 0, inconclusive: 0, notExecuted: 0 });

/**
 * Recomputes the figures of one operation row from the requirements and scenarios in scope. Used for
 * the full snapshot and, with a category restriction, for filtered views, so both read the same
 * rules. Fields that do not depend on the scope (priority, missing, security) are kept from `row`.
 */
export function recomputeRow(
  row: OperationCoverage,
  requirements: readonly CoverageRequirementResult[],
  scenarios: readonly CoverageScenarioResult[],
): OperationCoverage {
  const fraction = requirements.filter((r) => OPERATION_FRACTION_KINDS.has(r.kind));
  const stateCounts = emptyStateCounts();
  for (const r of requirements) stateCounts[r.state] += 1;
  const scenarioVerdicts = emptyVerdicts();
  for (const s of scenarios) {
    if (s.verdict === "not-executed") scenarioVerdicts.notExecuted += 1;
    else scenarioVerdicts[s.verdict] += 1;
  }
  const assertions = { evaluated: 0, passed: 0, failed: 0, notEvaluated: 0 };
  for (const s of scenarios) {
    assertions.passed += s.assertions.passed;
    assertions.failed += s.assertions.failed;
    assertions.notEvaluated += s.assertions.notEvaluated;
    assertions.evaluated += s.assertions.passed + s.assertions.failed;
  }
  return {
    ...row,
    assertions,
    specification: { covered: fraction.filter(covered).length, total: fraction.length },
    runtime: { verified: fraction.filter(verified).length, total: fraction.length },
    failedCount: stateCounts["executed-failed"],
    stateCounts,
    scenarioVerdicts,
    scenarioCount: scenarios.length,
  };
}

/** OC1 to OC5 over the given operation rows (coverage-rules.md section 3). */
export function operationCountsFor(rows: readonly OperationCoverage[]): CoverageOperationCounts {
  const withScenarios = rows.filter((r) => r.scenarioCount > 0).length;
  return {
    eligible: rows.length,
    withScenarios,
    withPassingVerification: rows.filter((r) => r.scenarioVerdicts.passed > 0).length,
    withFailures: rows.filter((r) => r.scenarioVerdicts.failed > 0).length,
    withNoScenarios: rows.length - withScenarios,
  };
}

export function assertionOutcomesFor(rows: readonly OperationCoverage[]): { passed: number; failed: number; notEvaluated: number } {
  return rows.reduce(
    (sum, o) => ({
      passed: sum.passed + o.assertions.passed,
      failed: sum.failed + o.assertions.failed,
      notEvaluated: sum.notEvaluated + o.assertions.notEvaluated,
    }),
    { passed: 0, failed: 0, notEvaluated: 0 },
  );
}

export function metricsFor(
  requirements: CoverageRequirementResult[],
  counts: CoverageOperationCounts,
  assertions: { passed: number; failed: number },
): CoverageMetric[] {
  const ofKind = (kind: CoverageDimensionKind) => requirements.filter((r) => r.kind === kind);
  const count = (list: CoverageRequirementResult[], predicate: (r: CoverageRequirementResult) => boolean) =>
    list.filter(predicate).length;
  const params = ofKind("parameter");
  const schemas = ofKind("request-schema");
  const respSchemas = ofKind("response-schema");
  const codes = ofKind("response-code");
  const evaluated = assertions.passed + assertions.failed;
  return [
    makeMetric("spec-operations", "specification", "operation", "Operations", counts.withScenarios, counts.eligible,
      "Numerator: eligible operations with at least one counted (accepted or pending) generated scenario of any category. Denominator: eligible operations. An operation counted here can still have most of its requirements uncovered; read requirement-level coverage for completeness."),
    makeMetric("spec-parameters", "specification", "parameter", "Parameters", count(params, covered), params.length,
      "Numerator: documented path, query and header parameters exercised by a positive scenario. Denominator: documented parameters, path-level and operation-level merged with overrides counted once; cookie parameters are not measurable."),
    makeMetric("spec-request-schemas", "specification", "request-schema", "Request schemas", count(schemas, covered), schemas.length,
      "Numerator: measurable request-body elements (properties, required flags, types, enum values, formats, boundary values) with a mapped scenario. Denominator: all measurable request-body elements of the primary media type."),
    makeMetric("spec-response-schemas", "specification", "response-schema", "Response schemas", count(respSchemas, covered), respSchemas.length,
      "Numerator: documented response schemas with a scenario asserting both the response code and schema conformance. Denominator: documented responses that declare a schema."),
    makeMetric("spec-response-codes", "specification", "response-code", "Response codes", count(codes, covered), codes.length,
      "Numerator: documented response codes that a scenario expects exactly (ranges and default match only themselves). Denominator: documented response keys."),
    makeMetric("runtime-operations", "runtime", "operation", "Operations with passing verification", counts.withPassingVerification, counts.eligible,
      "Numerator: eligible operations with at least one scenario that passed (evaluated checks all passed, response received, request unedited). Denominator: eligible operations. Not a completeness measure: an operation can be here and also have failures or unexecuted requirements."),
    makeMetric("runtime-response-codes", "runtime", "response-code", "Response codes verified", count(codes, verified), codes.length,
      "Numerator: documented response codes whose expected-status check passed in an executed scenario. Denominator: documented response keys."),
    makeMetric("runtime-assertions", "runtime", "assertion", "Assertions evaluated and passed", assertions.passed, evaluated,
      "Numerator: assertions that passed in the evidence chosen for each scenario. Denominator: assertions actually evaluated there (not-evaluated, edited and no-response results are excluded and the not-evaluated count is shown beside it)."),
  ];
}

interface GapDraft {
  id: string;
  operationKey: string;
  kind: CoverageDimensionKind | "mixed";
  cause?: CoverageCause;
  members: CoverageRequirementResult[];
  /** Requirements of the same kind in the operation, for the "n of total" wording. */
  total: number;
  reason: (draft: GapDraft) => string;
}

const STATE_REASON: Partial<Record<CoverageState, string>> = {
  "generated-not-executed": "have generated scenarios that were not executed",
  "executed-failed": "have executed scenarios that failed a check",
  inconclusive: "have execution evidence too weak to verify them",
  stale: "have evidence that no longer matches their contract and need re-execution",
};

function causeReason(state: CoverageState, cause: CoverageCause | undefined, n: number): string {
  const suffix = cause !== undefined && state !== "executed-failed" ? ` (${CAUSE_TEXT[cause]})` : "";
  return `${n} requirements ${STATE_REASON[state] ?? "need attention"}${suffix}.`;
}

/**
 * Groups one operation's non-verified requirements into underlying gaps (FR-030): a single gap for
 * an operation with no scenario at all; otherwise one gap per shared state and cause (so a timeout
 * is never merged with an edited request) and one per kind for requirements that are not covered.
 */
function draftGaps(operationKey: string, requirements: CoverageRequirementResult[], scenarioCount: number): GapDraft[] {
  const unverified = requirements.filter((r) => !verified(r));
  if (unverified.length === 0) return [];
  if (scenarioCount === 0) {
    return [
      {
        id: `gap:${operationKey}:no-scenarios`,
        operationKey,
        kind: "operation",
        members: unverified,
        total: requirements.length,
        reason: (d) => `The operation has no generated scenario; ${d.members.length} requirements are not covered.`,
      },
    ];
  }
  const drafts = new Map<string, GapDraft>();
  const totals = new Map<CoverageDimensionKind, number>();
  for (const r of requirements) totals.set(r.kind, (totals.get(r.kind) ?? 0) + 1);
  for (const r of unverified) {
    const hasCause = r.state !== "not-covered";
    const key = hasCause ? `cause:${r.state}:${r.cause ?? ""}` : `kind:${r.kind}`;
    let draft = drafts.get(key);
    if (!draft) {
      draft = hasCause
        ? {
            id: `gap:${operationKey}:${r.state}${r.cause ? `:${r.cause}` : ""}`,
            operationKey,
            kind: "mixed",
            ...(r.cause !== undefined ? { cause: r.cause } : {}),
            members: [],
            total: 0,
            reason: (d) => causeReason(r.state, r.cause, d.members.length),
          }
        : {
            id: `gap:${operationKey}:${r.kind}`,
            operationKey,
            kind: r.kind,
            members: [],
            total: totals.get(r.kind) ?? 0,
            reason: (d) => `${d.members.length} of ${d.total} ${KIND_NOUN[r.kind]} have no generated scenario.`,
          };
      drafts.set(key, draft);
    }
    draft.members.push(r);
  }
  return [...drafts.values()];
}

export function recommendationsFor(gaps: CoverageGap[], requirements: CoverageRequirementResult[]): CoverageRecommendation[] {
  const byId = new Map(requirements.map((r) => [r.id, r]));
  return gaps.slice(0, MAX_RECOMMENDATIONS).map((gap, index) => {
    const members = gap.requirementIds.map((id) => byId.get(id)).filter((r): r is CoverageRequirementResult => r !== undefined);
    const first = members[0];
    const failedRef = members.flatMap((m) => m.evidence).find((e) => e.verdict === "failed");
    const scenarioIds = [...new Set(members.flatMap((m) => m.scenarioIds))].sort().slice(0, 5);
    const more = gap.requirementIds.length - 1;
    const action: CoverageRecommendation["action"] =
      gap.state === "not-covered"
        ? { type: "generate-scenario", scenarioIds: [] }
        : gap.state === "executed-failed" && failedRef
          ? { type: "open-result", scenarioIds, runId: failedRef.runId }
          : gap.state === "stale"
            ? { type: "re-run", scenarioIds }
            : { type: "review-scenario", scenarioIds };
    return {
      rank: index + 1,
      gapId: gap.id,
      operationKey: gap.operationKey,
      requirement: `${first?.label ?? gap.kind}${more > 0 ? ` (+${more} more)` : ""}`,
      why: gap.reason,
      evidence: gap.evidence,
      priority: gap.priority,
      rationale: `${gap.factors.map((f) => `${f.factor} +${f.points}`).join(", ")} = ${gap.score} (heuristic)`,
      action,
    };
  });
}

/**
 * Category coverage in classified testable requirements, never scenarios (coverage-rules.md 10).
 * The five state counts and `stale` partition `eligible`. Unclassified requirements are in no
 * category; security is unavailable because no scenario carries authorization intent.
 */
export function categoryCoverageFor(requirements: readonly CoverageRequirementResult[]): CoverageCategoryCoverage[] {
  const categoryCoverage: CoverageCategoryCoverage[] = (["positive", "negative", "boundary"] as const).map((group) => {
    const inGroup = requirements.filter((r) => r.group === group);
    const counts = emptyStateCounts();
    for (const r of inGroup) counts[r.state] += 1;
    return {
      group,
      available: inGroup.length > 0,
      eligible: inGroup.length,
      specCovered: inGroup.filter(covered).length,
      verified: counts.verified,
      counts,
      ...(inGroup.length === 0 ? { reason: "No eligible requirements of this category in the current scope." } : {}),
    };
  });
  categoryCoverage.push({
    group: "security",
    available: false,
    eligible: 0,
    specCovered: 0,
    verified: 0,
    counts: emptyStateCounts(),
    reason: "No scenario category identifies authorization intent, so security coverage cannot be measured.",
  });
  return categoryCoverage;
}

export function unclassifiedFor(requirements: readonly CoverageRequirementResult[], unclassifiedScenarios = 0): CoverageSnapshot["unclassified"] {
  return {
    requirements: requirements
      .filter((r) => r.group === "unclassified")
      .map((r) => ({ operationKey: r.operationKey, label: r.label }))
      .sort((a, b) => a.operationKey.localeCompare(b.operationKey) || a.label.localeCompare(b.label)),
    scenarios: unclassifiedScenarios,
  };
}

/** Derives every derived view from requirement states. Used for the full snapshot. */
export function buildViews(input: ViewInput): Views {
  const { requirements, operations, scenarios } = input;
  const byOperation = new Map<string, CoverageRequirementResult[]>();
  for (const r of requirements) {
    const list = byOperation.get(r.operationKey);
    if (list) list.push(r);
    else byOperation.set(r.operationKey, [r]);
  }
  const scenariosByOperation = new Map<string, CoverageScenarioResult[]>();
  for (const s of scenarios) {
    const list = scenariosByOperation.get(s.operationKey);
    if (list) list.push(s);
    else scenariosByOperation.set(s.operationKey, [s]);
  }

  const gaps: CoverageGap[] = [];
  for (const info of operations) {
    const scenarioCount = (scenariosByOperation.get(info.operationKey) ?? []).length;
    for (const draft of draftGaps(info.operationKey, byOperation.get(info.operationKey) ?? [], scenarioCount)) {
      const worst = [...draft.members].sort((x, y) => STATE_SEVERITY[x.state] - STATE_SEVERITY[y.state] || x.id.localeCompare(y.id))[0].state;
      const assessment = assessGap(info, draft.kind, worst);
      gaps.push({
        id: draft.id,
        operationKey: draft.operationKey,
        kind: draft.kind,
        ...(draft.cause !== undefined ? { cause: draft.cause } : {}),
        requirementIds: draft.members.map((m) => m.id).sort(),
        state: worst,
        reason: draft.reason(draft),
        categoryGroups: [...new Set(draft.members.map((m) => m.group).filter((g): g is "positive" | "negative" | "boundary" => g !== "unclassified"))].sort(),
        priority: assessment.priority,
        score: assessment.score,
        factors: assessment.factors,
        evidence: draft.members.flatMap((m) => m.evidence).slice(0, 3),
      });
    }
  }
  gaps.sort((a, b) => b.score - a.score || a.operationKey.localeCompare(b.operationKey) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

  const gapsByOp = new Map<string, CoverageGap[]>();
  for (const gap of gaps) {
    const list = gapsByOp.get(gap.operationKey);
    if (list) list.push(gap);
    else gapsByOp.set(gap.operationKey, [gap]);
  }

  const operationRows: OperationCoverage[] = operations.map((info) => {
    const opGaps = gapsByOp.get(info.operationKey) ?? [];
    const topScore = opGaps.reduce((max, g) => Math.max(max, g.score), -1);
    const priority: CoveragePriority = topScore < 0 ? "low" : priorityForScore(topScore);
    const base: OperationCoverage = {
      operationKey: info.operationKey,
      method: info.method,
      path: info.path,
      specification: { covered: 0, total: 0 },
      runtime: { verified: 0, total: 0 },
      failedCount: 0,
      stateCounts: emptyStateCounts(),
      scenarioVerdicts: emptyVerdicts(),
      scenarioCount: 0,
      missing: opGaps.slice(0, 4).map((g) => g.reason),
      priority,
      categoryGroups: [...info.groups].sort(),
      assertions: { evaluated: 0, passed: 0, failed: 0, notEvaluated: 0 },
      securityDeclared: info.securityDeclared,
    };
    return recomputeRow(base, byOperation.get(info.operationKey) ?? [], scenariosByOperation.get(info.operationKey) ?? []);
  });

  const operationCounts = operationCountsFor(operationRows);
  const assertionOutcomes = assertionOutcomesFor(operationRows);
  return {
    metrics: metricsFor(requirements, operationCounts, assertionOutcomes),
    operationCounts,
    assertionOutcomes,
    operations: operationRows,
    gaps,
    recommendations: recommendationsFor(gaps, requirements),
    categoryCoverage: categoryCoverageFor(requirements),
    unclassified: unclassifiedFor(requirements),
  };
}
