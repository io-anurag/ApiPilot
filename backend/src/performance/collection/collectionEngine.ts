import type {
  Capture,
  CaptureSource,
  CollectionPlanInfo,
  PerformancePlan,
  PreviewAuth,
  PreviewParameter,
  PreviewReference,
  RemovedOperationPreview,
  StepRequestPreview,
} from "@apipilot/shared-domain";
import {
  DependencyOrderViolationError,
  InvalidExpectedStatusError,
  InvalidOrderError,
  InvalidPlanUpdateError,
  InvalidThresholdError,
  NotSupportedForCollectionPlanError,
  OperationNotRemovedError,
  StepNotFoundError,
  UserJourneyRefusedError,
} from "../errors";
import type { ScriptInputs } from "../k6/renderScript";
import { parseCapturePath } from "../plan/capturePath";
import { normalizeExpectedStatuses } from "../plan/expectedStatuses";
import { validateLoadProfile, validateThinkTime } from "../plan/loadProfiles";
import type { PlanEngine } from "../plan/openApiEngine";
import { parseThreshold } from "../plan/planUpdate";
import { previewValueOf } from "../plan/requestPreview";
import { templateReferences } from "../plan/stepRequest";
import { isValidCaptureName, normalizeHeaderName } from "../plan/userJourneyNames";
import {
  assembleCollectionPlan,
  defaultCollectionChoices,
  type AssembledRequest,
  type CollectionAssembly,
  type CollectionPlanChoices,
  type CollectionSource,
} from "./assembleCollectionPlan";
import type { AddedBinding } from "./bindCollectionPlan";
import { SUPPORTED_DYNAMIC_VARIABLES } from "./dynamicValues";

/**
 * AP-036 (specs/036-collection-performance-test research R2, contracts/collection-performance-api.md):
 * the `PlanEngine` of a collection plan. Every operation re-assembles the plan from the collection
 * snapshot it was built from and the engineer's choices, so the plan, its previews and the script's
 * inputs always agree. `PUT /plan` validates every field before applying any, so a refusal leaves
 * the plan unchanged.
 */
export const MAX_ADDED_CAPTURES = 10;

/** FR-020: the `PUT /plan` fields a collection plan does not offer. */
const NOT_SUPPORTED = [
  "bodyEdits",
  "parameterEdits",
  "userJourneys",
  "nextUserJourneyNumber",
  "journeyOrder",
  "editProposedJourney",
  "revertProposedJourney",
  "alsoStandalone",
  "excludedOperationKeys",
] as const;

/** The dynamic variables plans generate; empty means every one leaves its request out. */
export const COLLECTION_ASSEMBLE_OPTIONS = { supportedDynamicVariables: SUPPORTED_DYNAMIC_VARIABLES };

/** The choices each assembled plan was built from, so a route that saves the plan saves them too. */
const choicesByPlan = new WeakMap<PerformancePlan, CollectionPlanChoices>();

export function choicesFor(plan: PerformancePlan): CollectionPlanChoices | undefined {
  return choicesByPlan.get(plan);
}

export function assembleFor(source: CollectionSource, choices: CollectionPlanChoices, state?: CollectionPlanInfo["collectionState"]): CollectionAssembly {
  const assembly = assembleCollectionPlan(source, choices, { ...COLLECTION_ASSEMBLE_OPTIONS, collectionState: state });
  choicesByPlan.set(assembly.plan, choices);
  return assembly;
}

function cloneChoices(choices: CollectionPlanChoices): CollectionPlanChoices {
  return {
    ...choices,
    orderedRequestIds: [...choices.orderedRequestIds],
    excludedRequestIds: [...choices.excludedRequestIds],
    ...(choices.stepOrder ? { stepOrder: [...choices.stepOrder] } : {}),
    expectedStatusCodes: new Map(choices.expectedStatusCodes),
    thresholds: [...choices.thresholds],
    addedCaptures: new Map(choices.addedCaptures),
    addedBindings: new Map(choices.addedBindings),
  };
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidPlanUpdateError(`${what} must be an object.`);
  return value as Record<string, unknown>;
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new InvalidPlanUpdateError(`${what} must be a list.`);
  return value;
}

/** FR-019: one capture the engineer adds, under AP-035's name, path and header rules. */
function parseAddedCapture(raw: unknown, stepId: string): Capture {
  const capture = record(raw, "A capture");
  if (!isValidCaptureName(capture.name)) {
    throw new UserJourneyRefusedError("capture_name_invalid", "A capture name is letters, digits and underscores, does not start with a digit, and is at most 64 characters.", {
      stepId,
      name: typeof capture.name === "string" ? capture.name : "",
    });
  }
  const source = record(capture.source, "A capture's source");
  let parsed: CaptureSource;
  if (source.kind === "body") {
    const path = parseCapturePath(typeof source.path === "string" ? source.path : "");
    if (!path.ok) throw new UserJourneyRefusedError("capture_path_invalid", path.reason, { stepId, path: typeof source.path === "string" ? source.path : "", position: path.position });
    parsed = { kind: "body", path: path.path, segments: path.segments };
  } else if (source.kind === "header") {
    const name = normalizeHeaderName(source.name);
    if (name === null) {
      throw new UserJourneyRefusedError("capture_header_invalid", "A header capture needs a header name of 1 to 128 letters, digits or token characters.", {
        stepId,
        name: typeof source.name === "string" ? source.name : "",
      });
    }
    parsed = { kind: "header", name };
  } else throw new InvalidPlanUpdateError("A capture's source kind must be body or header.");
  // A typed body path is accepted, and labelled "Not documented in a specification" (FR-019).
  return { name: capture.name, source: parsed, documented: parsed.kind === "body" ? false : null, origin: { kind: "user" } };
}

export interface CollectionEngineState {
  source: CollectionSource;
  choices: CollectionPlanChoices;
  state: CollectionPlanInfo["collectionState"];
}

/** The steps and credential requests of an assembly, in binding order. */
function requestIds(assembly: CollectionAssembly): string[] {
  return assembly.order;
}

function applyAddedCaptures(raw: unknown, assembly: CollectionAssembly, choices: CollectionPlanChoices): void {
  const lists = record(raw, "addedCaptures");
  for (const [stepId, captures] of Object.entries(lists)) {
    const request = assembly.requests.get(stepId);
    if (!request) throw new InvalidPlanUpdateError(`'${stepId}' is not a step of this plan.`);
    const parsed = list(captures, "A step's added captures").map((capture) => parseAddedCapture(capture, stepId));
    if (parsed.length > MAX_ADDED_CAPTURES) {
      throw new UserJourneyRefusedError("too_many_captures", `A step can have at most ${MAX_ADDED_CAPTURES} captures you add.`, { stepId });
    }
    const converted = (request.step.captures ?? []).filter((capture) => capture.origin?.kind === "collection-script").map((capture) => capture.name);
    const seen = new Set<string>();
    for (const capture of parsed) {
      if (seen.has(capture.name) || converted.includes(capture.name)) {
        throw new UserJourneyRefusedError("capture_name_taken", "This step already captures a value with that name.", { stepId, name: capture.name });
      }
      seen.add(capture.name);
    }
    choices.addedCaptures.set(stepId, parsed);
  }
}

function applyAddedBindings(raw: unknown, assembly: CollectionAssembly, choices: CollectionPlanChoices): void {
  const lists = record(raw, "addedBindings");
  const order = requestIds(assembly);
  for (const [stepId, bindings] of Object.entries(lists)) {
    const request = assembly.requests.get(stepId);
    if (!request) throw new InvalidPlanUpdateError(`'${stepId}' is not a step of this plan.`);
    const parsed = list(bindings, "A step's added bindings").map((raw): AddedBinding => {
      const binding = record(raw, "A binding");
      if (typeof binding.name !== "string" || typeof binding.captureStepId !== "string" || typeof binding.captureName !== "string") {
        throw new InvalidPlanUpdateError("A binding needs the reference's name, and the capture's step and name.");
      }
      return { name: binding.name, captureStepId: binding.captureStepId, captureName: binding.captureName };
    });
    for (const binding of parsed) {
      if (!request.referenceNames.includes(binding.name)) {
        throw new UserJourneyRefusedError("binding_target_unknown", `The step uses no {{${binding.name}}}.`, { stepId, target: binding.name });
      }
      const producerCaptures = binding.captureStepId === stepId ? [] : choices.addedCaptures.get(binding.captureStepId) ?? [];
      const producer = assembly.requests.get(binding.captureStepId);
      const captures = [...(producer?.step.captures ?? []).filter((capture) => capture.origin?.kind !== "user"), ...producerCaptures];
      const earlier = order.indexOf(binding.captureStepId) >= 0 && order.indexOf(binding.captureStepId) < order.indexOf(stepId);
      if (!producer || !earlier || !captures.some((capture) => capture.name === binding.captureName)) {
        throw new UserJourneyRefusedError("binding_capture_unknown", "A value can only come from a capture of an earlier step.", { stepId, captureName: binding.captureName });
      }
    }
    choices.addedBindings.set(stepId, parsed);
  }
}

/** AP-035 `capture_in_use`: an added capture still bound by an added binding cannot be removed. */
function checkCapturesInUse(choices: CollectionPlanChoices, assembly: CollectionAssembly): void {
  for (const [stepId, bindings] of choices.addedBindings) {
    for (const binding of bindings) {
      const producer = assembly.requests.get(binding.captureStepId);
      const converted = (producer?.step.captures ?? []).some((capture) => capture.name === binding.captureName && capture.origin?.kind === "collection-script");
      const added = (choices.addedCaptures.get(binding.captureStepId) ?? []).some((capture) => capture.name === binding.captureName);
      if (!converted && !added) {
        throw new UserJourneyRefusedError("capture_in_use", "A later step uses this capture. Remove that binding first.", { stepId, captureName: binding.captureName });
      }
    }
  }
}

/** FR-008: a move that would place a binding before its capture is refused, naming the value. */
function validateCollectionStepOrder(plan: PerformancePlan, raw: unknown): string[] {
  const orders = record(raw, "stepOrder");
  const journey = plan.journeys[0];
  let result: string[] | undefined;
  for (const [journeyId, order] of Object.entries(orders)) {
    if (!journey || journeyId !== journey.id) throw new InvalidOrderError(`'${journeyId}' is not a journey in this plan.`);
    const ids = list(order, "A step order");
    const current = journey.steps.map((step) => step.id);
    if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => typeof id === "string" && current.includes(id))) {
      throw new InvalidOrderError("The step order must contain each existing id exactly once.");
    }
    const position = new Map((ids as string[]).map((id, index) => [id, index]));
    for (const step of journey.steps) {
      for (const binding of step.bindings ?? []) {
        const producer = position.get(binding.captureStepId);
        if (producer !== undefined && producer > position.get(step.id)!) {
          throw new DependencyOrderViolationError(binding.captureName, binding.captureStepId, step.id);
        }
      }
    }
    result = ids as string[];
  }
  return result ?? journey?.steps.map((step) => step.id) ?? [];
}

function applyExpectedStatuses(raw: unknown, assembly: CollectionAssembly, choices: CollectionPlanChoices): void {
  const lists = record(raw, "expectedStatuses");
  for (const [stepId, codes] of Object.entries(lists)) {
    if (!assembly.requests.has(stepId)) throw new InvalidExpectedStatusError(stepId, "There is no step or credential request with this id.");
    choices.expectedStatusCodes.set(stepId, normalizeExpectedStatuses(stepId, codes, []).map((status) => status.code));
  }
}

/** The `PUT /plan` choices, validated against the plan as it is (contract "Changes to the shared routes"). */
export function applyCollectionUpdate(current: CollectionEngineState, plan: PerformancePlan, update: unknown): CollectionPlanChoices {
  const body = record(update, "The request body");
  for (const field of NOT_SUPPORTED) if (field in body) throw new NotSupportedForCollectionPlanError(field);
  if ("scope" in body) throw new InvalidPlanUpdateError("The requests in a collection plan follow the run panel's selection.");
  const assembly = assembleFor(current.source, current.choices, current.state);
  const choices = cloneChoices(current.choices);

  if ("excludedRequestIds" in body) {
    const ids = list(body.excludedRequestIds, "excludedRequestIds");
    const unknown = ids.find((id) => typeof id !== "string" || !choices.orderedRequestIds.includes(id));
    if (unknown !== undefined) throw new InvalidPlanUpdateError(`'${String(unknown)}' is not a request of this plan.`);
    choices.excludedRequestIds = [...new Set(ids as string[])];
  }
  if ("loadProfile" in body) choices.loadProfile = validateLoadProfile(body.loadProfile);
  if ("thinkTimeMs" in body) choices.thinkTimeMs = validateThinkTime(body.thinkTimeMs);
  if ("thresholds" in body) {
    if (!Array.isArray(body.thresholds)) throw new InvalidThresholdError("thresholds must be a list.");
    const stepIds = new Set(plan.journeys.flatMap((journey) => journey.steps.map((step) => step.id)));
    choices.thresholds = body.thresholds.map((raw) => parseThreshold(raw, stepIds));
  }
  if ("expectedStatuses" in body) applyExpectedStatuses(body.expectedStatuses, assembly, choices);
  if ("stepOrder" in body) choices.stepOrder = validateCollectionStepOrder(plan, body.stepOrder);
  if ("addedCaptures" in body) applyAddedCaptures(body.addedCaptures, assembly, choices);
  if ("addedBindings" in body) applyAddedBindings(body.addedBindings, assembly, choices);
  if ("addedCaptures" in body || "addedBindings" in body) checkCapturesInUse(choices, assembly);
  if ("conversionReviewed" in body) {
    if (body.conversionReviewed !== true) throw new InvalidPlanUpdateError("conversionReviewed can only be true.");
    // R14: what the engineer reviewed is the conversion as it is now.
    choices.reviewedConversionDigest = assembly.plan.collection!.review.conversionDigest;
  }
  return choices;
}

function authTexts(request: AssembledRequest): string[] {
  const { auth } = request.template;
  if (auth.kind === "bearer") return [auth.token];
  if (auth.kind === "basic") return [auth.username, auth.password];
  if (auth.kind === "apikey") return [auth.value];
  return [];
}

/** Contract `GET /plan/steps/:stepId/request`: the request as the script sends it. Never a value. */
export function collectionRequestPreview(request: AssembledRequest): StepRequestPreview {
  const classify = (name: string): PreviewReference => request.references.get(name) ?? { kind: "environment", name, secret: false };
  const { template, step } = request;
  const queryStart = template.url.indexOf("?");
  const query = queryStart < 0 ? "" : template.url.slice(queryStart + 1);
  const parameters: PreviewParameter[] = [];
  for (const entry of query.length > 0 ? query.split("&") : []) {
    const separator = entry.indexOf("=");
    parameters.push({ location: "query", name: separator < 0 ? entry : entry.slice(0, separator), value: previewValueOf(separator < 0 ? "" : entry.slice(separator + 1), classify) });
  }
  for (const header of template.headers) parameters.push({ location: "header", name: header.key, value: previewValueOf(header.value, classify) });
  const auth: PreviewAuth = {
    kind: step.auth.kind,
    schemeName: step.auth.schemeName,
    location: template.auth.kind === "none" ? null : template.auth.kind === "apikey" ? template.auth.in : "header",
    references: [...new Set(authTexts(request).flatMap(templateReferences))].map(classify),
  };
  return {
    stepId: step.id,
    operationKey: step.operationKey,
    method: step.method,
    pathTemplate: step.path,
    parameters,
    auth,
    body:
      template.body === undefined
        ? null
        : { contentType: template.bodyKind === "json" ? "json" : "text", text: template.body, references: [...new Set(templateReferences(template.body))].map(classify) },
    bodyStatus: template.body === undefined ? "not-documented" : "sent",
    bodyEdit: null,
    parameterEdit: null,
  };
}

/** The renderer's inputs (research R2). */
export function collectionScriptInputs(assembly: CollectionAssembly): ScriptInputs {
  const steps = new Map(
    [...assembly.requests.values()]
      .filter((request) => !request.credential)
      .map((request) => [
        request.step.id,
        {
          operationKey: request.step.operationKey,
          request: request.template,
          expected: request.step.expectedStatuses.map((status) => status.code),
          needs: request.needs,
          dependsOn: request.dependsOn,
          captures: request.captures,
          tokenSchemes: request.tokenSchemes,
        },
      ]),
  );
  return { steps, tokenSources: assembly.tokenSources, unique: [], dynamic: assembly.dynamic };
}

/**
 * The collection source's engine over one store entry (R2). `gate` errors for the script are the
 * handle's (`PlanHandle.gate`); `scriptInputs` repeats them so no other caller can bypass them.
 */
export function collectionEngine(current: CollectionEngineState, gate: () => void): PlanEngine {
  const assemble = (choices: CollectionPlanChoices) => assembleFor(current.source, choices, current.state);
  return {
    applyUpdate: (plan, body) => assemble(applyCollectionUpdate(current, plan, body)).plan,
    reset: () => {
      const choices = defaultCollectionChoices(current.choices.orderedRequestIds);
      return assemble({ ...choices, addedCaptures: new Map(current.choices.addedCaptures), addedBindings: new Map(current.choices.addedBindings) }).plan;
    },
    stepRequestPreview: (_plan, stepId) => {
      const request = assemble(current.choices).requests.get(stepId);
      if (!request) throw new StepNotFoundError(stepId);
      return collectionRequestPreview(request);
    },
    removedPreview: (_plan, itemId): RemovedOperationPreview => {
      if (!current.choices.excludedRequestIds.includes(itemId)) throw new OperationNotRemovedError(itemId);
      const restored = assemble({ ...cloneChoices(current.choices), excludedRequestIds: current.choices.excludedRequestIds.filter((id) => id !== itemId) });
      const request = [...restored.requests.values()].find((candidate) => candidate.step.collectionRequest?.itemId === itemId);
      if (!request) throw new OperationNotRemovedError(itemId);
      return { step: request.step, request: collectionRequestPreview(request) };
    },
    responseFields: () => null,
    scriptInputs: (plan) => {
      gate();
      const assembly = assemble(current.choices);
      if (assembly.plan.fingerprint !== plan.fingerprint) throw new Error("The collection plan changed while its script was being generated.");
      return collectionScriptInputs(assembly);
    },
  };
}
