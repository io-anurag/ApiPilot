import type {
  CoverageCause,
  ExecutionRun,
  NotAttemptedReason,
  TestScenario,
  UploadedCollectionExecutionRun,
  UploadedRequestResult,
} from "@apipilot/shared-domain";
import { itemIdForScenario } from "../postman/identifiers";
import { assertionTestPlan } from "../postman/assertionScripts";

/** One check (assertion) of a scenario and what the run established about it. */
export interface EvidenceCheck {
  kind: "status-code" | "schema-conformance";
  expectedStatusCode?: string;
  outcome: "passed" | "failed" | "not-evaluated";
}

/**
 * What one execution result establishes about one scenario. Never carries headers, bodies, URLs or
 * `rawCapture` (FR-036): only identifiers, outcomes and timestamps.
 */
export interface ScenarioEvidence {
  scenarioId: string;
  runId: string;
  runKind: "uploaded" | "guided";
  itemId?: string;
  startedAt: string;
  outcome: "passed" | "failed";
  /** No HTTP response was received (connectivity failure or timeout): nothing was established. */
  noResponse: boolean;
  /** The request was edited before the run, so it may differ from the generated scenario. */
  edited: boolean;
  checks: EvidenceCheck[];
  /** Reserved: attributable evidence flagged for revalidation. No current rule sets it. */
  stale?: boolean;
  staleReason?: string;
  staleSince?: string;
}

export interface EvidenceInput {
  /** Current, non-rejected scenarios by id. */
  scenarios: ReadonlyMap<string, TestScenario>;
  uploadedRuns: readonly UploadedCollectionExecutionRun[];
  guidedRuns: readonly ExecutionRun[];
  workflowId: string;
  /** Item ids of generated infrastructure requests (for example OAuth2 token fetches): never "unattributed". */
  infrastructureItemIds: ReadonlySet<string>;
  /** Evaluate this run only instead of the latest qualifying run per scenario. */
  runId?: string;
}

interface Environment {
  name: string;
  tier: string;
}

export interface EvidenceResult {
  /** The chosen evidence per scenario: the latest qualifying result, or the selected run's. */
  byScenario: Map<string, ScenarioEvidence>;
  /** Runs that supplied the chosen evidence, newest first. */
  runIds: string[];
  /** How many scenarios take their evidence from each contributing run, newest run first. */
  evidenceByRun: { runId: string; scenarios: number }[];
  selectedRunId?: string;
  mode: "latest-per-scenario" | "single-run";
  sources: ("uploaded" | "guided")[];
  lastQualifyingExecutionAt?: string;
  environment?: Environment;
  /** Environments contributing to the evidence (at most one in latest-per-scenario mode). */
  environments: Environment[];
  /** Runs dropped from latest-per-scenario because they ran in a different environment (D-2). */
  excludedRuns: { runId: string; environment: Environment; reason: string }[];
  /** Executed results that join to no current scenario: never counted as verified. */
  unattributedResults: number;
  editedResults: number;
  /** Executed infrastructure requests (for example token fetches) that failed. Reported as a notice, never as a requirement failure. */
  infrastructureFailures: number;
  /** Why a counted scenario without evidence has none. */
  missingCauseOf: (scenarioId: string) => CoverageCause;
}

const NOT_ATTEMPTED_CAUSE: Record<NotAttemptedReason, CoverageCause> = {
  "dependency-not-met": "blocked-by-dependency",
  cancelled: "run-cancelled",
  "run-ended-before-reached": "not-reached",
};

function uploadedEvidence(scenario: TestScenario, run: UploadedCollectionExecutionRun, result: UploadedRequestResult): ScenarioEvidence {
  const noResponse = result.failureCategory === "connectivity-failure" || result.failureCategory === "timeout";
  const checks: EvidenceCheck[] = assertionTestPlan(scenario).map((entry) => {
    const test = result.testOutcomes.find((t) => t.name === entry.testName);
    return {
      kind: entry.assertion.type,
      ...(entry.assertion.expectedStatusCode !== undefined ? { expectedStatusCode: entry.assertion.expectedStatusCode } : {}),
      outcome: test ? test.outcome : "not-evaluated",
    };
  });
  return {
    scenarioId: scenario.id,
    runId: run.id,
    runKind: "uploaded",
    ...(result.itemId !== undefined ? { itemId: result.itemId } : {}),
    startedAt: result.startedAt,
    outcome: result.outcome === "failed" ? "failed" : "passed",
    noResponse,
    edited: result.wasEdited === true,
    checks,
  };
}

function guidedEvidence(scenario: TestScenario, run: ExecutionRun, result: ExecutionRun["results"][number]): ScenarioEvidence {
  const checks: EvidenceCheck[] = result.assertionOutcomes.map((outcome) => {
    const assertion = scenario.assertions[outcome.assertionIndex];
    return {
      kind: outcome.type,
      ...(assertion?.expectedStatusCode !== undefined ? { expectedStatusCode: assertion.expectedStatusCode } : {}),
      outcome: outcome.outcome === "could-not-evaluate" ? "not-evaluated" : outcome.outcome,
    };
  });
  return {
    scenarioId: scenario.id,
    runId: run.id,
    runKind: "guided",
    startedAt: result.startedAt,
    outcome: result.outcome === "failed" ? "failed" : "passed",
    noResponse: result.processingStage === "no-response",
    edited: false,
    checks,
  };
}

const environmentKey = (e: Environment): string => `${e.name}|${e.tier}`;
const isLater = (a: { startedAt: string; runId: string }, b: { startedAt: string; runId: string }): boolean =>
  a.startedAt > b.startedAt || (a.startedAt === b.startedAt && a.runId > b.runId);

interface Candidate {
  evidence: ScenarioEvidence;
  environment: Environment;
}

/**
 * Joins run results to current scenarios and picks the evidence that determines each scenario's
 * state (specs/046 research R3/R4, coverage-rules.md 8). The join is deterministic: uploaded
 * results by `itemId === itemIdForScenario(scenarioId)`, guided results by `scenarioId`. A
 * `not-attempted` result is never evidence, but its recorded reason is kept so an unexecuted
 * requirement can say why. A result that joins to no current scenario is counted, not used.
 *
 * Latest-per-scenario takes the newest attributable result per scenario, combining only runs from
 * the environment of the newest qualifying result (D-2); the others are returned as excluded. For
 * an uploaded run the only environment signal recorded is its collection name and tier.
 */
export function collectEvidence(input: EvidenceInput): EvidenceResult {
  const scenarioByItemId = new Map<string, TestScenario>();
  for (const scenario of input.scenarios.values()) scenarioByItemId.set(itemIdForScenario(scenario.id), scenario);

  const single = input.runId !== undefined;
  const candidates: Candidate[] = [];
  /** Scenarios with an attributable result in some run other than the selected one (single-run mode only). */
  const elsewhere = new Set<string>();
  const notAttempted = new Map<string, { cause: CoverageCause; startedAt: string }>();
  let unattributed = 0;
  let infrastructureFailures = 0;

  const noteNotAttempted = (scenarioId: string, reason: NotAttemptedReason | undefined, startedAt: string): void => {
    const cause = reason !== undefined ? NOT_ATTEMPTED_CAUSE[reason] : "not-reached";
    const previous = notAttempted.get(scenarioId);
    if (!previous || startedAt > previous.startedAt) notAttempted.set(scenarioId, { cause, startedAt });
  };

  for (const run of input.uploadedRuns) {
    const selected = !single || run.id === input.runId;
    const environment: Environment = { name: run.uploadedCollectionSnapshot.name, tier: run.uploadedCollectionSnapshot.tier };
    for (const result of run.results) {
      const scenario = result.itemId !== undefined ? scenarioByItemId.get(result.itemId) : undefined;
      if (result.outcome === "not-attempted") {
        if (scenario && selected) noteNotAttempted(scenario.id, result.notAttemptedReason, run.startedAt);
        continue;
      }
      if (!scenario) {
        const infrastructure = result.itemId !== undefined && input.infrastructureItemIds.has(result.itemId);
        if (infrastructure && selected && result.outcome === "failed") infrastructureFailures += 1;
        if (!infrastructure && selected) unattributed += 1;
        continue;
      }
      if (!selected) {
        elsewhere.add(scenario.id);
        continue;
      }
      candidates.push({ evidence: uploadedEvidence(scenario, run, result), environment });
    }
  }

  for (const run of input.guidedRuns) {
    if (run.workflowId !== input.workflowId) continue;
    const selected = !single || run.id === input.runId;
    const environment: Environment = { ...run.environmentSnapshot };
    for (const result of run.results) {
      const scenario = input.scenarios.get(result.scenarioId);
      if (result.outcome === "not-attempted") {
        if (scenario && selected) noteNotAttempted(scenario.id, result.notAttemptedReason, run.startedAt);
        continue;
      }
      if (!scenario) {
        if (selected) unattributed += 1;
        continue;
      }
      if (!selected) {
        elsewhere.add(scenario.id);
        continue;
      }
      candidates.push({ evidence: guidedEvidence(scenario, run, result), environment: { name: environment.name, tier: environment.tier } });
    }
  }

  // Latest-per-scenario combines only the environment of the newest qualifying result.
  let usable = candidates;
  const excludedRuns: EvidenceResult["excludedRuns"] = [];
  let newest: Candidate | undefined;
  for (const candidate of candidates) if (!newest || isLater(candidate.evidence, newest.evidence)) newest = candidate;
  if (!single && newest) {
    const keep = environmentKey(newest.environment);
    usable = candidates.filter((c) => environmentKey(c.environment) === keep);
    const dropped = new Map<string, Environment>();
    for (const c of candidates) if (environmentKey(c.environment) !== keep) dropped.set(c.evidence.runId, c.environment);
    for (const [runId, environment] of [...dropped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      excludedRuns.push({ runId, environment, reason: "different environment" });
    }
  }

  // Latest qualifying result per scenario; ties broken by run id so the choice is deterministic.
  const byScenario = new Map<string, ScenarioEvidence>();
  const environmentOf = new Map<string, Environment>();
  for (const { evidence, environment } of usable) {
    const current = byScenario.get(evidence.scenarioId);
    if (current === undefined || isLater(evidence, current)) {
      byScenario.set(evidence.scenarioId, evidence);
      environmentOf.set(evidence.runId, environment);
    }
  }

  const chosen = [...byScenario.values()];
  const perRun = new Map<string, { startedAt: string; count: number }>();
  for (const e of chosen) {
    const entry = perRun.get(e.runId) ?? { startedAt: e.startedAt, count: 0 };
    entry.count += 1;
    if (e.startedAt > entry.startedAt) entry.startedAt = e.startedAt;
    perRun.set(e.runId, entry);
  }
  const runOrder = [...perRun.entries()].sort((a, b) => (a[1].startedAt === b[1].startedAt ? a[0].localeCompare(b[0]) : b[1].startedAt.localeCompare(a[1].startedAt)));
  const last = chosen.reduce<ScenarioEvidence | undefined>((best, e) => (best === undefined || e.startedAt > best.startedAt ? e : best), undefined);
  const lastEnvironment = last ? environmentOf.get(last.runId) : undefined;
  const environments: Environment[] = [];
  for (const e of environmentOf.values()) if (!environments.some((x) => environmentKey(x) === environmentKey(e))) environments.push(e);
  const sources = [...new Set(chosen.map((e) => e.runKind))].sort();

  return {
    byScenario,
    runIds: runOrder.map(([id]) => id),
    evidenceByRun: runOrder.map(([runId, v]) => ({ runId, scenarios: v.count })),
    ...(input.runId !== undefined ? { selectedRunId: input.runId } : {}),
    mode: single ? "single-run" : "latest-per-scenario",
    sources,
    ...(last ? { lastQualifyingExecutionAt: last.startedAt } : {}),
    ...(lastEnvironment ? { environment: lastEnvironment } : {}),
    environments,
    excludedRuns,
    unattributedResults: unattributed,
    editedResults: chosen.filter((e) => e.edited).length,
    infrastructureFailures,
    missingCauseOf: (scenarioId) => {
      const reason = notAttempted.get(scenarioId);
      if (reason) return reason.cause;
      return single && elsewhere.has(scenarioId) ? "not-in-selected-run" : "never-run";
    },
  };
}
