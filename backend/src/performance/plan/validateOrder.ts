import type { PerformanceJourney, PerformancePlan } from "@apipilot/shared-domain";
import { DependencyOrderViolationError, InvalidOrderError } from "../errors";

/**
 * FR-007 (specs/031-k6-performance-testing research D5): a proposed step order is valid only if
 * every variable's producer stays before each of its consumers. A rejected reorder names the first
 * variable it breaks, in the journey's own variable order, and is never silently corrected.
 * Journeys are independent, so any permutation of journeys is valid.
 */
function assertPermutation(current: readonly string[], proposed: unknown, what: string): string[] {
  if (!Array.isArray(proposed) || proposed.some((id) => typeof id !== "string")) {
    throw new InvalidOrderError(`The ${what} order must be a list of ids.`);
  }
  const ids = proposed as string[];
  const sameSet = ids.length === current.length && new Set(ids).size === ids.length && ids.every((id) => current.includes(id));
  if (!sameSet) throw new InvalidOrderError(`The ${what} order must contain each existing id exactly once.`);
  return ids;
}

export function validateStepOrder(journey: PerformanceJourney, proposed: unknown): string[] {
  const ids = assertPermutation(
    journey.steps.map((step) => step.id),
    proposed,
    "step",
  );
  const position = new Map(ids.map((id, index) => [id, index]));
  for (const step of journey.steps) {
    for (const binding of step.variableBindings) {
      if (binding.role !== "consumes" || !binding.producerStepId) continue;
      if (position.get(binding.producerStepId)! > position.get(step.id)!) {
        throw new DependencyOrderViolationError(binding.variable, binding.producerStepId, step.id);
      }
    }
  }
  return ids;
}

export function validateJourneyOrder(plan: PerformancePlan, proposed: unknown): string[] {
  return assertPermutation(
    plan.journeys.map((journey) => journey.id),
    proposed,
    "journey",
  );
}
