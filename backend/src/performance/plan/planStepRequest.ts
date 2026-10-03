import type { ApiOperation, PerformanceJourney, PerformanceStep, TestScenario, UniqueValueField } from "@apipilot/shared-domain";
import { workflowVariableName } from "../../postman/workflowRendering";
import { StepNotFoundError } from "../errors";
import type { SeedPlan } from "./buildPlan";
import { buildStepRequest, operationKeyOf, UNIQUE_TOKEN_PREFIX, type AuthPlan, type BuiltStepRequest, type ConsumedValue, type PerformanceContext } from "./stepRequest";

/**
 * One seed journey step's request with every input it is built from (AP-032,
 * specs/032-quick-performance-test research Q8): the workflow substitutions of a guided journey
 * and the per-iteration unique-value tokens (AP-029 D13). Since AP-037 phase two it feeds only the
 * workflow seeder (specs/037-request-chain-performance research R16).
 */
export interface UniqueToken {
  token: string;
  stepId: string;
  fieldPath: string;
  format: UniqueValueField["format"];
  /** The scenario's own value for the field, which varies per iteration. */
  original: string;
}

/** A value taken from this step's response for later steps: a guided workflow variable (AP-029 FR-010). */
export interface StepCapture {
  key: string;
  name: string;
  source: { body: (string | number)[] } | { header: string };
}

export interface PlanStepRequest {
  journey: PerformanceJourney;
  step: PerformanceStep;
  operation: ApiOperation;
  scenario: TestScenario;
  /** The values earlier steps fill in. */
  consumed: ConsumedValue[];
  /** The values this step captures for later steps. */
  captures: StepCapture[];
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

/** What a workflow step consumes and captures, read from its variable bindings. */
function stepWiringOf(journey: PerformanceJourney, step: PerformanceStep): { consumed: ConsumedValue[]; captures: StepCapture[] } {
  const source = journey.source;
  const consumed: ConsumedValue[] = [];
  const captures: StepCapture[] = [];
  if (source.kind !== "workflow") return { consumed, captures };
  for (const binding of step.variableBindings) {
    const key = workflowVariableName(source.workflowId, binding.variable);
    if (binding.role === "produces") captures.push({ key, name: binding.variable, source: { body: binding.field.split(".") } });
    else consumed.push({ key, name: binding.variable, location: binding.location ?? "body", field: binding.field });
  }
  return { consumed, captures };
}

/** Every unique-value token of the plan, indexed in `plan.uniqueValueFields` order. */
function uniqueTokensOf(plan: SeedPlan, context: PerformanceContext): UniqueToken[] {
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

export function stepRequestFor(plan: SeedPlan, context: PerformanceContext, auth: AuthPlan, stepId: string, unique: readonly UniqueToken[] = uniqueTokensOf(plan, context)): PlanStepRequest {
  const journey = plan.journeys.find((candidate) => candidate.steps.some((step) => step.id === stepId));
  const step = journey?.steps.find((candidate) => candidate.id === stepId);
  if (!journey || !step) throw new StepNotFoundError(stepId);

  const operation = context.apiModel.operations.find((candidate) => operationKeyOf(candidate) === step.operationKey);
  const scenario = context.approvedScenarios.find((candidate) => candidate.id === step.scenarioId);
  if (!operation || !scenario) throw new Error(`The plan's step ${step.id} no longer matches the approvals.`);

  const { consumed, captures } = stepWiringOf(journey, step);
  const stepUnique = unique.filter((entry) => entry.stepId === step.id);
  const built = buildStepRequest(context, auth, operation, scenario, {
    consumed,
    uniqueFields: stepUnique.map((entry) => ({ fieldPath: entry.fieldPath, token: entry.token })),
  });
  return { journey, step, operation, scenario, consumed, captures, unique: stepUnique, built };
}
