import type { BindingTarget, Capture, PerformancePlan, UserJourneyDefinition, UserJourneyStepDefinition, ValueBinding } from "@apipilot/shared-domain";
import { UserJourneyRefusedError } from "../errors";
import type { PlanChoices } from "./buildPlan";
import { parseCapturePath } from "./capturePath";
import { journeyIdFor, userJourneyIdFor, userJourneyStepIdFor } from "./identifiers";
import type { PerformanceContext } from "./stepRequest";

/**
 * AP-035 FR-024 (specs/035-user-defined-journeys research R14): turning a proposed workflow journey
 * into a user-defined journey "based on" that workflow, and back. Both are explicit engineer actions;
 * the conversion copies what ApiPilot proposed and adds nothing (FR-006). Pure over the plan, the
 * context and the choices it is given.
 */
const CAPTURE_NAME_LIMIT = 64;

/** A workflow variable's name as a capture name (FR-026): invalid characters become `_`, a leading digit gets `_`. */
function captureNameFor(variable: string, taken: Set<string>): string {
  let base = variable.replace(/[^A-Za-z0-9_]/g, "_");
  if (base === "" || /^[0-9]/.test(base)) base = `_${base}`;
  base = base.slice(0, CAPTURE_NAME_LIMIT);
  let name = base;
  for (let suffix = 2; taken.has(name); suffix++) name = `${base.slice(0, CAPTURE_NAME_LIMIT - String(suffix).length - 1)}_${suffix}`;
  taken.add(name);
  return name;
}

function moveSettings(choices: PlanChoices, moves: ReadonlyMap<string, string>, discard: ReadonlySet<string>): void {
  const statuses = new Map<string, string[]>();
  for (const [stepId, codes] of choices.expectedStatusCodes) {
    if (discard.has(stepId)) continue;
    statuses.set(moves.get(stepId) ?? stepId, codes);
  }
  choices.expectedStatusCodes = statuses;
  choices.bodyEdits = choices.bodyEdits.filter((edit) => !discard.has(edit.stepId)).map((edit) => ({ ...edit, stepId: moves.get(edit.stepId) ?? edit.stepId }));
  choices.parameterEdits = choices.parameterEdits.filter((edit) => !discard.has(edit.stepId)).map((edit) => ({ ...edit, stepId: moves.get(edit.stepId) ?? edit.stepId }));
}

/**
 * FR-024: the definition for one proposed workflow journey, with each workflow variable as a
 * capture on its producer and a binding on its consumer, keeping the relationship and its
 * confidence. The step's expected statuses and edits move to the new step ids, and the new journey
 * takes the proposed journey's place in the journey order.
 */
export function convertWorkflowJourney(plan: PerformancePlan, journeyId: unknown, context: PerformanceContext, choices: PlanChoices): void {
  const journey = typeof journeyId === "string" ? plan.journeys.find((candidate) => candidate.id === journeyId) : undefined;
  const source = journey?.source;
  if (!journey || source?.kind !== "workflow" || context.source !== "guided") {
    throw new UserJourneyRefusedError("not_a_proposed_journey", "Only a journey proposed from an approved workflow, on the guided path, can be edited.", {
      journeyId: typeof journeyId === "string" ? journeyId : "",
    });
  }
  const workflow = context.workflows.find((candidate) => candidate.id === source.workflowId);
  if (!workflow) throw new UserJourneyRefusedError("not_a_proposed_journey", "The journey's workflow is no longer approved.", { journeyId: journey.id });

  const id = userJourneyIdFor(choices.nextUserJourneyNumber);
  // The workflow's own step indexes, by operation; the plan's step order is the engineer's.
  const ordered = [...workflow.steps].sort((a, b) => a.position - b.position);
  const workflowIndexOf = new Map(ordered.map((step, index) => [`${step.operationMethod.toUpperCase()} ${step.operationPath}`, index]));
  const newIdByWorkflowIndex = new Map<number, string>();
  journey.steps.forEach((step, index) => {
    const workflowIndex = workflowIndexOf.get(step.operationKey);
    if (workflowIndex !== undefined) newIdByWorkflowIndex.set(workflowIndex, userJourneyStepIdFor(id, index + 1));
  });
  // As the proposed step's own `dependency` reports it (buildJourneys `dependencyFor`): only
  // sufficiently confident relationships become approved workflows (constitution XV).
  const confidenceOf = (relationshipId: string): "CONFIRMED" | "LIKELY" | undefined => {
    const confidence = context.relationships.find((relationship) => relationship.id === relationshipId)?.confidence;
    return confidence === undefined ? undefined : confidence === "LIKELY" ? "LIKELY" : "CONFIRMED";
  };
  const taken = new Set<string>();
  const nameOfVariable = new Map(workflow.variables.map((variable) => [variable.name, captureNameFor(variable.name, taken)]));

  const steps: UserJourneyStepDefinition[] = journey.steps.map((step, index) => {
    const workflowIndex = workflowIndexOf.get(step.operationKey);
    const captures: Capture[] = workflow.variables
      .filter((variable) => variable.producerStepIndex === workflowIndex)
      .flatMap((variable) => {
        const parsed = parseCapturePath(variable.producerField);
        return parsed.ok ? [{ name: nameOfVariable.get(variable.name)!, source: { kind: "body" as const, path: parsed.path, segments: parsed.segments }, documented: true, relationshipId: variable.relationshipId }] : [];
      });
    const bindings: ValueBinding[] = workflow.variables
      .filter((variable) => variable.consumerStepIndex === workflowIndex && variable.consumerLocation !== "auth")
      .flatMap((variable) => {
        const captureStepId = newIdByWorkflowIndex.get(variable.producerStepIndex);
        if (!captureStepId) return [];
        let target: BindingTarget;
        if (variable.consumerLocation === "body") {
          const parsed = parseCapturePath(variable.consumerField);
          if (!parsed.ok) return [];
          target = { kind: "body", fieldPath: parsed.path };
        } else target = { kind: variable.consumerLocation as "path" | "query" | "header", name: variable.consumerField };
        const confidence = confidenceOf(variable.relationshipId);
        return [{ target, captureStepId, captureName: nameOfVariable.get(variable.name)!, state: "active" as const, relationshipId: variable.relationshipId, ...(confidence ? { confidence } : {}) }];
      });
    return { id: userJourneyStepIdFor(id, index + 1), operationKey: step.operationKey, fromProposedStepId: step.id, captures, bindings };
  });

  const definition: UserJourneyDefinition = { id, name: `Workflow ${workflow.id.slice(0, 12)}`, origin: { kind: "based-on-workflow", workflowId: workflow.id }, steps, nextStepNumber: steps.length + 1 };
  moveSettings(choices, new Map(steps.map((step) => [step.fromProposedStepId!, step.id])), new Set());
  choices.userJourneys = [...choices.userJourneys, definition];
  choices.nextUserJourneyNumber += 1;
  choices.journeyOrder = (choices.journeyOrder ?? []).map((candidate) => (candidate === journey.id ? id : candidate));
}

/**
 * FR-024 (Clarifications 2026-10-02): removes an edited workflow journey. The expected statuses
 * and edits of each step that came from the workflow return to the proposed step; those of steps
 * the engineer added are discarded. AP-033's scenario match still applies on the next assembly.
 */
export function revertWorkflowJourney(choices: PlanChoices, journeyId: unknown): void {
  const definition = choices.userJourneys.find((candidate) => candidate.id === journeyId);
  if (!definition || definition.origin.kind !== "based-on-workflow") {
    throw new UserJourneyRefusedError("not_based_on_workflow", "Only a journey based on a workflow can be reverted to the proposed journey.", {
      journeyId: typeof journeyId === "string" ? journeyId : "",
    });
  }
  const moves = new Map(definition.steps.flatMap((step) => (step.fromProposedStepId ? [[step.id, step.fromProposedStepId] as const] : [])));
  const discard = new Set(definition.steps.filter((step) => !step.fromProposedStepId).map((step) => step.id));
  moveSettings(choices, moves, discard);
  choices.userJourneys = choices.userJourneys.filter((candidate) => candidate.id !== definition.id);
  // The proposed journey takes the edited journey's place in the order.
  const proposedId = journeyIdFor({ workflowId: definition.origin.workflowId });
  choices.journeyOrder = (choices.journeyOrder ?? []).map((candidate) => (candidate === definition.id ? proposedId : candidate));
  choices.alsoStandalone = choices.alsoStandalone.filter((key) => choices.userJourneys.some((candidate) => candidate.steps.some((step) => step.operationKey === key)));
}

/** Spec Edge Cases ("Resetting the plan"): every edited workflow journey is reverted; the engineer's own journeys are kept. */
export function revertAllWorkflowJourneys(choices: PlanChoices): void {
  for (const definition of [...choices.userJourneys]) {
    if (definition.origin.kind === "based-on-workflow") revertWorkflowJourney(choices, definition.id);
  }
}
