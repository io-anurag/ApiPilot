import type {
  ApiOperation,
  BindingTarget,
  BodyEdit,
  Capture,
  CaptureSource,
  ParameterEdit,
  PerformancePlan,
  UserJourneyDefinition,
  UserJourneyStepDefinition,
  ValueBinding,
} from "@apipilot/shared-domain";
import { compareCodeUnits } from "../../postman/ordering";
import { DependencyOrderViolationError, InvalidPlanUpdateError, UnknownOperationError, UserJourneyRefusedError } from "../errors";
import { effectiveScenario } from "./bodyEdits";
import { parseCapturePath, valueAtPath } from "./capturePath";
import { userJourneyIdFor, userJourneyStepIdFor } from "./identifiers";
import { selectPerformanceScenario } from "./selectScenario";
import { isDocumentedParameter, operationKeyOf, type PerformanceContext } from "./stepRequest";
import { isValidCaptureName, normalizeHeaderName, normalizeJourneyName } from "./userJourneyNames";

/**
 * AP-035 `PUT /plan { userJourneys, alsoStandalone }` (specs/035-user-defined-journeys
 * contracts/plan-journeys-api.md; research R2, R3, R10, R11). The client sends the complete list
 * of definitions; it is validated as a whole against the current plan, and nothing is applied when
 * anything is refused. Ids, origins and the fields derived from the specification are the server's:
 * a client-sent `origin`, `fromProposedStepId`, `documented`, `state`, `confidence` or
 * `relationshipId` is ignored. ApiPilot never adds a journey, step, capture or binding the client
 * did not send (FR-006). Pure.
 */
export const MAX_JOURNEY_STEPS = 20;
const JOURNEY_ID = /^j_[0-9a-f]{16}$/;
const STEP_ID = /^s_[0-9a-f]{16}$/;
export const MAX_STEP_CAPTURES = 10;

const TARGET_ORDER: Record<BindingTarget["kind"], number> = { path: 0, query: 1, header: 2, body: 3 };

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidPlanUpdateError(`${what} must be an object.`);
  return value as Record<string, unknown>;
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new InvalidPlanUpdateError(`${what} must be a list.`);
  return value;
}

export function targetText(target: BindingTarget): string {
  return target.kind === "body" ? `body ${target.fieldPath}` : `${target.kind} ${target.name}`;
}

function targetKey(target: BindingTarget): string {
  return target.kind === "body" ? `body:${target.fieldPath}` : `${target.kind}:${target.kind === "header" ? target.name.toLowerCase() : target.name}`;
}

function parseSource(raw: unknown): CaptureSource {
  const source = record(raw, "A capture's source");
  if (source.kind === "body") {
    if (typeof source.path !== "string") throw new InvalidPlanUpdateError("A body capture needs a field path.");
    const parsed = parseCapturePath(source.path);
    if (!parsed.ok) throw new UserJourneyRefusedError("capture_path_invalid", parsed.reason, { path: source.path, position: parsed.position });
    return { kind: "body", path: parsed.path, segments: parsed.segments };
  }
  if (source.kind === "header") {
    const name = normalizeHeaderName(source.name);
    if (name === null) {
      throw new UserJourneyRefusedError("capture_header_invalid", "A header capture needs a header name of 1 to 128 letters, digits or token characters.", {
        name: typeof source.name === "string" ? source.name : "",
      });
    }
    return { kind: "header", name };
  }
  throw new InvalidPlanUpdateError("A capture's source kind must be body or header.");
}

function parseTarget(raw: unknown): BindingTarget {
  const target = record(raw, "A binding's target");
  if (target.kind === "path" || target.kind === "query" || target.kind === "header") {
    if (typeof target.name !== "string" || target.name.length === 0) throw new InvalidPlanUpdateError("A parameter target needs a name.");
    return { kind: target.kind, name: target.name };
  }
  if (target.kind === "body") {
    if (typeof target.fieldPath !== "string") throw new InvalidPlanUpdateError("A body target needs a field path.");
    const parsed = parseCapturePath(target.fieldPath);
    if (!parsed.ok) throw new UserJourneyRefusedError("capture_path_invalid", parsed.reason, { path: target.fieldPath, position: parsed.position });
    return { kind: "body", fieldPath: parsed.path };
  }
  throw new InvalidPlanUpdateError("A binding's target kind must be path, query, header or body.");
}

interface RawBinding {
  target: BindingTarget;
  captureStepId?: string;
  captureStepIndex?: number;
  captureName: string;
}

/** Header names the step's authentication sends, which a binding may not take (spec Edge Cases). */
function authHeaders(operation: ApiOperation, context: PerformanceContext): Set<string> {
  const names = new Set<string>(["authorization"]);
  for (const requirement of operation.security) {
    for (const { name } of requirement.schemes) {
      const scheme = context.apiModel.securitySchemes[name];
      if (scheme?.type === "apiKey" && scheme.in === "header" && scheme.name) names.add(scheme.name.toLowerCase());
    }
  }
  return names;
}

/** The step's base body (AP-033 R1): the edit, when it applies to the step's scenario, or the generated body. */
function baseBodyOf(operation: ApiOperation, context: PerformanceContext, stepId: string, bodyEdits: readonly BodyEdit[]): { known: boolean; body: unknown } {
  const selection = selectPerformanceScenario(context.approvedScenarios, operation);
  if ("omitted" in selection) return { known: false, body: undefined };
  const edit = bodyEdits.find((candidate) => candidate.stepId === stepId && candidate.scenarioId === selection.scenario.id);
  return { known: true, body: effectiveScenario(selection.scenario, edit).request.body };
}

export interface ValidatedUserJourneys {
  userJourneys: UserJourneyDefinition[];
  nextUserJourneyNumber: number;
}

/**
 * `restoring` (research R12): a past run's definitions, sent back with its `nextUserJourneyNumber`.
 * Their ids are accepted when well-formed and not used by another journey or step of the plan, and
 * the sequence numbers become the larger of the two, so a new id can never repeat a restored one.
 */
export function validateUserJourneys(
  raw: unknown,
  plan: PerformancePlan,
  context: PerformanceContext,
  edits: { bodyEdits: readonly BodyEdit[]; parameterEdits: readonly ParameterEdit[] },
  restoring: { nextUserJourneyNumber: number } | null = null,
): ValidatedUserJourneys {
  const previous = new Map((plan.userJourneys ?? []).map((definition) => [definition.id, definition]));
  const operations = new Map(context.apiModel.operations.map((operation) => [operationKeyOf(operation), operation]));
  let nextJourney = Math.max(plan.nextUserJourneyNumber ?? 1, restoring?.nextUserJourneyNumber ?? 1);
  const otherJourneyIds = new Set(plan.journeys.filter((journey) => journey.source.kind !== "user").map((journey) => journey.id));
  const otherStepIds = new Set(plan.journeys.filter((journey) => journey.source.kind !== "user").flatMap((journey) => journey.steps.map((step) => step.id)));
  const seenJourneys = new Set<string>();
  const result: UserJourneyDefinition[] = [];

  for (const rawJourney of list(raw, "userJourneys")) {
    const journey = record(rawJourney, "Each user journey");
    let id: string;
    if (journey.id === undefined) {
      id = userJourneyIdFor(nextJourney);
      nextJourney += 1;
    } else if (typeof journey.id === "string" && previous.has(journey.id)) {
      id = journey.id;
    } else if (restoring && typeof journey.id === "string" && JOURNEY_ID.test(journey.id) && !otherJourneyIds.has(journey.id)) {
      id = journey.id;
    } else {
      throw new UserJourneyRefusedError("invalid_user_journey", "A journey id is not one of this plan's journeys.", { journeyId: String(journey.id) });
    }
    if (seenJourneys.has(id)) throw new UserJourneyRefusedError("invalid_user_journey", "Each journey may appear once.", { journeyId: id });
    seenJourneys.add(id);
    const prior = previous.get(id);
    const name = normalizeJourneyName(journey.name);
    if (name === null) {
      throw new UserJourneyRefusedError("invalid_user_journey", "A journey name is 1 to 100 characters, with no control characters.", { journeyId: id });
    }
    const rawSteps = list(journey.steps, "A journey's steps");
    if (rawSteps.length === 0) throw new UserJourneyRefusedError("invalid_user_journey", "A journey needs at least one step.", { journeyId: id });
    if (rawSteps.length > MAX_JOURNEY_STEPS) {
      throw new UserJourneyRefusedError("journey_too_long", `A journey holds at most ${MAX_JOURNEY_STEPS} steps.`, { journeyId: id });
    }

    // First pass: ids, operations and captures.
    const priorSteps = new Map((prior?.steps ?? []).map((step) => [step.id, step]));
    const restored = !prior && restoring !== null;
    let nextStep = Math.max(prior?.nextStepNumber ?? 1, restored && Number.isInteger(journey.nextStepNumber) ? (journey.nextStepNumber as number) : 1);
    const steps: (UserJourneyStepDefinition & { rawBindings: RawBinding[] })[] = [];
    const captureNames = new Set<string>();
    for (const rawStep of rawSteps) {
      const step = record(rawStep, "Each journey step");
      let stepId: string;
      if (step.id === undefined) {
        stepId = userJourneyStepIdFor(id, nextStep);
        nextStep += 1;
      } else if (
        typeof step.id === "string" &&
        (priorSteps.has(step.id) || (restored && STEP_ID.test(step.id) && !otherStepIds.has(step.id))) &&
        !steps.some((candidate) => candidate.id === step.id)
      ) {
        stepId = step.id;
      } else {
        throw new UserJourneyRefusedError("invalid_user_journey", "A step id is not one of this journey's steps, or appears twice.", { journeyId: id });
      }
      if (typeof step.operationKey !== "string") throw new InvalidPlanUpdateError("Each step needs an operationKey.");
      if (!operations.has(step.operationKey)) throw new UnknownOperationError(step.operationKey);
      const priorStep = priorSteps.get(stepId);
      const rawCaptures = list(step.captures ?? [], "A step's captures");
      if (rawCaptures.length > MAX_STEP_CAPTURES) {
        throw new UserJourneyRefusedError("too_many_captures", `A step holds at most ${MAX_STEP_CAPTURES} captures.`, { stepId });
      }
      const captures: Capture[] = rawCaptures.map((rawCapture) => {
        const capture = record(rawCapture, "Each capture");
        if (!isValidCaptureName(capture.name)) {
          throw new UserJourneyRefusedError(
            "capture_name_invalid",
            "A capture name is letters, digits and underscores, does not start with a digit, and is at most 64 characters.",
            { name: typeof capture.name === "string" ? capture.name : "" },
          );
        }
        if (captureNames.has(capture.name)) {
          throw new UserJourneyRefusedError("capture_name_taken", `The name ${capture.name} is already used by a capture in this journey.`, {
            name: capture.name,
            journeyId: id,
          });
        }
        captureNames.add(capture.name);
        const source = parseSource(capture.source);
        const priorCapture = priorStep?.captures.find((candidate) => candidate.name === capture.name);
        return {
          name: capture.name,
          source,
          documented: source.kind === "header" ? null : true,
          ...(priorCapture?.relationshipId ? { relationshipId: priorCapture.relationshipId } : {}),
        };
      });
      const rawBindings = list(step.bindings ?? [], "A step's bindings").map((rawBinding): RawBinding => {
        const binding = record(rawBinding, "Each binding");
        if (typeof binding.captureName !== "string") throw new InvalidPlanUpdateError("Each binding needs a captureName.");
        const byId = typeof binding.captureStepId === "string" ? binding.captureStepId : undefined;
        const byIndex = Number.isInteger(binding.captureStepIndex) ? (binding.captureStepIndex as number) : undefined;
        if (byId === undefined && byIndex === undefined) throw new InvalidPlanUpdateError("Each binding needs a captureStepId or a captureStepIndex.");
        return { target: parseTarget(binding.target), captureName: binding.captureName, ...(byId ? { captureStepId: byId } : { captureStepIndex: byIndex }) };
      });
      steps.push({
        id: stepId,
        operationKey: step.operationKey,
        ...(priorStep?.fromProposedStepId ? { fromProposedStepId: priorStep.fromProposedStepId } : {}),
        captures,
        bindings: [],
        rawBindings,
      });
    }

    // Second pass: bindings, now that every step of the journey has its id.
    const position = new Map(steps.map((step, index) => [step.id, index]));
    const priorCaptureSteps = new Map((prior?.steps ?? []).map((step) => [step.id, new Set(step.captures.map((capture) => capture.name))]));
    steps.forEach((step, index) => {
      const operation = operations.get(step.operationKey)!;
      const priorStep = priorSteps.get(step.id);
      const taken = new Set<string>();
      const bindings: ValueBinding[] = step.rawBindings.map((binding) => {
        const captureStepId = binding.captureStepId ?? steps[binding.captureStepIndex!]?.id;
        const producerIndex = captureStepId === undefined ? undefined : position.get(captureStepId);
        const usedBy = steps.filter((other) => other.rawBindings.some((candidate) => candidate.captureName === binding.captureName)).map((other) => other.id);
        if (producerIndex === undefined) {
          if (captureStepId !== undefined && priorCaptureSteps.get(captureStepId)?.has(binding.captureName)) {
            throw new UserJourneyRefusedError("capture_in_use", `${binding.captureName} is used by a later step. Remove those bindings first.`, {
              capture: binding.captureName,
              stepIds: usedBy,
            });
          }
          throw new UserJourneyRefusedError("binding_capture_unknown", `No earlier step of this journey captures ${binding.captureName}.`, {
            stepId: step.id,
            captureName: binding.captureName,
          });
        }
        if (producerIndex >= index) throw new DependencyOrderViolationError(binding.captureName, captureStepId!, step.id);
        const producer = steps[producerIndex];
        if (!producer.captures.some((capture) => capture.name === binding.captureName)) {
          if (priorCaptureSteps.get(producer.id)?.has(binding.captureName)) {
            throw new UserJourneyRefusedError("capture_in_use", `${binding.captureName} is used by a later step. Remove those bindings first.`, {
              capture: binding.captureName,
              stepIds: usedBy,
            });
          }
          throw new UserJourneyRefusedError("binding_capture_unknown", `Step ${producerIndex + 1} has no capture named ${binding.captureName}.`, {
            stepId: step.id,
            captureName: binding.captureName,
          });
        }
        const key = targetKey(binding.target);
        if (taken.has(key)) {
          throw new UserJourneyRefusedError("binding_target_taken", `${targetText(binding.target)} is already filled by another captured value.`, {
            stepId: step.id,
            target: targetText(binding.target),
          });
        }
        taken.add(key);
        const priorBinding = priorStep?.bindings.find((candidate) => targetKey(candidate.target) === key);
        // A binding kept as it was is not checked again: if a rebuild removed its target, assembly
        // marks it "Target no longer exists" (FR-016) rather than refusing every other edit.
        const kept = priorBinding !== undefined && priorBinding.captureStepId === captureStepId && priorBinding.captureName === binding.captureName;
        if (!kept || priorBinding.state === "active") checkTarget(binding.target, operation, context, step.id, edits, kept);
        return {
          target: binding.target,
          captureStepId: captureStepId!,
          captureName: binding.captureName,
          state: "active",
          ...(priorBinding?.confidence ? { confidence: priorBinding.confidence } : {}),
          ...(priorBinding?.relationshipId ? { relationshipId: priorBinding.relationshipId } : {}),
        };
      });
      bindings.sort(
        (a, b) =>
          TARGET_ORDER[a.target.kind] - TARGET_ORDER[b.target.kind] ||
          compareCodeUnits(a.target.kind === "body" ? a.target.fieldPath : a.target.name, b.target.kind === "body" ? b.target.fieldPath : b.target.name),
      );
      step.bindings = bindings;
    });

    result.push({
      id,
      name,
      origin: prior?.origin ?? { kind: "defined" },
      steps: steps.map(({ rawBindings: _unused, ...step }) => step),
      nextStepNumber: nextStep,
    });
  }
  return { userJourneys: result, nextUserJourneyNumber: nextJourney };
}

/** FR-011, FR-014 (research R10): a binding may fill only a documented parameter or an existing body field. */
function checkTarget(
  target: BindingTarget,
  operation: ApiOperation,
  context: PerformanceContext,
  stepId: string,
  edits: { bodyEdits: readonly BodyEdit[]; parameterEdits: readonly ParameterEdit[] },
  kept: boolean,
): void {
  const unknown = (message: string) => new UserJourneyRefusedError("binding_target_unknown", message, { stepId, target: targetText(target) });
  if (target.kind === "body") {
    // A kept body binding whose field an edit in this same update removes is dropped by assembly
    // with a notice (FR-013), so only a new one is checked against the body.
    if (kept) return;
    const base = baseBodyOf(operation, context, stepId, edits.bodyEdits);
    const parsed = parseCapturePath(target.fieldPath);
    if (base.known && (!parsed.ok || valueAtPath(base.body, parsed.segments) === undefined)) {
      throw unknown(`The step's body has no field ${target.fieldPath}.`);
    }
    return;
  }
  const documented = isDocumentedParameter(operation, target.kind, target.name);
  if (!documented) throw unknown(`The specification documents no ${target.kind} parameter ${target.name} for this operation.`);
  if (target.kind === "header" && authHeaders(operation, context).has(target.name.toLowerCase())) {
    throw unknown(`${target.name} is sent by the step's authentication, which a captured value cannot fill.`);
  }
  const edit = edits.parameterEdits.find((candidate) => candidate.stepId === stepId);
  if (edit?.parameters.some((entry) => entry.location === target.kind && entry.name === target.name)) {
    throw new UserJourneyRefusedError(
      "parameter_edited",
      `${target.name} has an edited value. Binding it drops that value: send the binding with the step's parameter edits without it.`,
      { stepId, name: target.name },
    );
  }
}

/** FR-003: `alsoStandalone` names operations that are in a user journey. */
export function validateAlsoStandalone(raw: unknown, userJourneys: readonly UserJourneyDefinition[]): string[] {
  const keys = list(raw, "alsoStandalone");
  const inJourneys = new Set(userJourneys.flatMap((definition) => definition.steps.map((step) => step.operationKey)));
  for (const key of keys) {
    if (typeof key !== "string" || !inJourneys.has(key)) {
      throw new UserJourneyRefusedError("invalid_standalone", "Only an operation in a user journey can also run on its own.", {
        operationKey: typeof key === "string" ? key : "",
      });
    }
  }
  return [...new Set(keys as string[])].sort(compareCodeUnits);
}

/**
 * The definitions as `PUT /plan` would receive them back (research R12): what a client sends to
 * keep the plan's journeys unchanged, and what restore sends from a snapshot.
 */
export function userJourneysInput(definitions: readonly UserJourneyDefinition[]): unknown[] {
  return definitions.map((definition) => ({
    id: definition.id,
    name: definition.name,
    steps: definition.steps.map((step) => ({
      id: step.id,
      operationKey: step.operationKey,
      captures: step.captures.map((capture) => ({
        name: capture.name,
        source: capture.source.kind === "body" ? { kind: "body", path: capture.source.path } : { kind: "header", name: capture.source.name },
      })),
      bindings: step.bindings.map((binding) => ({ target: binding.target, captureStepId: binding.captureStepId, captureName: binding.captureName })),
    })),
    nextStepNumber: definition.nextStepNumber,
  }));
}
