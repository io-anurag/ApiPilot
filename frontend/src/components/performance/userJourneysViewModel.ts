import type { BindingTarget, PerformancePlan, UserJourneyDefinition } from "@apipilot/shared-domain";
import type { PerformanceErrorResult, UserJourneyInput } from "../../services/performanceTestingClient";

/**
 * AP-035 (specs/035-user-defined-journeys contracts/plan-journeys-api.md): the journey editor's
 * pure helpers. The editor always sends the complete list of definitions (research R3); each edit
 * here returns a new list and changes nothing in place, and the server validates and assigns ids.
 */
type CaptureInput = UserJourneyInput["steps"][number]["captures"][number];
type BindingInput = UserJourneyInput["steps"][number]["bindings"][number];

/** The plan's definitions as `PUT /plan` takes them back. */
export function journeysInputOf(definitions: readonly UserJourneyDefinition[]): UserJourneyInput[] {
  return definitions.map((definition) => ({
    id: definition.id,
    name: definition.name,
    steps: definition.steps.map((step) => ({
      id: step.id,
      operationKey: step.operationKey,
      captures: step.captures.map((capture) => ({
        name: capture.name,
        source: capture.source.kind === "body" ? { kind: "body" as const, path: capture.source.path } : { kind: "header" as const, name: capture.source.name },
      })),
      bindings: step.bindings.map((binding) => ({ target: binding.target, captureStepId: binding.captureStepId, captureName: binding.captureName })),
    })),
  }));
}

function update(journeys: readonly UserJourneyInput[], journeyId: string, change: (journey: UserJourneyInput) => UserJourneyInput): UserJourneyInput[] {
  return journeys.map((journey) => (journey.id === journeyId ? change(journey) : journey));
}

export function withNewJourney(journeys: readonly UserJourneyInput[], name: string, operationKey: string): UserJourneyInput[] {
  return [...journeys, { name, steps: [{ operationKey, captures: [], bindings: [] }] }];
}

export function withoutJourney(journeys: readonly UserJourneyInput[], journeyId: string): UserJourneyInput[] {
  return journeys.filter((journey) => journey.id !== journeyId);
}

export function renamed(journeys: readonly UserJourneyInput[], journeyId: string, name: string): UserJourneyInput[] {
  return update(journeys, journeyId, (journey) => ({ ...journey, name }));
}

export function withStepAdded(journeys: readonly UserJourneyInput[], journeyId: string, operationKey: string): UserJourneyInput[] {
  return update(journeys, journeyId, (journey) => ({ ...journey, steps: [...journey.steps, { operationKey, captures: [], bindings: [] }] }));
}

/** Removing a step whose capture a later step uses is refused by the server, naming the capture (FR-015). */
export function withoutStep(journeys: readonly UserJourneyInput[], journeyId: string, stepId: string): UserJourneyInput[] {
  return update(journeys, journeyId, (journey) => ({ ...journey, steps: journey.steps.filter((step) => step.id !== stepId) }));
}

export function withCapture(journeys: readonly UserJourneyInput[], journeyId: string, stepId: string, capture: CaptureInput): UserJourneyInput[] {
  return update(journeys, journeyId, (journey) => ({
    ...journey,
    steps: journey.steps.map((step) => (step.id === stepId ? { ...step, captures: [...step.captures, capture] } : step)),
  }));
}

export function withoutCapture(journeys: readonly UserJourneyInput[], journeyId: string, stepId: string, name: string): UserJourneyInput[] {
  return update(journeys, journeyId, (journey) => ({
    ...journey,
    steps: journey.steps.map((step) => (step.id === stepId ? { ...step, captures: step.captures.filter((capture) => capture.name !== name) } : step)),
  }));
}

export function sameTarget(a: BindingTarget, b: BindingTarget): boolean {
  if (a.kind === "body" || b.kind === "body") return a.kind === b.kind && (a as { fieldPath: string }).fieldPath === (b as { fieldPath: string }).fieldPath;
  return a.kind === b.kind && a.name === b.name;
}

export function withBinding(journeys: readonly UserJourneyInput[], journeyId: string, stepId: string, binding: BindingInput): UserJourneyInput[] {
  return update(journeys, journeyId, (journey) => ({
    ...journey,
    steps: journey.steps.map((step) =>
      step.id === stepId ? { ...step, bindings: [...step.bindings.filter((existing) => !sameTarget(existing.target, binding.target)), binding] } : step,
    ),
  }));
}

export function withoutBinding(journeys: readonly UserJourneyInput[], journeyId: string, stepId: string, target: BindingTarget): UserJourneyInput[] {
  return update(journeys, journeyId, (journey) => ({
    ...journey,
    steps: journey.steps.map((step) => (step.id === stepId ? { ...step, bindings: step.bindings.filter((binding) => !sameTarget(binding.target, target)) } : step)),
  }));
}

export function targetLabel(target: BindingTarget): string {
  return target.kind === "body" ? `body ${target.fieldPath}` : `${target.kind} ${target.name}`;
}

/** The `{name}` placeholders of an operation path template, for the capture picker's hint (FR-009). */
export function pathParameterNames(operationKey: string): string[] {
  return [...operationKey.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
}

/**
 * FR-014: the step's parameter edits without the one a binding replaces, as `PUT /plan` takes them,
 * or `null` when nothing else is edited.
 */
export function parameterEditsWithout(plan: PerformancePlan, stepId: string, name: string): { parameters: PerformancePlan["parameterEdits"][number]["parameters"] } | null {
  const edit = plan.parameterEdits.find((candidate) => candidate.stepId === stepId);
  const rest = (edit?.parameters ?? []).filter((entry) => entry.name !== name);
  return rest.length > 0 ? { parameters: rest } : null;
}

/** The engineer-facing message of a journey refusal (FR-015, FR-016), or `null` to use the server's. */
export function journeyRefusalText(result: PerformanceErrorResult, stepLabel: (stepId: string) => string): string | null {
  if (result.error === "dependency_order_violation" && result.variable) {
    return `That order would run a step before the step that produces ${result.variable}. The order is unchanged.`;
  }
  if (result.error === "capture_in_use" && result.capture) {
    const steps = (result.stepIds ?? []).map(stepLabel).join(", ");
    return `${result.capture} is used by ${steps || "a later step"}. Remove those bindings first. Nothing was changed.`;
  }
  if (result.error === "binding_target_missing") {
    return "A captured value's target no longer exists. Remove or re-target each binding marked \"Target no longer exists\".";
  }
  return null;
}

/**
 * The fields of a JSON body, in the capture path grammar (research R6), for a binding's target
 * list (FR-011). A body that is not JSON, or not an object, offers none.
 */
export function bodyFieldPaths(text: string | undefined, limit = 200): string[] {
  if (!text) return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  const out: string[] = [];
  const walk = (node: unknown, path: string, depth: number) => {
    if (out.length >= limit || depth > 8) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [name, child] of Object.entries(node as Record<string, unknown>)) {
        if (!/^[A-Za-z0-9_$-]+$/.test(name)) continue;
        const next = path === "" ? name : `${path}.${name}`;
        if (child === null || typeof child !== "object") out.push(next);
        walk(child, next, depth + 1);
      }
    }
  };
  walk(value, "", 0);
  return out;
}
