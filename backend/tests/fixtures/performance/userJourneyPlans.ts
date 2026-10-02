import type { PerformancePlan } from "@apipilot/shared-domain";
import { buildPlan } from "../../../src/performance/plan/buildPlan";
import { applyPlanUpdate } from "../../../src/performance/plan/planUpdate";
import type { PerformanceContext } from "../../../src/performance/plan/stepRequest";
import { userJourneysContext } from "./context";

/** AP-035 (specs/035-user-defined-journeys User Story 1): the operation keys of `user-journeys.yaml`. */
export const CREATE = "POST /api/v1/customers";
export const READ = "GET /api/v1/customers/{id}";
export const REPLACE = "PUT /api/v1/customers/{id}";
export const REMOVE = "DELETE /api/v1/customers/{id}";
export const CREATE_ORDER = "POST /api/v1/orders";
export const READ_ORDER = "GET /api/v1/orders/{id}";

/** The `PUT /plan` input of Story 1's journey: create, then replace and delete with the captured id. */
export function lifecycleInput(name = "Customer lifecycle"): Record<string, unknown> {
  return {
    name,
    steps: [
      { operationKey: CREATE, captures: [{ name: "customer_id", source: { kind: "body", path: "id" } }], bindings: [] },
      { operationKey: REPLACE, captures: [], bindings: [{ target: { kind: "path", name: "id" }, captureStepIndex: 0, captureName: "customer_id" }] },
      { operationKey: REMOVE, captures: [], bindings: [{ target: { kind: "path", name: "id" }, captureStepIndex: 0, captureName: "customer_id" }] },
    ],
  };
}

export async function lifecyclePlan(): Promise<{ plan: PerformancePlan; context: PerformanceContext }> {
  const context = await userJourneysContext();
  const plan = applyPlanUpdate(buildPlan(context), { userJourneys: [lifecycleInput()] }, context);
  return { plan, context };
}
