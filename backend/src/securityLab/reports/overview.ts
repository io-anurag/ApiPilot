import type {
  FindingStatus,
  ObservationClass,
  ScenarioDerivedFlags,
  SecurityOverview,
  SecurityReviewState,
  Severity,
} from "@apipilot/shared-domain";
import { FINDING_STATUSES, OBSERVATION_CLASSES, SECURITY_REVIEW_STATES, SEVERITIES } from "@apipilot/shared-domain";
import { specificationRevision } from "../../apiCoverage/specRevision";
import type { SecurityFindingRepository } from "../../persistence/securityFindingRepository";
import type { SecurityRunRepository } from "../../persistence/securityRunRepository";
import { analyzeSecurity } from "../analysis/analyzeSecurity";
import { flagResolver, getScope, type ScenarioContext } from "../scenarios/scenarioService";

/**
 * The Overview (specs/057 FR-060, SC-012). Every figure is derived from retained records and the specification
 * currently loaded, and every count has a matching list filter, so a number on the Overview and the list it opens
 * always agree. Potential risks (analysis observations, which prove nothing about a running service) and findings
 * (results of requests actually sent) are separate groups here and are never added together. Findings are counted,
 * and occurrences are counted beside them, never summed into them.
 */

const MAX_UNTESTED = 20;

export interface OverviewContext {
  readonly scenario: ScenarioContext;
  readonly findings: SecurityFindingRepository;
  readonly runs: SecurityRunRepository;
  readonly configuredSensitiveFields: readonly string[];
}

const zeroed = <K extends string>(keys: readonly K[]): Record<K, number> => Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;

export function buildOverview(context: OverviewContext): SecurityOverview {
  const { scenario } = context;
  const { repo, ownerId } = scenario;
  const model = scenario.workflow?.apiModel;

  const analysis = model ? analyzeSecurity(model, { configuredSensitiveFields: context.configuredSensitiveFields }) : undefined;
  const observationCounts = analysis ? { ...analysis.counts } : zeroed<ObservationClass>(OBSERVATION_CLASSES);

  const heads = repo.listHeads(ownerId, {});
  const resolve = flagResolver(scenario);
  const byCategory: Record<string, number> = {};
  const byReviewState = zeroed<SecurityReviewState>(SECURITY_REVIEW_STATES);
  const flagTotals = { stale: 0, orphaned: 0, blocked: 0, specificationNotLoaded: 0 };
  const tested = new Set<string>();

  for (const head of heads) {
    byCategory[head.categoryId] = (byCategory[head.categoryId] ?? 0) + 1;
    byReviewState[head.reviewState] += 1;
    if (head.executionStatus !== "not_run") tested.add(head.operationKey);
    const version = repo.getVersion(ownerId, head.id, head.currentVersion);
    if (!version) continue;
    const flags: ScenarioDerivedFlags = resolve(head, version);
    if (flags.stale) flagTotals.stale += 1;
    if (flags.orphaned) flagTotals.orphaned += 1;
    if (flags.blocked) flagTotals.blocked += 1;
    if (flags.specificationNotLoaded) flagTotals.specificationNotLoaded += 1;
  }

  const findings = context.findings.listAll(ownerId);
  const bySeverity = zeroed<Severity>(SEVERITIES);
  const byStatus = zeroed<FindingStatus>(FINDING_STATUSES);
  for (const finding of findings) {
    bySeverity[finding.severity.current] += 1;
    byStatus[finding.status] += 1;
  }

  // High priority = an operation the analysis flags as a potential risk or as sensitive (it changes state, handles an
  // identifier or sits under an administrative path). It is untested when no scenario of it has been run. The basis is
  // the analysis rule and its rationale, so a person can see why it is listed and challenge it.
  const untestedHighPriority: SecurityOverview["untestedHighPriority"] = [];
  if (analysis) {
    const seen = new Set<string>();
    for (const observation of [...analysis.observations].sort((a, b) => (a.operationKey ?? "").localeCompare(b.operationKey ?? ""))) {
      const key = observation.operationKey;
      if (!key || !isHighPriority(observation) || seen.has(key) || tested.has(key)) continue;
      seen.add(key);
      untestedHighPriority.push({ operationKey: key, basis: `${observation.ruleId}: ${observation.rationale}` });
      if (untestedHighPriority.length >= MAX_UNTESTED) break;
    }
  }

  const latest = context.runs.listRuns(ownerId)[0];
  return {
    specificationLoaded: model !== undefined,
    ...(model ? { specificationRevision: specificationRevision(model) } : {}),
    observationCounts,
    scenarioCounts: { total: heads.length, byCategory, byReviewState, ...flagTotals },
    ...(model ? { scope: scopeOf(scenario) } : {}),
    ...(latest ? { latestRun: { id: latest.id, startedAt: latest.startedAt, status: latest.status, summary: latest.summary } } : {}),
    findingCounts: {
      total: findings.length,
      bySeverity,
      byStatus,
      occurrences: findings.reduce((sum, finding) => sum + finding.occurrenceCount, 0),
      withUnreviewedOccurrence: findings.filter((finding) => finding.unreviewedOccurrence).length,
    },
    untestedHighPriority,
  };
}

function isHighPriority(observation: { classification: ObservationClass; ruleId: string }): boolean {
  return observation.classification === "potential-risk" || observation.ruleId === "sensitive-operation";
}

function scopeOf(context: ScenarioContext): NonNullable<SecurityOverview["scope"]> {
  const scope = getScope(context);
  return { mode: scope.mode, included: scope.selectedCount, excluded: scope.totalCount - scope.selectedCount };
}
