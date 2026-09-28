import type {
  ApiOperation,
  OmittedOperation,
  PerformanceJourney,
  PerformanceStep,
  StepDependency,
  StepVariableBinding,
  TestScenario,
  UniqueValueField,
  WorkflowVariable,
} from "@apipilot/shared-domain";
import { compareCodeUnits } from "../../postman/ordering";
import { withSources, prefillExpectedStatuses } from "./expectedStatuses";
import { journeyIdFor, stepIdFor } from "./identifiers";
import { selectPerformanceScenario, type PerformanceScenarioSelection } from "./selectScenario";
import {
  buildStepRequest,
  operationKeyOf,
  type AuthPlan,
  type BuiltStepRequest,
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

function makeStep(
  context: PerformanceContext,
  auth: AuthPlan,
  journeyId: string,
  candidate: Candidate,
  workflow: { id: string; variables: WorkflowVariable[]; stepIndex: number; stepIds: string[] } | undefined,
  uniqueValueFields: UniqueValueField[],
  requests: Map<string, BuiltStepRequest>,
): PerformanceStep {
  const { operation, selection } = candidate;
  const operationKey = operationKeyOf(operation);
  const id = stepIdFor(journeyId, operationKey);
  const produces = workflow?.variables.filter((variable) => variable.producerStepIndex === workflow.stepIndex) ?? [];
  const consumes = workflow?.variables.filter((variable) => variable.consumerStepIndex === workflow.stepIndex) ?? [];
  const bindings: StepVariableBinding[] = [
    ...produces.map((variable): StepVariableBinding => ({ variable: variable.name, role: "produces", field: variable.producerField })),
    ...consumes.map(
      (variable): StepVariableBinding => ({
        variable: variable.name,
        role: "consumes",
        field: variable.consumerField,
        location: variable.consumerLocation,
        producerStepId: workflow?.stepIds[variable.producerStepIndex],
      }),
    ),
  ];
  const built = buildStepRequest(context, auth, operation, selection.scenario, {
    workflowId: workflow?.id,
    consumes,
  });
  requests.set(id, built);
  for (const unique of uniqueValueCandidates(operation, selection.scenario.request.body)) {
    uniqueValueFields.push({ stepId: id, location: "body", fieldPath: unique.fieldPath, format: unique.format });
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
    consumes: consumes.map((variable) => variable.name),
    produces: produces.map((variable) => variable.name),
    variableBindings: bindings,
    dependency: workflow ? dependencyFor(context, workflow.variables, workflow.stepIndex) : null,
    expectedStatuses: withSources(prefill, prefill),
    auth: { kind: built.authKind, schemeName: built.schemeName },
    requiredValues: built.envNames,
  };
}

export function buildJourneys(context: PerformanceContext, auth: AuthPlan, excludedOperationKeys: ReadonlySet<string>): BuiltJourneys {
  const inScope = operationsInScope(context).filter((operation) => !excludedOperationKeys.has(operationKeyOf(operation)));
  const omitted: OmittedOperation[] = [];
  const candidates = new Map<string, Candidate>();
  for (const operation of inScope) {
    const selection = selectPerformanceScenario(context.approvedScenarios, operation);
    if ("omitted" in selection) omitted.push({ operationKey: operationKeyOf(operation), reason: selection.omitted });
    else candidates.set(operationKeyOf(operation), { operation, selection });
  }

  const journeys: PerformanceJourney[] = [];
  const uniqueValueFields: UniqueValueField[] = [];
  const requests = new Map<string, BuiltStepRequest>();
  const inWorkflowJourney = new Set<string>();

  for (const workflow of [...context.workflows].sort((a, b) => compareCodeUnits(a.id, b.id))) {
    const ordered = [...workflow.steps].sort((a, b) => a.position - b.position);
    const stepCandidates = ordered.map((step) => candidates.get(`${step.operationMethod.toUpperCase()} ${step.operationPath}`));
    if (stepCandidates.some((candidate) => candidate === undefined)) continue;
    const journeyId = journeyIdFor({ workflowId: workflow.id });
    const stepIds = ordered.map((step) => stepIdFor(journeyId, `${step.operationMethod.toUpperCase()} ${step.operationPath}`));
    const steps = stepCandidates.map((candidate, stepIndex) =>
      makeStep(
        context,
        auth,
        journeyId,
        candidate!,
        { id: workflow.id, variables: workflow.variables, stepIndex, stepIds },
        uniqueValueFields,
        requests,
      ),
    );
    for (const candidate of stepCandidates) inWorkflowJourney.add(operationKeyOf(candidate!.operation));
    journeys.push({ id: journeyId, source: { kind: "workflow", workflowId: workflow.id }, steps });
  }

  const singles = [...candidates.entries()]
    .filter(([key]) => !inWorkflowJourney.has(key))
    .sort(([a], [b]) => compareCodeUnits(a, b));
  for (const [operationKey, candidate] of singles) {
    const journeyId = journeyIdFor({ operationKey });
    journeys.push({
      id: journeyId,
      source: { kind: "operation" },
      steps: [makeStep(context, auth, journeyId, candidate, undefined, uniqueValueFields, requests)],
    });
  }

  omitted.sort((a, b) => compareCodeUnits(a.operationKey, b.operationKey));
  return { journeys, omitted, uniqueValueFields, requests };
}
