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
import { workflowVariableName } from "../../postman/workflowRendering";
import { compareCodeUnits } from "../../postman/ordering";
import { withSources, prefillExpectedStatuses } from "./expectedStatuses";
import { journeyIdFor, stepIdFor } from "./identifiers";
import { selectPerformanceScenario, type PerformanceScenarioSelection } from "./selectScenario";
import { buildStepRequest, operationKeyOf, type AuthPlan, type BuiltStepRequest, type ConsumedValue, type PerformanceContext } from "./stepRequest";
import { uniqueValueCandidates } from "./uniqueValueFields";

/**
 * FR-006 (specs/031-k6-performance-testing research D5): each approved workflow becomes one
 * journey with its steps in position order, and each other operation in scope a single-step
 * journey, ordered by method then path. A workflow becomes a journey only when every one of its
 * operations is in scope, not removed, and has a positive scenario; otherwise its consumer could
 * not receive its value, so its operations are planned as single-step journeys instead.
 *
 * Since AP-037 phase two (specs/037-request-chain-performance research R24) this derivation only
 * seeds request-chain plans: the edits, user journeys and reordering of the retired plans are gone.
 */
export interface BuiltJourneys {
  journeys: PerformanceJourney[];
  omitted: OmittedOperation[];
  uniqueValueFields: UniqueValueField[];
  /** Built requests by step id. */
  requests: Map<string, BuiltStepRequest>;
}

interface StepBuild {
  uniqueValueFields: UniqueValueField[];
  requests: Map<string, BuiltStepRequest>;
}

interface Candidate {
  operation: ApiOperation;
  selection: Extract<PerformanceScenarioSelection, { scenario: TestScenario }>;
}

/**
 * The operations in scope (AP-032 FR-022, replacing AP-029 FR-001): the guided workflow's API
 * review selection, or every analyzed operation when none was made. A quick test's context has no
 * selection, so it covers every operation (FR-003). Only these can be listed as left out (FR-023).
 */
export function operationsInScope(context: PerformanceContext): ApiOperation[] {
  const selected = context.selectedOperationKeys ? new Set(context.selectedOperationKeys) : undefined;
  return context.apiModel.operations.filter((operation) => !selected || selected.has(operationKeyOf(operation)));
}

function dependencyFor(context: PerformanceContext, variables: WorkflowVariable[], stepIndex: number): StepDependency | null {
  const relationshipIds = [
    ...new Set(
      variables
        .filter((variable) => variable.producerStepIndex === stepIndex || variable.consumerStepIndex === stepIndex)
        .map((variable) => variable.relationshipId),
    ),
  ].sort(compareCodeUnits);
  if (relationshipIds.length === 0) return null;
  const likely = relationshipIds.some((id) => context.relationships.find((relationship) => relationship.id === id)?.confidence === "LIKELY");
  return { relationshipIds, confidence: likely ? "LIKELY" : "CONFIRMED" };
}

/** How one step is wired to the other steps of its journey. */
interface StepLinks {
  consumed: ConsumedValue[];
  variableBindings: StepVariableBinding[];
  produces: string[];
  consumes: string[];
  dependency: StepDependency | null;
}

const NO_LINKS: StepLinks = { consumed: [], variableBindings: [], produces: [], consumes: [], dependency: null };

function workflowLinks(context: PerformanceContext, workflow: { id: string; variables: WorkflowVariable[]; stepIndex: number; stepIds: string[] }): StepLinks {
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

function makeStep(context: PerformanceContext, auth: AuthPlan, id: string, candidate: Candidate, links: StepLinks, build: StepBuild): PerformanceStep {
  const { operation, selection } = candidate;
  const scenario = selection.scenario;
  const built = buildStepRequest(context, auth, operation, scenario, { consumed: links.consumed });
  build.requests.set(id, built);
  for (const unique of uniqueValueCandidates(operation, scenario.request.body)) {
    build.uniqueValueFields.push({ stepId: id, location: "body", fieldPath: unique.fieldPath, format: unique.format });
  }
  const prefill = prefillExpectedStatuses(operation);
  return {
    id,
    operationKey: operationKeyOf(operation),
    method: operation.method.toUpperCase(),
    path: operation.path,
    scenarioId: scenario.id,
    scenarioDescription: scenario.provenance.description,
    scenarioChoice: selection.reason,
    tieBrokenByLowestId: selection.tieBrokenByLowestId,
    consumes: links.consumes,
    produces: links.produces,
    variableBindings: links.variableBindings,
    dependency: links.dependency,
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
  const build: StepBuild = { uniqueValueFields: [], requests: new Map() };
  const inWorkflowJourney = new Set<string>();
  for (const workflow of [...context.workflows].sort((a, b) => compareCodeUnits(a.id, b.id))) {
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

  const singles = [...candidates.entries()].filter(([key]) => !inWorkflowJourney.has(key)).sort(([a], [b]) => compareCodeUnits(a, b));
  for (const [operationKey, candidate] of singles) {
    const journeyId = journeyIdFor({ operationKey });
    journeys.push({ id: journeyId, source: { kind: "operation" }, steps: [makeStep(context, auth, stepIdFor(journeyId, operationKey), candidate, NO_LINKS, build)] });
  }

  omitted.sort((a, b) => compareCodeUnits(a.operationKey, b.operationKey));
  return { journeys, omitted, uniqueValueFields: build.uniqueValueFields, requests: build.requests };
}
