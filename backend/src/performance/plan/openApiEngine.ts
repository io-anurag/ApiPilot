import type { PerformancePlan, RemovedOperationPreview, StepRequestPreview } from "@apipilot/shared-domain";
import { UnknownOperationError } from "../errors";
import { scriptInputsFromContext, type ScriptInputs } from "../k6/renderScript";
import { rebuildPlan } from "./buildPlan";
import { revertAllWorkflowJourneys } from "./convertWorkflowJourney";
import { applyPlanUpdate } from "./planUpdate";
import { buildRemovedOperationPreview } from "./removedOperationPreview";
import { buildStepRequestPreview } from "./requestPreview";
import { documentedResponseFields, type DocumentedResponseField } from "./responseFields";
import { operationKeyOf, type PerformanceContext } from "./stepRequest";

export type ResponseFieldsResult = { fields: DocumentedResponseField[]; truncated: boolean };

/**
 * AP-036 (specs/036-collection-performance-test research R2): the six operations the shared
 * performance routes need from a plan's source, named at exactly the points where they used to read
 * an OpenAPI `PerformanceContext`. A plan built from a specification and one built from a stored
 * collection reuse every route, the run trigger, the snapshot and the report through this seam,
 * without the OpenAPI pipeline taking a union context.
 */
export interface PlanEngine {
  applyUpdate(plan: PerformancePlan, body: unknown): PerformancePlan;
  reset(plan: PerformancePlan): PerformancePlan;
  stepRequestPreview(plan: PerformancePlan, stepId: string): StepRequestPreview;
  removedPreview(plan: PerformancePlan, key: string): RemovedOperationPreview;
  /** `null` when the source documents no response fields: `404 not_applicable`. */
  responseFields(operationKey: string): ResponseFieldsResult | null;
  /** The renderer's inputs; may throw a gate error. */
  scriptInputs(plan: PerformancePlan): ScriptInputs;
}

/** The guided and quick sources' engine: today's functions, unchanged. */
export function openApiEngine(context: PerformanceContext): PlanEngine {
  return {
    applyUpdate: (plan, body) => applyPlanUpdate(plan, body, context),
    reset: (plan) => rebuildPlan(plan, context, { keepOrder: false, revertWorkflowJourneys: revertAllWorkflowJourneys }),
    stepRequestPreview: (plan, stepId) => buildStepRequestPreview(plan, context, stepId),
    removedPreview: (plan, operationKey) => buildRemovedOperationPreview(plan, context, operationKey),
    responseFields: (operationKey) => {
      const operation = context.apiModel.operations.find((candidate) => operationKeyOf(candidate) === operationKey);
      if (!operation) throw new UnknownOperationError(operationKey);
      return documentedResponseFields(operation);
    },
    scriptInputs: (plan) => scriptInputsFromContext(plan, context),
  };
}
