import type {
  ApiOperation,
  BodyEdit,
  BodyEditNotice,
  Capture,
  OmittedOperation,
  ParameterEdit,
  PerformanceJourney,
  PerformanceStep,
  StepDependency,
  StepVariableBinding,
  TestScenario,
  UniqueValueField,
  UserJourneyDefinition,
  UserJourneyStepDefinition,
  ValueBinding,
  WorkflowVariable,
} from "@apipilot/shared-domain";
import { workflowVariableName } from "../../postman/workflowRendering";
import { parseCapturePath, valueAtPath } from "./capturePath";
import { documentedResponseFields } from "./responseFields";
import { compareCodeUnits } from "../../postman/ordering";
import { effectiveScenario, engineerReferences } from "./bodyEdits";
import { withSources, prefillExpectedStatuses } from "./expectedStatuses";
import { applyParameterEdit, editedPathParameters, parameterEditReferences } from "./parameterEdits";
import { journeyIdFor, stepIdFor } from "./identifiers";
import { selectPerformanceScenario, type PerformanceScenarioSelection } from "./selectScenario";
import {
  buildStepRequest,
  captureKeyOf,
  isDocumentedParameter,
  operationKeyOf,
  type AuthPlan,
  type BuiltStepRequest,
  type ConsumedValue,
  type PerformanceContext,
} from "./stepRequest";
import { uniqueValueCandidates } from "./uniqueValueFields";

/**
 * FR-006 (specs/031-k6-performance-testing research D5): each approved workflow becomes one
 * journey with its steps in position order, and each other operation in scope a single-step
 * journey, ordered by method then path. A workflow becomes a journey only when every one of its
 * operations is in scope, not removed, and has a positive scenario; otherwise its consumer could
 * not receive its value, so its operations are planned as single-step journeys instead.
 */
export interface BuiltJourneys {
  journeys: PerformanceJourney[];
  omitted: OmittedOperation[];
  uniqueValueFields: UniqueValueField[];
  /** Built requests by step id, for listing user-supplied values (D6). */
  requests: Map<string, BuiltStepRequest>;
  /** AP-033: the unique-field candidates of each edited step's generated body, for FR-010 notices. */
  generatedUniqueFields: Map<string, string[]>;
  /** AP-035: the definitions with their derived fields (`documented`, `state`) recomputed. */
  userJourneys: UserJourneyDefinition[];
  /** AP-035 FR-016: step ids with a binding whose target no longer exists. */
  bindingsNeedingAttention: string[];
  /** AP-035 FR-013: bindings a body edit removed the field of. */
  droppedBindingNotices: BodyEditNotice[];
}

/** AP-035 inputs to `buildJourneys` (research R1, R4). */
export interface UserJourneyChoices {
  userJourneys: readonly UserJourneyDefinition[];
  alsoStandalone: readonly string[];
}

/** What `makeStep` reads and fills for one `buildJourneys` call. */
interface StepBuild {
  bodyEdits: ReadonlyMap<string, BodyEdit>;
  /** AP-033 FR-020 (amended 2026-09-30). */
  parameterEdits: ReadonlyMap<string, ParameterEdit>;
  uniqueValueFields: UniqueValueField[];
  requests: Map<string, BuiltStepRequest>;
  generatedUniqueFields: Map<string, string[]>;
}

/** AP-033 (specs/033 research R3, R9): an edit applies only to the step and scenario it was made for. */
function appliedEdit<T extends { scenarioId: string }>(edits: ReadonlyMap<string, T>, stepId: string, scenario: TestScenario): T | undefined {
  const edit = edits.get(stepId);
  return edit?.scenarioId === scenario.id ? edit : undefined;
}

interface Candidate {
  operation: ApiOperation;
  selection: Extract<PerformanceScenarioSelection, { scenario: TestScenario }>;
}

/**
 * The operations in scope (AP-032 FR-022, replacing AP-029 FR-001): the guided workflow's API
 * review selection, or every analyzed operation when none was made. A quick plan's context has no
 * selection, so it covers every operation (FR-003). Only these can be listed as left out (FR-023).
 */
export function operationsInScope(context: PerformanceContext): ApiOperation[] {
  const selected = context.selectedOperationKeys ? new Set(context.selectedOperationKeys) : undefined;
  return context.apiModel.operations.filter((operation) => !selected || selected.has(operationKeyOf(operation)));
}

function dependencyFor(
  context: PerformanceContext,
  variables: WorkflowVariable[],
  stepIndex: number,
): StepDependency | null {
  const relationshipIds = [
    ...new Set(
      variables
        .filter((variable) => variable.producerStepIndex === stepIndex || variable.consumerStepIndex === stepIndex)
        .map((variable) => variable.relationshipId),
    ),
  ].sort(compareCodeUnits);
  if (relationshipIds.length === 0) return null;
  const likely = relationshipIds.some(
    (id) => context.relationships.find((relationship) => relationship.id === id)?.confidence === "LIKELY",
  );
  return { relationshipIds, confidence: likely ? "LIKELY" : "CONFIRMED" };
}

/** How one step is wired to the other steps of its journey. */
interface StepLinks {
  consumed: ConsumedValue[];
  variableBindings: StepVariableBinding[];
  produces: string[];
  consumes: string[];
  dependency: StepDependency | null;
  /** AP-035: present on a step of a user-defined journey. */
  user?: { captures: Capture[]; bindings: ValueBinding[] };
}

const NO_LINKS: StepLinks = { consumed: [], variableBindings: [], produces: [], consumes: [], dependency: null };

function workflowLinks(
  context: PerformanceContext,
  workflow: { id: string; variables: WorkflowVariable[]; stepIndex: number; stepIds: string[] },
): StepLinks {
  const produces = workflow.variables.filter((variable) => variable.producerStepIndex === workflow.stepIndex);
  const consumes = workflow.variables.filter((variable) => variable.consumerStepIndex === workflow.stepIndex);
  return {
    consumed: consumes.map((variable) => ({
      key: workflowVariableName(workflow.id, variable.name),
      name: variable.name,
      location: variable.consumerLocation,
      field: variable.consumerField,
    })),
    variableBindings: [
      ...produces.map((variable): StepVariableBinding => ({ variable: variable.name, role: "produces", field: variable.producerField })),
      ...consumes.map(
        (variable): StepVariableBinding => ({
          variable: variable.name,
          role: "consumes",
          field: variable.consumerField,
          location: variable.consumerLocation,
          producerStepId: workflow.stepIds[variable.producerStepIndex],
        }),
      ),
    ],
    produces: produces.map((variable) => variable.name),
    consumes: consumes.map((variable) => variable.name),
    dependency: dependencyFor(context, workflow.variables, workflow.stepIndex),
  };
}

/** AP-035 research R5: the `{{key}}` an active binding writes at its target. */
export function consumedValueOf(binding: ValueBinding): ConsumedValue {
  const key = captureKeyOf(binding.captureStepId, binding.captureName);
  if (binding.target.kind === "body") {
    const parsed = parseCapturePath(binding.target.fieldPath);
    return { key, name: binding.captureName, location: "body", field: binding.target.fieldPath, segments: parsed.ok ? parsed.segments : [] };
  }
  return { key, name: binding.captureName, location: binding.target.kind, field: binding.target.name };
}

function makeStep(
  context: PerformanceContext,
  auth: AuthPlan,
  id: string,
  candidate: Candidate,
  links: StepLinks,
  build: StepBuild,
): PerformanceStep {
  const { operation, selection } = candidate;
  const operationKey = operationKeyOf(operation);
  const edit = appliedEdit(build.bodyEdits, id, selection.scenario);
  const parameterEdit = appliedEdit(build.parameterEdits, id, selection.scenario);
  const scenario = applyParameterEdit(effectiveScenario(selection.scenario, edit), parameterEdit);
  const built = buildStepRequest(context, auth, operation, scenario, {
    consumed: links.consumed,
    bodyEdited: edit !== undefined,
    editedPathParameters: editedPathParameters(parameterEdit),
  });
  const bodyReferences = edit ? engineerReferences(operation, scenario.request.body) : undefined;
  const parameterReferences = parameterEdit ? parameterEditReferences(operation, parameterEdit) : undefined;
  build.requests.set(id, {
    ...built,
    ...(bodyReferences ? { bodyReferenceNames: bodyReferences.names, bodySecretReferenceNames: bodyReferences.secretNames } : {}),
    ...(parameterReferences ? { parameterReferenceNames: parameterReferences.names, parameterSecretReferenceNames: parameterReferences.secretNames } : {}),
  });
  for (const unique of uniqueValueCandidates(operation, scenario.request.body)) {
    build.uniqueValueFields.push({ stepId: id, location: "body", fieldPath: unique.fieldPath, format: unique.format });
  }
  if (edit) {
    build.generatedUniqueFields.set(
      id,
      uniqueValueCandidates(operation, selection.scenario.request.body).map((unique) => unique.fieldPath),
    );
  }
  const prefill = prefillExpectedStatuses(operation);
  return {
    id,
    operationKey,
    method: operation.method.toUpperCase(),
    path: operation.path,
    scenarioId: selection.scenario.id,
    scenarioDescription: selection.scenario.provenance.description,
    scenarioChoice: selection.reason,
    tieBrokenByLowestId: selection.tieBrokenByLowestId,
    consumes: links.consumes,
    produces: links.produces,
    variableBindings: links.variableBindings,
    dependency: links.dependency,
    expectedStatuses: withSources(prefill, prefill),
    auth: { kind: built.authKind, schemeName: built.schemeName },
    requiredValues: built.envNames,
    // Only present when true, so a step without an edit serializes as it did before AP-033 (R10).
    ...(edit ? { bodyEdited: true as const } : {}),
    ...(parameterEdit ? { parametersEdited: true as const } : {}),
    ...(links.user && links.user.captures.length > 0 ? { captures: links.user.captures } : {}),
    ...(links.user && links.user.bindings.length > 0 ? { bindings: links.user.bindings } : {}),
    ...(links.user ? { userDefined: true as const } : {}),
  };
}

/** AP-035 FR-009: a body capture is documented when its path is one of the listed response fields. */
function withDocumented(capture: Capture, operation: ApiOperation): Capture {
  if (capture.source.kind === "header") return { ...capture, documented: null };
  const path = capture.source.path;
  return { ...capture, documented: documentedResponseFields(operation).fields.some((field) => field.path === path) };
}

/** AP-035 FR-011, FR-016: whether a binding's target still exists for this step's operation and base body. */
function targetExists(binding: ValueBinding, operation: ApiOperation, body: unknown): boolean {
  const { target } = binding;
  if (target.kind === "body") {
    const parsed = parseCapturePath(target.fieldPath);
    return parsed.ok && valueAtPath(body, parsed.segments) !== undefined;
  }
  return isDocumentedParameter(operation, target.kind, target.name);
}

/**
 * AP-035 research R4, R5: one user-defined journey as plan steps. A step whose operation has no
 * candidate makes the journey incomplete (FR-025); the other steps are still built, so their
 * settings are kept. A binding whose target no longer exists is marked `target-missing` and not
 * applied (FR-016); one whose body field an edit removed is dropped with a notice (FR-013).
 */
function userJourney(
  context: PerformanceContext,
  auth: AuthPlan,
  definition: UserJourneyDefinition,
  candidates: ReadonlyMap<string, Candidate>,
  build: StepBuild,
  out: { needingAttention: string[]; notices: BodyEditNotice[] },
): { journey: PerformanceJourney; definition: UserJourneyDefinition } {
  const missingOperationKeys = [...new Set(definition.steps.filter((step) => !candidates.has(step.operationKey)).map((step) => step.operationKey))].sort(
    compareCodeUnits,
  );
  const steps: PerformanceStep[] = [];
  const resolvedSteps: UserJourneyStepDefinition[] = [];
  for (const stepDefinition of definition.steps) {
    const candidate = candidates.get(stepDefinition.operationKey);
    if (!candidate) {
      resolvedSteps.push(stepDefinition);
      continue;
    }
    const { operation, selection } = candidate;
    const baseBody = effectiveScenario(selection.scenario, appliedEdit(build.bodyEdits, stepDefinition.id, selection.scenario)).request.body;
    const edited = appliedEdit(build.bodyEdits, stepDefinition.id, selection.scenario) !== undefined;
    const captures = stepDefinition.captures.map((capture) => withDocumented(capture, operation));
    const bindings: ValueBinding[] = [];
    for (const binding of stepDefinition.bindings) {
      if (targetExists(binding, operation, baseBody)) {
        bindings.push({ ...binding, state: "active" });
      } else if (binding.target.kind === "body" && edited) {
        // FR-013: removing a bound field in the body editor removes the binding.
        out.notices.push({ stepId: stepDefinition.id, kind: "capture-binding-dropped", name: binding.target.fieldPath });
      } else {
        bindings.push({ ...binding, state: "target-missing" });
      }
    }
    if (bindings.some((binding) => binding.state === "target-missing")) out.needingAttention.push(stepDefinition.id);
    const active = bindings.filter((binding) => binding.state === "active");
    const relationshipIds = [
      ...new Set([...captures, ...bindings].flatMap((entry) => (entry.relationshipId ? [entry.relationshipId] : []))),
    ].sort(compareCodeUnits);
    const links: StepLinks = {
      consumed: active.map(consumedValueOf),
      variableBindings: [
        ...captures.map(
          (capture): StepVariableBinding => ({
            variable: capture.name,
            role: "produces",
            field: capture.source.kind === "body" ? capture.source.path : capture.source.name,
          }),
        ),
        ...bindings.map(
          (binding): StepVariableBinding => ({
            variable: binding.captureName,
            role: "consumes",
            field: binding.target.kind === "body" ? binding.target.fieldPath : binding.target.name,
            location: binding.target.kind,
            producerStepId: binding.captureStepId,
          }),
        ),
      ],
      produces: captures.map((capture) => capture.name),
      consumes: [...new Set(bindings.map((binding) => binding.captureName))],
      dependency:
        relationshipIds.length > 0
          ? { relationshipIds, confidence: bindings.some((binding) => binding.confidence === "LIKELY") ? "LIKELY" : "CONFIRMED" }
          : null,
      user: { captures, bindings },
    };
    steps.push(makeStep(context, auth, stepDefinition.id, candidate, links, build));
    resolvedSteps.push({ ...stepDefinition, captures, bindings });
  }
  const source: PerformanceJourney["source"] = {
    kind: "user",
    userJourneyId: definition.id,
    name: definition.name,
    ...(definition.origin.kind === "based-on-workflow" ? { basedOnWorkflowId: definition.origin.workflowId } : {}),
  };
  return {
    journey: { id: definition.id, source, steps, ...(missingOperationKeys.length > 0 ? { incompleteReason: { missingOperationKeys } } : {}) },
    definition: { ...definition, steps: resolvedSteps },
  };
}

export function buildJourneys(
  context: PerformanceContext,
  auth: AuthPlan,
  excludedOperationKeys: ReadonlySet<string>,
  bodyEdits: ReadonlyMap<string, BodyEdit> = new Map(),
  parameterEdits: ReadonlyMap<string, ParameterEdit> = new Map(),
  user: UserJourneyChoices = { userJourneys: [], alsoStandalone: [] },
): BuiltJourneys {
  const inScope = operationsInScope(context).filter((operation) => !excludedOperationKeys.has(operationKeyOf(operation)));
  const omitted: OmittedOperation[] = [];
  const candidates = new Map<string, Candidate>();
  for (const operation of inScope) {
    const selection = selectPerformanceScenario(context.approvedScenarios, operation);
    if ("omitted" in selection) omitted.push({ operationKey: operationKeyOf(operation), reason: selection.omitted });
    else candidates.set(operationKeyOf(operation), { operation, selection });
  }

  const journeys: PerformanceJourney[] = [];
  const build: StepBuild = { bodyEdits, parameterEdits, uniqueValueFields: [], requests: new Map(), generatedUniqueFields: new Map() };
  const inWorkflowJourney = new Set<string>();

  // AP-035 R14: a proposed journey that the engineer edited is replaced by its user journey.
  const replacedWorkflows = new Set(
    user.userJourneys.flatMap((definition) => (definition.origin.kind === "based-on-workflow" ? [definition.origin.workflowId] : [])),
  );
  for (const workflow of [...context.workflows].sort((a, b) => compareCodeUnits(a.id, b.id))) {
    if (replacedWorkflows.has(workflow.id)) continue;
    const ordered = [...workflow.steps].sort((a, b) => a.position - b.position);
    const stepCandidates = ordered.map((step) => candidates.get(`${step.operationMethod.toUpperCase()} ${step.operationPath}`));
    if (stepCandidates.some((candidate) => candidate === undefined)) continue;
    const journeyId = journeyIdFor({ workflowId: workflow.id });
    const stepIds = ordered.map((step) => stepIdFor(journeyId, `${step.operationMethod.toUpperCase()} ${step.operationPath}`));
    const steps = stepCandidates.map((candidate, stepIndex) =>
      makeStep(context, auth, stepIds[stepIndex], candidate!, workflowLinks(context, { id: workflow.id, variables: workflow.variables, stepIndex, stepIds }), build),
    );
    for (const candidate of stepCandidates) inWorkflowJourney.add(operationKeyOf(candidate!.operation));
    journeys.push({ id: journeyId, source: { kind: "workflow", workflowId: workflow.id }, steps });
  }

  // AP-035 R4: user-defined journeys, complete or incomplete, after the proposed ones.
  const out = { needingAttention: [] as string[], notices: [] as BodyEditNotice[] };
  const userJourneys: UserJourneyDefinition[] = [];
  const inUserJourney = new Set<string>();
  for (const definition of user.userJourneys) {
    const resolved = userJourney(context, auth, definition, candidates, build, out);
    journeys.push(resolved.journey);
    userJourneys.push(resolved.definition);
    for (const step of definition.steps) inUserJourney.add(step.operationKey);
  }
  const standalone = new Set(user.alsoStandalone);

  const singles = [...candidates.entries()]
    .filter(([key]) => !inWorkflowJourney.has(key) && (!inUserJourney.has(key) || standalone.has(key)))
    .sort(([a], [b]) => compareCodeUnits(a, b));
  for (const [operationKey, candidate] of singles) {
    const journeyId = journeyIdFor({ operationKey });
    journeys.push({
      id: journeyId,
      source: { kind: "operation" },
      steps: [makeStep(context, auth, stepIdFor(journeyId, operationKey), candidate, NO_LINKS, build)],
    });
  }

  omitted.sort((a, b) => compareCodeUnits(a.operationKey, b.operationKey));
  const { uniqueValueFields, requests, generatedUniqueFields } = build;
  return {
    journeys,
    omitted,
    uniqueValueFields,
    requests,
    generatedUniqueFields,
    userJourneys,
    bindingsNeedingAttention: out.needingAttention,
    droppedBindingNotices: out.notices,
  };
}
