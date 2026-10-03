import type { DraftStep, StepBinding } from "./bindCollectionPlan";

/**
 * AP-036 (specs/036-collection-performance-test research R8, FR-027): which steps are credential
 * requests, sent once before the load rather than on every iteration. Classification uses only where
 * the captured values are used, never a request's name, path or method (constitution XIV, XV).
 *
 * A step is a credential request when it has at least one capture, at least one of its captures is
 * bound, and every bound occurrence of each of its captures is in an auth field, or an
 * `Authorization` header, of a later step. A credential request may itself use only values of earlier
 * credential requests, since it runs before any journey step; one that uses a journey step's value
 * stays a journey step. Classification repeats on every assembly. Pure.
 */
export function classifyCredentialRequests(steps: readonly DraftStep[], bindings: ReadonlyMap<string, readonly StepBinding[]>): Set<string> {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const consumers = new Map<string, { step: DraftStep; binding: StepBinding }[]>();
  for (const step of steps) {
    for (const binding of bindings.get(step.id) ?? []) {
      const list = consumers.get(binding.captureStepId) ?? [];
      list.push({ step, binding });
      consumers.set(binding.captureStepId, list);
    }
  }
  const candidates = new Set(
    steps
      .filter((step) => {
        const uses = consumers.get(step.id) ?? [];
        return step.captures.length > 0 && uses.length > 0 && uses.every(({ step: consumer, binding }) => consumer.references.get(binding.name)?.authOnly === true);
      })
      .map((step) => step.id),
  );
  // A candidate that uses a value only a journey step provides cannot run before the load.
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...candidates]) {
      const own = bindings.get(id) ?? [];
      if (own.some((binding) => !candidates.has(binding.captureStepId) || !byId.has(binding.captureStepId))) {
        candidates.delete(id);
        changed = true;
      }
    }
  }
  return candidates;
}
