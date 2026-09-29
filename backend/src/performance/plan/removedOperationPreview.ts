import type { PerformancePlan, RemovedOperationPreview } from "@apipilot/shared-domain";
import { NoPositiveScenarioError, OperationNotRemovedError } from "../errors";
import { applyPlanUpdate } from "./planUpdate";
import { buildStepRequestPreview } from "./requestPreview";
import type { PerformanceContext } from "./stepRequest";

/**
 * A removed operation's step and request as they would be if it were restored (AP-032 FR-024a).
 * The plan is rebuilt with the operation restored, through the same update the Restore action
 * sends, and read; the rebuilt plan is never saved, so the preview cannot change the plan and
 * always matches what Restore would produce. When the operation is in more than one journey (a
 * guided workflow), its first step is shown.
 */
export function buildRemovedOperationPreview(
  plan: PerformancePlan,
  context: PerformanceContext,
  operationKey: string,
): RemovedOperationPreview {
  if (!plan.excludedOperationKeys.includes(operationKey)) throw new OperationNotRemovedError(operationKey);
  const restored = applyPlanUpdate(
    plan,
    { excludedOperationKeys: plan.excludedOperationKeys.filter((key) => key !== operationKey) },
    context,
  );
  const step = restored.journeys.flatMap((journey) => journey.steps).find((candidate) => candidate.operationKey === operationKey);
  if (!step) throw new NoPositiveScenarioError(operationKey);
  return { step, request: buildStepRequestPreview(restored, context, step.id) };
}
