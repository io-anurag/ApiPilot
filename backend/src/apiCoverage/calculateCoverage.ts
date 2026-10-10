import type {
  ApiModel,
  CoverageNotice,
  CoverageRequirementResult,
  CoverageScenarioResult,
  CoverageSnapshot,
  ExecutionRun,
  ReviewState,
  TestScenario,
  UploadedCollectionExecutionRun,
} from "@apipilot/shared-domain";
import { toOperationKey } from "@apipilot/shared-domain";
import { itemIdForOAuth2TokenFetch } from "../postman/identifiers";
import { classifyRequirement, scenarioVerdictOf, type MappedScenario } from "./classify";
import { extractOperationElements, notMeasurableFromIssues, type OperationElements } from "./elements";
import { collectEvidence, type ScenarioEvidence } from "./evidence";
import { mapScenario, scenarioGroup } from "./scenarioMapping";
import { specificationRevision } from "./specRevision";
import { buildViews, type OperationInfo } from "./summarize";

/** One scenario of the current specification, with its review state and review-edit times. */
export interface CoverageScenario {
  scenario: TestScenario;
  reviewState: ReviewState;
  /** `recordedAt` of each review-step edit; used only for the informational "edited after run" note. */
  editedAt?: string[];
}

export interface CoverageInput {
  apiModel: ApiModel;
  workflowId: string;
  specificationFilename: string;
  /** `toOperationKey()` keys chosen at API review; absent means every operation is in scope. */
  selectedOperationKeys?: string[];
  scenarios: CoverageScenario[];
  uploadedRuns: UploadedCollectionExecutionRun[];
  guidedRuns: ExecutionRun[];
  runId?: string;
  /** Injected so the calculator never reads the clock. */
  now: Date;
}

const EVIDENCE_NOTICE =
  "Generated scenarios contribute to specification coverage. Runtime-verified coverage requires qualifying execution evidence.";

/** Fields declaring enum, format/pattern or boundary constraints: the contract-complexity input to prioritization. */
function constrainedFieldCount(elements: OperationElements): number {
  const fieldIds = new Set<string>();
  for (const r of elements.requirements) {
    if (/#(enum|format|boundary)/.test(r.id)) fieldIds.add(r.id.split("#")[0]);
  }
  return fieldIds.size;
}

/**
 * Assertions a scenario's chosen evidence evaluated. An edited request, a missing response or
 * stale evidence establishes nothing, so it contributes no evaluated assertion.
 */
function assertionCounts(evidence: ScenarioEvidence | undefined): CoverageScenarioResult["assertions"] {
  const counts = { passed: 0, failed: 0, notEvaluated: 0 };
  if (!evidence || evidence.edited || evidence.noResponse || evidence.stale) return counts;
  for (const check of evidence.checks) {
    if (check.outcome === "not-evaluated") counts.notEvaluated += 1;
    else if (check.outcome === "passed") counts.passed += 1;
    else counts.failed += 1;
  }
  return counts;
}

/** Every run the user may select, newest first; a run is listed even when none of its results joined. */
function availableRuns(input: CoverageInput): CoverageSnapshot["execution"]["availableRuns"] {
  const runs = [
    ...input.uploadedRuns.map((run) => ({ id: run.id, kind: "uploaded" as const, startedAt: run.startedAt, label: run.uploadedCollectionSnapshot.name })),
    ...input.guidedRuns
      .filter((run) => run.workflowId === input.workflowId)
      .map((run) => ({ id: run.id, kind: "guided" as const, startedAt: run.startedAt, label: run.environmentSnapshot.name })),
  ];
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id));
}

/**
 * Computes the full coverage snapshot. A pure function of its input (the clock is injected), so
 * identical input yields identical output apart from `calculatedAt` (FR-001, SC-005).
 */
export function calculateCoverage(input: CoverageInput): CoverageSnapshot {
  const { apiModel } = input;
  const selected = input.selectedOperationKeys !== undefined ? new Set(input.selectedOperationKeys) : undefined;
  const inScopeOps = apiModel.operations.filter((op) => selected === undefined || selected.has(toOperationKey(op)));
  const inScopeKeys = new Set(inScopeOps.map(toOperationKey));
  const outOfScopeOperations = apiModel.operations
    .map(toOperationKey)
    .filter((key) => !inScopeKeys.has(key))
    .sort();

  const elementsByOp = new Map<string, OperationElements>();
  for (const op of inScopeOps) elementsByOp.set(toOperationKey(op), extractOperationElements(op));

  // Rejected scenarios never count (clarified 2026-10-10); pending and accepted do.
  const counted = input.scenarios.filter((s) => s.reviewState !== "rejected");
  const countedById = new Map(counted.map((s) => [s.scenario.id, s.scenario]));
  const stateById = new Map(counted.map((s) => [s.scenario.id, s.reviewState]));

  const evidence = collectEvidence({
    scenarios: countedById,
    uploadedRuns: input.uploadedRuns,
    guidedRuns: input.guidedRuns,
    workflowId: input.workflowId,
    infrastructureItemIds: new Set(Object.keys(apiModel.securitySchemes).map(itemIdForOAuth2TokenFetch)),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
  });

  // Requirement -> mapped scenarios.
  const mappedByRequirement = new Map<string, MappedScenario[]>();
  for (const { scenario } of counted) {
    const elements = elementsByOp.get(toOperationKey({ method: scenario.operationMethod, path: scenario.operationPath }));
    if (!elements) continue;
    for (const mapping of mapScenario(elements, scenario)) {
      const list = mappedByRequirement.get(mapping.requirementId) ?? [];
      list.push({
        scenarioId: scenario.id,
        scope: mapping.scope,
        ...(mapping.responseCode !== undefined ? { responseCode: mapping.responseCode } : {}),
      });
      mappedByRequirement.set(mapping.requirementId, list);
    }
  }

  const requirements: CoverageRequirementResult[] = [];
  for (const elements of elementsByOp.values()) {
    for (const requirement of elements.requirements) {
      const mapped = (mappedByRequirement.get(requirement.id) ?? []).sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
      const classification = classifyRequirement(mapped, (id) => evidence.byScenario.get(id), evidence.missingCauseOf);
      const scenarioIds = [...new Set(mapped.map((m) => m.scenarioId))].sort();
      requirements.push({
        ...requirement,
        state: classification.state,
        ...(classification.cause !== undefined ? { cause: classification.cause } : {}),
        reason: classification.reason,
        tally: classification.tally,
        ...(classification.staleReason !== undefined ? { staleReason: classification.staleReason } : {}),
        ...(classification.staleSince !== undefined ? { staleSince: classification.staleSince } : {}),
        ...(classification.reExecutionRequired === true ? { reExecutionRequired: true } : {}),
        scenarioIds,
        acceptedCount: scenarioIds.filter((id) => stateById.get(id) === "accepted").length,
        pendingCount: scenarioIds.filter((id) => stateById.get(id) === "pending").length,
        evidence: classification.evidence,
      });
    }
  }

  const operations: OperationInfo[] = inScopeOps.map((op) => {
    const key = toOperationKey(op);
    const elements = elementsByOp.get(key) as OperationElements;
    return {
      operationKey: key,
      method: op.method,
      path: op.path,
      securityDeclared: op.security.length > 0,
      constrainedFieldCount: constrainedFieldCount(elements),
      groups: elements.groups,
    };
  });

  // Counted scenarios of in-scope operations with what the selected evidence says about each.
  const scenarioResults: CoverageScenarioResult[] = counted
    .filter(({ scenario }) => inScopeKeys.has(toOperationKey({ method: scenario.operationMethod, path: scenario.operationPath })))
    .map(({ scenario, reviewState }) => {
      const chosen = evidence.byScenario.get(scenario.id);
      const assertions = assertionCounts(chosen);
      const { verdict, cause } = scenarioVerdictOf(chosen);
      const resolvedCause = verdict === "not-executed" ? evidence.missingCauseOf(scenario.id) : cause;
      return {
        scenarioId: scenario.id,
        operationKey: toOperationKey({ method: scenario.operationMethod, path: scenario.operationPath }),
        group: scenarioGroup(scenario),
        reviewState: reviewState === "accepted" ? ("accepted" as const) : ("pending" as const),
        verdict,
        ...(resolvedCause !== undefined ? { cause: resolvedCause } : {}),
        ...(chosen ? { runId: chosen.runId } : {}),
        assertions,
      };
    })
    .sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));

  const views = buildViews({ requirements, operations, scenarios: scenarioResults });

  const notMeasurable = [
    ...[...elementsByOp.values()].flatMap((e) => e.notMeasurable),
    ...notMeasurableFromIssues(apiModel, inScopeKeys),
  ];

  const scenarioEditedAfterRun = counted
    .filter(({ scenario, editedAt }) => {
      const ev = evidence.byScenario.get(scenario.id);
      return ev !== undefined && (editedAt ?? []).some((t) => t > ev.startedAt);
    })
    .map(({ scenario }) => scenario.id)
    .sort();

  const scenarioCounts = {
    total: input.scenarios.length,
    accepted: input.scenarios.filter((s) => s.reviewState === "accepted").length,
    pending: input.scenarios.filter((s) => s.reviewState === "pending").length,
    rejected: input.scenarios.filter((s) => s.reviewState === "rejected").length,
    rule: input.scenarios.filter((s) => s.scenario.provenance.source === "RULE").length,
    ai: input.scenarios.filter((s) => s.scenario.provenance.source === "AI").length,
  };

  const notices: CoverageNotice[] = [{ code: "evidence", severity: "info", message: EVIDENCE_NOTICE }];
  if (counted.length === 0) {
    notices.push({ code: "no-scenarios", severity: "warning", message: "No tests have been generated for this specification, so nothing is covered yet." });
  } else if (evidence.byScenario.size === 0 && evidence.unattributedResults === 0) {
    notices.push({ code: "not-executed", severity: "info", message: `${counted.length} generated scenarios have not been executed, so no runtime verification exists yet.` });
  }
  if (evidence.unattributedResults > 0) {
    notices.push({
      code: "unattributed-results",
      severity: "warning",
      message: `${evidence.unattributedResults} execution results do not match any scenario of the current specification (possibly from an earlier specification) and are not counted as verified.`,
    });
  }
  if (evidence.editedResults > 0) {
    notices.push({ code: "edited-results", severity: "warning", message: `${evidence.editedResults} results came from requests edited before the run and are shown as inconclusive.` });
  }
  if (notMeasurable.length > 0) {
    notices.push({ code: "not-measurable", severity: "info", message: `${notMeasurable.length} contract elements or constructs cannot be reliably measured and are excluded from every denominator.` });
  }
  if (evidence.excludedRuns.length > 0) {
    notices.push({
      code: "excluded-runs",
      severity: "info",
      message: `${evidence.excludedRuns.length} run(s) ran in a different environment than the newest qualifying run and are not combined into these figures. Select a single run to evaluate one of them.`,
    });
  }
  if (evidence.infrastructureFailures > 0) {
    notices.push({
      code: "infrastructure-error",
      severity: "warning",
      message: `${evidence.infrastructureFailures} setup request(s) (for example a token fetch) failed. Requests that depend on them were not run and are reported as blocked, not as failed.`,
    });
  }
  notices.push({ code: "security-unavailable", severity: "info", message: "Security and authorization coverage is unavailable: no scenario category identifies authorization intent." });
  notices.push({ code: "response-detail-limited", severity: "info", message: "Response coverage is measured per documented status code and per whole-schema conformance check; individual response properties are not measured." });

  return {
    specification: {
      name: apiModel.info?.title ?? input.specificationFilename,
      ...(apiModel.info?.version !== undefined ? { version: apiModel.info.version } : {}),
      revision: specificationRevision(apiModel),
      operationCount: apiModel.operations.length,
    },
    context: { workflowId: input.workflowId, selectedOperationCount: inScopeOps.length, scenarioCounts },
    execution: {
      sources: evidence.sources,
      runIds: evidence.runIds,
      availableRuns: availableRuns(input),
      evidenceMode: evidence.mode,
      evidenceByRun: evidence.evidenceByRun,
      environments: evidence.environments,
      excludedRuns: evidence.excludedRuns,
      ...(evidence.selectedRunId !== undefined ? { selectedRunId: evidence.selectedRunId } : {}),
      ...(evidence.lastQualifyingExecutionAt !== undefined ? { lastQualifyingExecutionAt: evidence.lastQualifyingExecutionAt } : {}),
      ...(evidence.environment !== undefined ? { environment: evidence.environment } : {}),
      unattributedResults: evidence.unattributedResults,
      editedResults: evidence.editedResults,
    },
    metrics: views.metrics,
    operationCounts: views.operationCounts,
    assertionOutcomes: views.assertionOutcomes,
    operations: views.operations,
    scenarios: scenarioResults,
    requirements,
    gaps: views.gaps,
    recommendations: views.recommendations,
    notMeasurable,
    categoryCoverage: views.categoryCoverage,
    unclassified: views.unclassified,
    outOfScopeOperations,
    scenarioEditedAfterRun,
    notices,
    totals: { operations: views.operations.length, gaps: views.gaps.length },
    calculatedAt: input.now.toISOString(),
  };
}
