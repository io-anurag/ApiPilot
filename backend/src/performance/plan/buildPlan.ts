import type { BodyEdit, ParameterEdit, PerformancePlan, PerformanceThreshold, TestGenerationWorkflow } from "@apipilot/shared-domain";
import { createLogger } from "../../logger";
import { compareCodeUnits } from "../../postman/ordering";
import { bodyEditNoticesOf } from "./bodyEdits";
import { buildJourneys } from "./buildJourneys";
import { stepsNeedingExpectedStatus, withSources, prefillExpectedStatuses } from "./expectedStatuses";
import { canonicalJson, sha256Hex } from "./identifiers";
import { startingProfile } from "./loadProfiles";
import { operationKeyOf, planAuth, type AuthPlan, type PerformanceContext } from "./stepRequest";
import { listUserSuppliedValues } from "./userSuppliedValues";

const logger = createLogger("performancePlan");

/**
 * Builds and rebuilds the Performance Plan (specs/031-k6-performance-testing data-model.md,
 * research D1, D5, D26). Pure over the workflow state it is given; no values are read.
 */

/** The plan's inputs from the guided workflow. Requires Postman generation to be complete. */
export function contextFromWorkflow(workflow: TestGenerationWorkflow): PerformanceContext {
  if (!workflow.apiModel || !workflow.approvedTestModel) {
    throw new Error("A performance plan needs an analyzed specification and an approved test model.");
  }
  const approved = new Set(workflow.approvedWorkflowIds ?? []);
  return {
    apiModel: workflow.apiModel,
    approvedScenarios: workflow.approvedTestModel.scenarios,
    workflows: (workflow.dependencyAnalysis?.workflows ?? []).filter((candidate) => approved.has(candidate.id)),
    relationships: workflow.dependencyAnalysis?.graph.relationships ?? [],
    selectedOperationKeys: workflow.selectedOperationKeys,
    source: "guided",
  };
}

/**
 * Over the approvals the plan was built from: the approved scenarios (their content, not only
 * their ids, since a revised scenario keeps its id), the approved workflows and the selection.
 * A mismatch on the next read rebuilds the plan (D1).
 */
export function upstreamFingerprint(context: PerformanceContext): string {
  return sha256Hex(
    canonicalJson({
      scenarios: [...context.approvedScenarios].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      workflows: context.workflows,
      selectedOperationKeys: context.selectedOperationKeys ?? null,
    }),
  );
}

/**
 * The out-of-date check (FR-023): every plan field that changes the script, plus the upstream
 * fingerprint, so a revised scenario with an unchanged id still makes a script out of date.
 * `stepsNeedingExpectedStatus` and `credentialProducerOperationKeys` are derived and excluded, as
 * are AP-033's `bodyEditNotices`, `discardedBodyEdits` and `discardedParameterEdits`. `bodyEdits`
 * and `parameterEdits` count only when not empty, so a plan without edits keeps the fingerprint it
 * had before AP-033 (specs/033 research R10).
 */
export function planFingerprint(
  plan: Omit<
    PerformancePlan,
    | "fingerprint"
    | "stepsNeedingExpectedStatus"
    | "credentialProducerOperationKeys"
    | "bodyEditNotices"
    | "discardedBodyEdits"
    | "discardedParameterEdits"
  >,
): string {
  return sha256Hex(
    canonicalJson({
      source: plan.source,
      excludedOperationKeys: plan.excludedOperationKeys,
      omitted: plan.omitted,
      journeys: plan.journeys,
      thinkTimeMs: plan.thinkTimeMs,
      loadProfile: plan.loadProfile,
      thresholds: plan.thresholds,
      userSuppliedValues: plan.userSuppliedValues,
      uniqueValueFields: plan.uniqueValueFields,
      upstreamFingerprint: plan.upstreamFingerprint,
      ...(plan.bodyEdits.length > 0 ? { bodyEdits: plan.bodyEdits } : {}),
      ...(plan.parameterEdits.length > 0 ? { parameterEdits: plan.parameterEdits } : {}),
    }),
  );
}

/** Recomputes the derived fields after any change. */
export function finalizePlan(plan: Omit<PerformancePlan, "fingerprint" | "stepsNeedingExpectedStatus">): PerformancePlan {
  return {
    ...plan,
    fingerprint: planFingerprint(plan),
    stepsNeedingExpectedStatus: stepsNeedingExpectedStatus(plan.journeys),
  };
}

export interface PlanChoices {
  excludedOperationKeys: string[];
  thinkTimeMs: number;
  loadProfile: PerformancePlan["loadProfile"];
  thresholds: PerformanceThreshold[];
  /** Expected-status codes per step id, kept for steps that still exist (D26). */
  expectedStatusCodes: Map<string, string[]>;
  /** Journey and step order the user chose, kept where the same ids still exist (US4). */
  journeyOrder?: string[];
  stepOrder?: Map<string, string[]>;
  /** AP-033: the engineer's body edits (specs/033 research R2, R9). */
  bodyEdits: BodyEdit[];
  /** AP-033 FR-018: carried until the next plan edit or rebuild. */
  discardedBodyEdits?: string[];
  /** AP-033 FR-020 (amended 2026-09-30): kept and discarded as body edits are. */
  parameterEdits: ParameterEdit[];
  discardedParameterEdits?: string[];
}

/**
 * AP-033 FR-018 (specs/033 research R9): an edit is kept while its step exists with the scenario it
 * was made for, or while its operation is removed. Step ids are content-derived, so a restored
 * operation gets the same step id, and its edit, back.
 */
function keptEdits<T extends { stepId: string; operationKey: string }>(edits: readonly T[], editedStepIds: ReadonlySet<string>, excluded: ReadonlySet<string>): T[] {
  return edits
    .filter((edit) => editedStepIds.has(edit.stepId) || excluded.has(edit.operationKey))
    .sort((a, b) => compareCodeUnits(a.stepId, b.stepId));
}

/**
 * AP-032 FR-003a (specs/032-quick-performance-test research Q5): the login operations the plan's
 * chained-login token sources call, as the existing credential producers identify them. Nothing is
 * guessed by name or path.
 */
function credentialProducerOperationKeys(auth: AuthPlan): string[] {
  const keys = [...auth.tokenSources.values()].flatMap((source) => (source.producerOperationKey ? [source.producerOperationKey] : []));
  return [...new Set(keys)].sort(compareCodeUnits);
}

function defaultChoices(context: PerformanceContext): PlanChoices {
  return {
    // A quick plan starts with its credential producers removed, so a login is not sent by every
    // virtual user on every iteration; the user can restore it (FR-003a, FR-014). A guided plan
    // starts with nothing removed, as in AP-029.
    excludedOperationKeys: context.source === "quick" ? credentialProducerOperationKeys(planAuth(context)) : [],
    thinkTimeMs: 0,
    loadProfile: startingProfile("smoke"),
    thresholds: [],
    expectedStatusCodes: new Map(),
    bodyEdits: [],
    parameterEdits: [],
  };
}

/** Builds a plan from the context and the user's choices. */
export function assemblePlan(context: PerformanceContext, choices: PlanChoices): PerformancePlan {
  const auth = planAuth(context);
  const knownKeys = new Set(context.apiModel.operations.map((operation) => operationKeyOf(operation)));
  const excludedOperationKeys = [...new Set(choices.excludedOperationKeys.filter((key) => knownKeys.has(key)))].sort();
  const built = buildJourneys(
    context,
    auth,
    new Set(excludedOperationKeys),
    new Map(choices.bodyEdits.map((edit) => [edit.stepId, edit])),
    new Map(choices.parameterEdits.map((edit) => [edit.stepId, edit])),
  );
  const operationsByKey = new Map(context.apiModel.operations.map((operation) => [operationKeyOf(operation), operation]));

  let journeys = built.journeys.map((journey) => ({
    ...journey,
    steps: journey.steps.map((step) => {
      const kept = choices.expectedStatusCodes.get(step.id);
      const operation = operationsByKey.get(step.operationKey);
      if (!kept || !operation) return step;
      return { ...step, expectedStatuses: withSources(kept, prefillExpectedStatuses(operation)) };
    }),
  }));
  if (choices.stepOrder) {
    journeys = journeys.map((journey) => {
      const order = choices.stepOrder?.get(journey.id);
      if (!order || order.length !== journey.steps.length) return journey;
      const byId = new Map(journey.steps.map((step) => [step.id, step]));
      const reordered = order.map((id) => byId.get(id));
      return reordered.every(Boolean) ? { ...journey, steps: reordered as typeof journey.steps } : journey;
    });
  }
  if (choices.journeyOrder) {
    const rank = new Map(choices.journeyOrder.map((id, index) => [id, index]));
    const known = journeys.filter((journey) => rank.has(journey.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    const added = journeys.filter((journey) => !rank.has(journey.id));
    journeys = [...known, ...added];
  }

  const stepIds = new Set(journeys.flatMap((journey) => journey.steps.map((step) => step.id)));
  const editedStepIds = new Set(journeys.flatMap((journey) => journey.steps.filter((step) => step.bodyEdited).map((step) => step.id)));
  const parameterEditedStepIds = new Set(journeys.flatMap((journey) => journey.steps.filter((step) => step.parametersEdited).map((step) => step.id)));
  const thresholds = choices.thresholds.filter((threshold) => threshold.scope.kind === "run" || stepIds.has(threshold.scope.stepId));
  const uniqueValueFields = built.uniqueValueFields.filter((field) => stepIds.has(field.stepId));
  const plan = finalizePlan({
    source: context.source,
    excludedOperationKeys,
    omitted: built.omitted,
    journeys,
    thinkTimeMs: choices.thinkTimeMs,
    loadProfile: choices.loadProfile,
    thresholds,
    userSuppliedValues: listUserSuppliedValues(journeys, built.requests, auth),
    uniqueValueFields,
    upstreamFingerprint: upstreamFingerprint(context),
    credentialProducerOperationKeys: credentialProducerOperationKeys(auth),
    bodyEdits: keptEdits(choices.bodyEdits, editedStepIds, new Set(excludedOperationKeys)),
    bodyEditNotices: bodyEditNoticesOf(journeys, built.requests, uniqueValueFields, built.generatedUniqueFields),
    discardedBodyEdits: choices.discardedBodyEdits ?? [],
    parameterEdits: keptEdits(choices.parameterEdits, parameterEditedStepIds, new Set(excludedOperationKeys)),
    discardedParameterEdits: choices.discardedParameterEdits ?? [],
  });
  logger.info("performance_plan_built", {
    planSource: plan.source,
    journeyCount: plan.journeys.length,
    stepCount: plan.journeys.reduce((total, journey) => total + journey.steps.length, 0),
    bodyEditCount: plan.bodyEdits.length,
    parameterEditCount: plan.parameterEdits.length,
  });
  return plan;
}

/** The proposed plan for fresh approvals (FR-006): smoke profile, no thresholds, no think time. */
export function buildPlan(context: PerformanceContext): PerformancePlan {
  return assemblePlan(context, defaultChoices(context));
}

/** Rebuilds from the current approvals, keeping the user's choices that still apply (D26). */
export function rebuildPlan(previous: PerformancePlan, context: PerformanceContext, options: { keepOrder: boolean }): PerformancePlan {
  const expectedStatusCodes = new Map(
    previous.journeys.flatMap((journey) => journey.steps.map((step) => [step.id, step.expectedStatuses.map((status) => status.code)] as const)),
  );
  const rebuilt = assemblePlan(context, {
    excludedOperationKeys: previous.excludedOperationKeys,
    thinkTimeMs: previous.thinkTimeMs,
    loadProfile: previous.loadProfile,
    thresholds: previous.thresholds,
    expectedStatusCodes: new Map([...expectedStatusCodes].filter(([, codes]) => codes.length > 0)),
    bodyEdits: previous.bodyEdits,
    parameterEdits: previous.parameterEdits ?? [],
    ...(options.keepOrder
      ? {
          journeyOrder: previous.journeys.map((journey) => journey.id),
          stepOrder: new Map(previous.journeys.map((journey) => [journey.id, journey.steps.map((step) => step.id)])),
        }
      : {}),
  });
  // AP-033 FR-018: name the operations whose edit could not be kept, because their step is gone or
  // now uses a different scenario. Not fingerprinted, so it is set after assembly.
  const kept = new Set(rebuilt.bodyEdits.map((edit) => edit.stepId));
  const discarded = [...new Set(previous.bodyEdits.filter((edit) => !kept.has(edit.stepId)).map((edit) => edit.operationKey))].sort(compareCodeUnits);
  const keptParameters = new Set(rebuilt.parameterEdits.map((edit) => edit.stepId));
  const discardedParameters = [
    ...new Set((previous.parameterEdits ?? []).filter((edit) => !keptParameters.has(edit.stepId)).map((edit) => edit.operationKey)),
  ].sort(compareCodeUnits);
  return { ...rebuilt, discardedBodyEdits: discarded, discardedParameterEdits: discardedParameters };
}

/** The choices a plan currently carries, for re-assembly after an edit. */
export function choicesOf(plan: PerformancePlan): PlanChoices {
  return {
    excludedOperationKeys: plan.excludedOperationKeys,
    thinkTimeMs: plan.thinkTimeMs,
    loadProfile: plan.loadProfile,
    thresholds: plan.thresholds,
    expectedStatusCodes: new Map(
      plan.journeys.flatMap((journey) =>
        journey.steps.filter((step) => step.expectedStatuses.length > 0).map((step) => [step.id, step.expectedStatuses.map((s) => s.code)] as const),
      ),
    ),
    journeyOrder: plan.journeys.map((journey) => journey.id),
    stepOrder: new Map(plan.journeys.map((journey) => [journey.id, journey.steps.map((step) => step.id)])),
    bodyEdits: plan.bodyEdits,
    discardedBodyEdits: plan.discardedBodyEdits,
    // A plan held from before the amendment has no parameter-edit fields.
    parameterEdits: plan.parameterEdits ?? [],
    discardedParameterEdits: plan.discardedParameterEdits ?? [],
  };
}
