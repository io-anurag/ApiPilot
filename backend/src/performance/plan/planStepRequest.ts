import type {
  ApiOperation,
  IntegrationWorkflow,
  PerformanceJourney,
  PerformancePlan,
  PerformanceStep,
  TestScenario,
  UniqueValueField,
  WorkflowVariable,
} from "@apipilot/shared-domain";
import { StepNotFoundError } from "../errors";
import { buildStepRequest, operationKeyOf, UNIQUE_TOKEN_PREFIX, type AuthPlan, type BuiltStepRequest, type PerformanceContext } from "./stepRequest";

/**
 * One plan step's request with every input the script uses to build it (AP-032,
 * specs/032-quick-performance-test research Q8): the workflow substitutions of a guided journey
 * and the per-iteration unique-value tokens (AP-029 D13). `renderScript` and the step request
 * preview both call `stepRequestFor`, so the preview is by construction the request the script
 * sends.
 */
export interface UniqueToken {
  token: string;
  stepId: string;
  fieldPath: string;
  format: UniqueValueField["format"];
  /** The scenario's own value for the field, which the script varies per iteration. */
  original: string;
}

export interface PlanStepRequest {
  journey: PerformanceJourney;
  step: PerformanceStep;
  operation: ApiOperation;
  scenario: TestScenario;
  workflow: IntegrationWorkflow | undefined;
  consumes: WorkflowVariable[];
  produces: WorkflowVariable[];
  /** This step's unique-value tokens. */
  unique: UniqueToken[];
  built: BuiltStepRequest;
}

function originalValue(body: unknown, fieldPath: string): string {
  let current: unknown = body;
  for (const part of fieldPath.split(".")) {
    if (current === null || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : "";
}

function stepPositionsOf(workflow: IntegrationWorkflow): Map<string, number> {
  return new Map(
    [...workflow.steps]
      .sort((a, b) => a.position - b.position)
      .map((step, index) => [`${step.operationMethod.toUpperCase()} ${step.operationPath}`, index]),
  );
}

/** Every unique-value token of the plan, indexed in `plan.uniqueValueFields` order. */
export function uniqueTokensOf(plan: PerformancePlan, context: PerformanceContext): UniqueToken[] {
  const scenarios = new Map(context.approvedScenarios.map((scenario) => [scenario.id, scenario]));
  const steps = plan.journeys.flatMap((journey) => journey.steps);
  return plan.uniqueValueFields.map((field, index) => {
    const step = steps.find((candidate) => candidate.id === field.stepId);
    const scenario = step ? scenarios.get(step.scenarioId) : undefined;
    return {
      token: `${UNIQUE_TOKEN_PREFIX}${index}`,
      stepId: field.stepId,
      fieldPath: field.fieldPath,
      format: field.format,
      original: originalValue(scenario?.request.body, field.fieldPath),
    };
  });
}

export function stepRequestFor(
  plan: PerformancePlan,
  context: PerformanceContext,
  auth: AuthPlan,
  stepId: string,
  unique: readonly UniqueToken[] = uniqueTokensOf(plan, context),
): PlanStepRequest {
  const journey = plan.journeys.find((candidate) => candidate.steps.some((step) => step.id === stepId));
  const step = journey?.steps.find((candidate) => candidate.id === stepId);
  if (!journey || !step) throw new StepNotFoundError(stepId);

  const operation = context.apiModel.operations.find((candidate) => operationKeyOf(candidate) === step.operationKey);
  const scenario = context.approvedScenarios.find((candidate) => candidate.id === step.scenarioId);
  if (!operation || !scenario) throw new Error(`The plan's step ${step.id} no longer matches the approvals.`);

  const source = journey.source;
  const workflow = source.kind === "workflow" ? context.workflows.find((candidate) => candidate.id === source.workflowId) : undefined;
  const position = workflow ? stepPositionsOf(workflow).get(step.operationKey) : undefined;
  const variables: WorkflowVariable[] = workflow?.variables ?? [];
  const consumes = position === undefined ? [] : variables.filter((variable) => variable.consumerStepIndex === position);
  const produces = position === undefined ? [] : variables.filter((variable) => variable.producerStepIndex === position);
  const stepUnique = unique.filter((entry) => entry.stepId === step.id);
  const built = buildStepRequest(context, auth, operation, scenario, {
    workflowId: workflow?.id,
    consumes,
    uniqueFields: stepUnique.map((entry) => ({ fieldPath: entry.fieldPath, token: entry.token })),
  });
  return { journey, step, operation, scenario, workflow, consumes, produces, unique: stepUnique, built };
}
