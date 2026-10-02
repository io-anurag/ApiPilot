import type {
  ApiOperation,
  BodyPathSegment,
  PerformanceJourney,
  PerformancePlan,
  PerformanceStep,
  TestScenario,
  UniqueValueField,
} from "@apipilot/shared-domain";
import { workflowVariableName } from "../../postman/workflowRendering";
import { StepNotFoundError } from "../errors";
import { bodyEditFor, effectiveScenario } from "./bodyEdits";
import { consumedValueOf } from "./buildJourneys";
import { applyParameterEdit, editedPathParameters, parameterEditFor } from "./parameterEdits";
import {
  buildStepRequest,
  captureKeyOf,
  operationKeyOf,
  UNIQUE_TOKEN_PREFIX,
  type AuthPlan,
  type BuiltStepRequest,
  type ConsumedValue,
  type PerformanceContext,
} from "./stepRequest";

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

/**
 * A value the script takes from this step's response (AP-029 FR-010, AP-035 FR-007): a guided
 * workflow variable, whose body field is split on `.` as before, or an AP-035 capture.
 */
export interface StepCapture {
  key: string;
  name: string;
  source: { body: (string | number)[] } | { header: string };
}

export interface PlanStepRequest {
  journey: PerformanceJourney;
  step: PerformanceStep;
  operation: ApiOperation;
  /** The scenario as sent: with the step's body and parameter edits applied, if it has them (AP-033). */
  scenario: TestScenario;
  /** The approved scenario itself, before any edit. */
  generated: TestScenario;
  /** The values earlier steps fill in, keyed as the script holds them (AP-035 research R5). */
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

function segmentsData(segments: readonly BodyPathSegment[]): (string | number)[] {
  return segments.map((segment) => ("index" in segment ? segment.index : segment.field));
}

/**
 * AP-035 research R5: what a step consumes and captures, read from the step itself for both kinds
 * of journey, so a user-defined journey and a proposed one go through the same request builder.
 */
export function stepWiringOf(journey: PerformanceJourney, step: PerformanceStep): { consumed: ConsumedValue[]; captures: StepCapture[] } {
  const source = journey.source;
  if (source.kind === "workflow") {
    const consumed: ConsumedValue[] = [];
    const captures: StepCapture[] = [];
    for (const binding of step.variableBindings) {
      const key = workflowVariableName(source.workflowId, binding.variable);
      if (binding.role === "produces") captures.push({ key, name: binding.variable, source: { body: binding.field.split(".") } });
      else consumed.push({ key, name: binding.variable, location: binding.location ?? "body", field: binding.field });
    }
    return { consumed, captures };
  }
  return {
    consumed: (step.bindings ?? []).filter((binding) => binding.state === "active").map(consumedValueOf),
    captures: (step.captures ?? []).map((capture) => ({
      key: captureKeyOf(step.id, capture.name),
      name: capture.name,
      source: capture.source.kind === "body" ? { body: segmentsData(capture.source.segments) } : { header: capture.source.name },
    })),
  };
}

/** Every unique-value token of the plan, indexed in `plan.uniqueValueFields` order. */
export function uniqueTokensOf(plan: PerformancePlan, context: PerformanceContext): UniqueToken[] {
  const scenarios = new Map(context.approvedScenarios.map((scenario) => [scenario.id, scenario]));
  const steps = plan.journeys.flatMap((journey) => journey.steps);
  return plan.uniqueValueFields.map((field, index) => {
    const step = steps.find((candidate) => candidate.id === field.stepId);
    const generated = step ? scenarios.get(step.scenarioId) : undefined;
    // AP-033: the value the script varies comes from the body the step sends (research R3).
    const scenario = step && generated ? effectiveScenario(generated, bodyEditFor(plan, step)) : generated;
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
  const generated = context.approvedScenarios.find((candidate) => candidate.id === step.scenarioId);
  if (!operation || !generated) throw new Error(`The plan's step ${step.id} no longer matches the approvals.`);
  // AP-033 (research R3): the one place, with `buildJourneys`, where a body edit is applied.
  const edit = bodyEditFor(plan, step);
  const parameterEdit = parameterEditFor(plan, step);
  const scenario = applyParameterEdit(effectiveScenario(generated, edit), parameterEdit);

  const { consumed, captures } = stepWiringOf(journey, step);
  const stepUnique = unique.filter((entry) => entry.stepId === step.id);
  const built = buildStepRequest(context, auth, operation, scenario, {
    consumed,
    uniqueFields: stepUnique.map((entry) => ({ fieldPath: entry.fieldPath, token: entry.token })),
    bodyEdited: edit !== undefined,
    editedPathParameters: editedPathParameters(parameterEdit),
  });
  return { journey, step, operation, scenario, generated, consumed, captures, unique: stepUnique, built };
}
