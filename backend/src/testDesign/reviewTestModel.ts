import type {
  ApiModel,
  ApiOperation,
  ReviewDecision,
  ReviewEditContent,
  ReviewFinding,
  ReviewPolicy,
  ReviewScenario,
  ReviewSummary,
  ReviewUpdateOutcome,
  ReviewUpdateRequest,
  ReviewWorkspace,
  ReviewWorkspaceSnapshot,
  TestModel,
  TestScenario,
} from "@apipilot/shared-domain";
import { DEFAULT_REVIEW_POLICY } from "@apipilot/shared-domain";
import { dedupeKey } from "./deduplicate";
import { createLogger } from "../logger";
import { primaryRequestBodySchema, walkFields } from "./requestHelpers";

const logger = createLogger("testDesign.reviewTestModel");

/** Builds a fresh, all-pending review workspace from a generated TestModel (data-model.md: Review Workspace). */
export function createReviewWorkspace(
  testModel: TestModel,
  policy: ReviewPolicy = DEFAULT_REVIEW_POLICY,
): ReviewWorkspace {
  const scenarios: ReviewScenario[] = testModel.scenarios.map((scenario) => ({
    scenarioId: scenario.id,
    revision: 0,
    scenario,
    state: "pending",
    isUserModified: false,
    history: [],
  }));
  return {
    workspaceRevision: 0,
    scenarios,
    policy,
    summary: computeReviewSummary(scenarios, policy),
  };
}

/**
 * Reconstructs the review workspace for this stateless boundary: reuses a caller-observed
 * snapshot when supplied, otherwise starts a fresh all-pending workspace from `testModel`
 * (data-model.md: Review Workspace; contract: "updates may be empty to initialize a workspace").
 */
export function hydrateReviewWorkspace(
  testModel: TestModel,
  snapshot: ReviewWorkspaceSnapshot | undefined,
  policy: ReviewPolicy = DEFAULT_REVIEW_POLICY,
): ReviewWorkspace {
  if (!snapshot) return createReviewWorkspace(testModel, policy);
  return {
    workspaceRevision: snapshot.workspaceRevision,
    scenarios: snapshot.scenarios,
    policy,
    summary: computeReviewSummary(snapshot.scenarios, policy),
  };
}

function scenarioRequiresReview(scenario: ReviewScenario, policy: ReviewPolicy): boolean {
  const origin = scenario.isUserModified ? "USER" : scenario.scenario.provenance.source;
  return policy.originsRequiringReview.includes(origin);
}

/** Recomputes deterministic review counts from current scenario states (data-model.md: Review Summary). */
export function computeReviewSummary(
  scenarios: ReviewScenario[],
  policy: ReviewPolicy,
): ReviewSummary {
  let pending = 0;
  let accepted = 0;
  let rejected = 0;
  let requiresReview = 0;
  for (const scenario of scenarios) {
    if (scenario.state === "pending") pending += 1;
    else if (scenario.state === "accepted") accepted += 1;
    else rejected += 1;
    if (scenario.state === "pending" && scenarioRequiresReview(scenario, policy)) {
      requiresReview += 1;
    }
  }
  return { total: scenarios.length, pending, accepted, rejected, requiresReview };
}

function findReviewScenario(
  scenarios: ReviewScenario[],
  scenarioId: string,
): ReviewScenario | undefined {
  return scenarios.find((scenario) => scenario.scenarioId === scenarioId);
}

function findAcceptedDuplicate(
  scenarios: ReviewScenario[],
  target: ReviewScenario,
): ReviewScenario | undefined {
  const key = dedupeKey(target.scenario);
  return scenarios.find(
    (scenario) =>
      scenario.scenarioId !== target.scenarioId &&
      scenario.state === "accepted" &&
      dedupeKey(scenario.scenario) === key,
  );
}

function withScenarios(
  workspace: ReviewWorkspace,
  scenarios: ReviewScenario[],
): ReviewWorkspace {
  return {
    workspaceRevision: workspace.workspaceRevision + 1,
    scenarios,
    policy: workspace.policy,
    summary: computeReviewSummary(scenarios, workspace.policy),
  };
}

function notFoundOutcome(scenarioId: string, revision: number): ReviewUpdateOutcome {
  return {
    scenarioId,
    applied: false,
    revision,
    state: "pending",
    finding: {
      code: "scenario-not-found",
      message: "No scenario with this ID exists in the review workspace",
    },
  };
}

function staleOutcome(existing: ReviewScenario): ReviewUpdateOutcome {
  return {
    scenarioId: existing.scenarioId,
    applied: false,
    revision: existing.revision,
    state: existing.state,
    finding: {
      code: "stale-revision",
      message: "The submitted revision is stale; refresh the review workspace and retry",
    },
  };
}

function unappliedOutcome(
  existing: ReviewScenario,
  finding: ReviewFinding,
): ReviewUpdateOutcome {
  return {
    scenarioId: existing.scenarioId,
    applied: false,
    revision: existing.revision,
    state: existing.state,
    finding,
  };
}

/**
 * Applies one accept/reject decision to a single scenario, enforcing revision matching,
 * required rejection reasons, and duplicate-approved-scenario prevention (FR-006-FR-010).
 */
function applyOneUpdate(
  scenarios: ReviewScenario[],
  update: ReviewUpdateRequest,
  now: () => Date,
): { scenarios: ReviewScenario[]; outcome: ReviewUpdateOutcome } {
  const existing = findReviewScenario(scenarios, update.scenarioId);
  if (!existing) {
    return { scenarios, outcome: notFoundOutcome(update.scenarioId, update.revision) };
  }
  if (existing.revision !== update.revision) {
    return { scenarios, outcome: staleOutcome(existing) };
  }
  const trimmedReason = update.reason?.trim();
  if (update.action === "reject" && (!trimmedReason || trimmedReason.length === 0)) {
    return {
      scenarios,
      outcome: unappliedOutcome(existing, {
        code: "invalid-rejection-reason",
        message: "A non-empty rejection reason is required",
      }),
    };
  }
  const decisionState = update.action === "accept" ? "accepted" : "rejected";
  if (decisionState === "accepted") {
    const duplicate = findAcceptedDuplicate(scenarios, existing);
    if (duplicate) {
      return {
        scenarios,
        outcome: unappliedOutcome(existing, {
          code: "duplicate-scenario",
          message: `Equivalent to already-approved scenario ${duplicate.scenarioId}`,
        }),
      };
    }
  }
  const decision: ReviewDecision = {
    state: decisionState,
    reason: decisionState === "rejected" ? trimmedReason : trimmedReason || undefined,
    actor: update.actor,
    recordedAt: now().toISOString(),
    revision: existing.revision,
  };
  const updated: ReviewScenario = {
    ...existing,
    state: decisionState,
    decision,
    history: [...existing.history, { type: "decision", decision }],
  };
  logger.info("review_decision_applied", {
    scenarioId: updated.scenarioId,
    decision: decisionState,
    revision: updated.revision,
  });
  return {
    scenarios: scenarios.map((scenario) =>
      scenario.scenarioId === existing.scenarioId ? updated : scenario,
    ),
    outcome: {
      scenarioId: update.scenarioId,
      applied: true,
      revision: updated.revision,
      state: updated.state,
    },
  };
}

/** Applies an ordered list of accept/reject updates, one at a time, to a review workspace (FR-006-FR-009). */
export function applyReviewUpdates(
  workspace: ReviewWorkspace,
  updates: ReviewUpdateRequest[],
  now: () => Date = () => new Date(),
): { workspace: ReviewWorkspace; outcomes: ReviewUpdateOutcome[] } {
  let scenarios = workspace.scenarios;
  const outcomes: ReviewUpdateOutcome[] = [];
  let anyApplied = false;
  for (const update of updates) {
    const result = applyOneUpdate(scenarios, update, now);
    scenarios = result.scenarios;
    outcomes.push(result.outcome);
    if (result.outcome.applied) anyApplied = true;
  }
  const nextWorkspace = anyApplied
    ? withScenarios(workspace, scenarios)
    : { ...workspace, summary: computeReviewSummary(scenarios, workspace.policy) };
  return { workspace: nextWorkspace, outcomes };
}

/**
 * Projects only accepted, policy-eligible scenarios into an approved TestModel, defensively
 * deduplicating equivalent requests/assertions (FR-009, data-model.md: Validation Rules).
 */
export function projectApprovedTestModel(workspace: ReviewWorkspace): TestModel {
  const accepted = workspace.scenarios
    .filter((scenario) => scenario.state === "accepted")
    .map((scenario) => scenario.scenario);
  const seen = new Map<string, TestScenario>();
  for (const scenario of accepted) {
    const key = dedupeKey(scenario);
    if (!seen.has(key)) seen.set(key, scenario);
  }
  return { scenarios: [...seen.values()] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectUnknownBodyFieldPaths(
  value: Record<string, unknown>,
  schema: ReturnType<typeof primaryRequestBodySchema>,
  path: string,
  problems: string[],
): void {
  if (!schema) return;
  for (const [key, nestedValue] of Object.entries(value)) {
    const childSchema = schema.properties[key];
    if (!childSchema) {
      problems.push(`request references an unknown request-body field "${path}.${key}"`);
      continue;
    }
    if (isRecord(nestedValue)) {
      collectUnknownBodyFieldPaths(nestedValue, childSchema, `${path}.${key}`, problems);
    }
  }
}

/**
 * Validates an edited request/assertion pair against the operation's documented parameters,
 * request-body fields, and response contract (data-model.md: Review Edit validation).
 */
export function validateEditAgainstOperation(
  operation: ApiOperation,
  edit: ReviewEditContent,
): string[] {
  return [
    ...validateTargetField(operation, edit),
    ...validateParameterReferences(operation, edit),
    ...validateBodyFields(operation, edit),
    ...validateAssertionStatusCodes(operation, edit),
  ];
}

function validateTargetField(operation: ApiOperation, edit: ReviewEditContent): string[] {
  if (edit.targetLocation && edit.targetLocation !== "body") {
    const parameterExists = operation.parameters.some(
      (item) => item.location === edit.targetLocation && item.name === edit.targetField,
    );
    if (!parameterExists)
      return ["targetField does not match a documented operation parameter"];
    return [];
  }
  if (edit.targetLocation === "body") {
    const bodySchema = primaryRequestBodySchema(operation);
    const bodyFieldExists = Boolean(
      bodySchema &&
      edit.targetField &&
      [...walkFields(bodySchema)].some((field) => field.path === edit.targetField),
    );
    if (!bodyFieldExists)
      return ["targetField does not match a documented request-body field"];
    return [];
  }
  if (edit.targetField && !edit.targetLocation) {
    return ["targetField requires a targetLocation"];
  }
  return [];
}

function validateParameterReferences(
  operation: ApiOperation,
  edit: ReviewEditContent,
): string[] {
  const allowedParameters = new Map<string, Set<string>>();
  for (const parameter of operation.parameters) {
    const set = allowedParameters.get(parameter.location) ?? new Set<string>();
    set.add(parameter.name);
    allowedParameters.set(parameter.location, set);
  }
  const requestParameters: ["path" | "query" | "header", Record<string, unknown>][] = [
    ["path", edit.request.pathParameters],
    ["query", edit.request.queryParameters],
    ["header", edit.request.headers],
  ];
  const problems: string[] = [];
  for (const [location, values] of requestParameters) {
    for (const name of Object.keys(values)) {
      if (!allowedParameters.get(location)?.has(name)) {
        problems.push(`request references an unknown ${location} parameter "${name}"`);
      }
    }
  }
  return problems;
}

function validateBodyFields(operation: ApiOperation, edit: ReviewEditContent): string[] {
  const bodySchema = primaryRequestBodySchema(operation);
  const problems: string[] = [];
  if (bodySchema && isRecord(edit.request.body)) {
    collectUnknownBodyFieldPaths(edit.request.body, bodySchema, "request.body", problems);
  }
  return problems;
}

function validateAssertionStatusCodes(
  operation: ApiOperation,
  edit: ReviewEditContent,
): string[] {
  const problems: string[] = [];
  for (const assertion of edit.assertions) {
    const documented = operation.responses.some(
      (response) => response.statusCode === assertion.expectedStatusCode,
    );
    if (assertion.expectedStatusCode && !documented) {
      problems.push(
        `assertion uses an undocumented status code "${assertion.expectedStatusCode}"`,
      );
    }
  }
  return problems;
}

function findOperation(
  apiModel: ApiModel,
  scenario: TestScenario,
): ApiOperation | undefined {
  return apiModel.operations.find(
    (item) =>
      item.path === scenario.operationPath &&
      item.method.toUpperCase() === scenario.operationMethod.toUpperCase(),
  );
}

/**
 * Applies a validated edit, replacing the current scenario revision, resetting review state to
 * pending, and preserving prior history and provenance (FR-011-FR-014).
 */
export function applyReviewEdit(
  workspace: ReviewWorkspace,
  apiModel: ApiModel,
  scenarioId: string,
  revision: number,
  edit: ReviewEditContent,
  now: () => Date = () => new Date(),
): { workspace: ReviewWorkspace; outcome: ReviewUpdateOutcome } {
  const existing = findReviewScenario(workspace.scenarios, scenarioId);
  if (!existing) {
    return { workspace, outcome: notFoundOutcome(scenarioId, revision) };
  }
  if (existing.revision !== revision) {
    return { workspace, outcome: staleOutcome(existing) };
  }
  const operation = findOperation(apiModel, existing.scenario);
  const problems = operation
    ? validateEditAgainstOperation(operation, edit)
    : ["scenario operation is not defined in the supplied ApiModel"];
  if (problems.length > 0) {
    return {
      workspace,
      outcome: unappliedOutcome(existing, {
        code: "invalid-edit",
        message: problems.join("; "),
      }),
    };
  }
  const nextRevision = existing.revision + 1;
  const editedScenario: TestScenario = {
    ...existing.scenario,
    request: edit.request,
    assertions: edit.assertions,
    targetLocation: edit.targetLocation,
    targetField: edit.targetField,
  };
  const updated: ReviewScenario = {
    ...existing,
    revision: nextRevision,
    scenario: editedScenario,
    state: "pending",
    decision: undefined,
    isUserModified: true,
    history: [
      ...existing.history,
      {
        type: "edit",
        revision: nextRevision,
        recordedAt: now().toISOString(),
        previousProvenance: existing.scenario.provenance,
      },
    ],
  };
  const scenarios = workspace.scenarios.map((scenario) =>
    scenario.scenarioId === existing.scenarioId ? updated : scenario,
  );
  return {
    workspace: withScenarios(workspace, scenarios),
    outcome: { scenarioId, applied: true, revision: nextRevision, state: "pending" },
  };
}

/**
 * Validates a regeneration request without contacting the AI provider: confirms the scenario
 * exists, the revision matches, and the scenario is AI-derived (data-model.md: Regeneration Request).
 */
export function beginRegeneration(
  workspace: ReviewWorkspace,
  scenarioId: string,
  revision: number,
): { existing: ReviewScenario } | { error: ReviewUpdateOutcome } {
  const existing = findReviewScenario(workspace.scenarios, scenarioId);
  if (!existing) return { error: notFoundOutcome(scenarioId, revision) };
  if (existing.revision !== revision) return { error: staleOutcome(existing) };
  if (existing.scenario.provenance.source !== "AI") {
    return {
      error: unappliedOutcome(existing, {
        code: "invalid-edit",
        message: "Only AI-derived scenarios can be regenerated",
      }),
    };
  }
  return { existing };
}

/**
 * Applies a validated AI replacement scenario as a new pending revision, preserving prior
 * history and original provenance (FR-015-FR-016).
 */
export function applyRegeneratedScenario(
  workspace: ReviewWorkspace,
  scenarioId: string,
  replacement: TestScenario,
  now: () => Date = () => new Date(),
): { workspace: ReviewWorkspace; outcome: ReviewUpdateOutcome } {
  const existing = findReviewScenario(workspace.scenarios, scenarioId);
  if (!existing) {
    return { workspace, outcome: notFoundOutcome(scenarioId, 0) };
  }
  const nextRevision = existing.revision + 1;
  const updated: ReviewScenario = {
    ...existing,
    revision: nextRevision,
    scenario: { ...replacement, id: existing.scenarioId },
    state: "pending",
    decision: undefined,
    isUserModified: false,
    history: [
      ...existing.history,
      {
        type: "regeneration",
        revision: nextRevision,
        recordedAt: now().toISOString(),
        previousProvenance: existing.scenario.provenance,
      },
    ],
  };
  const scenarios = workspace.scenarios.map((scenario) =>
    scenario.scenarioId === scenarioId ? updated : scenario,
  );
  return {
    workspace: withScenarios(workspace, scenarios),
    outcome: { scenarioId, applied: true, revision: nextRevision, state: "pending" },
  };
}

/** Builds a regeneration failure outcome without mutating the workspace (FR-016). */
export function regenerationFailureOutcome(
  existing: ReviewScenario,
  message: string,
): ReviewUpdateOutcome {
  return unappliedOutcome(existing, { code: "invalid-edit", message });
}
