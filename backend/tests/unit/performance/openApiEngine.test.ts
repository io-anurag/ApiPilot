import { describe, expect, it } from "vitest";
import { renderScript, renderScriptFrom } from "../../../src/performance/k6/renderScript";
import { buildPlan, rebuildPlan } from "../../../src/performance/plan/buildPlan";
import { revertAllWorkflowJourneys } from "../../../src/performance/plan/convertWorkflowJourney";
import { openApiEngine } from "../../../src/performance/plan/openApiEngine";
import { applyPlanUpdate } from "../../../src/performance/plan/planUpdate";
import { buildRemovedOperationPreview } from "../../../src/performance/plan/removedOperationPreview";
import { buildStepRequestPreview } from "../../../src/performance/plan/requestPreview";
import { documentedResponseFields } from "../../../src/performance/plan/responseFields";
import { operationKeyOf } from "../../../src/performance/plan/stepRequest";
import { performanceContext, quickContext } from "../../fixtures/performance/context";

/** AP-036 (specs/036-collection-performance-test research R2; tasks T006): the OpenAPI engine wraps today's functions unchanged. */
describe("openApiEngine", () => {
  for (const [label, load] of [
    ["guided", performanceContext],
    ["quick", quickContext],
  ] as const) {
    it(`returns exactly what the wrapped functions return, for a ${label} plan`, async () => {
      const context = await load();
      const engine = openApiEngine(context);
      const base = buildPlan(context);
      const steps = base.journeys.flatMap((journey) => journey.steps);
      const update = { expectedStatuses: Object.fromEntries(steps.map((step) => [step.id, ["200"]])), thinkTimeMs: 250 };
      const plan = applyPlanUpdate(base, update, context);

      expect(engine.applyUpdate(base, update)).toEqual(plan);
      expect(engine.reset(plan)).toEqual(rebuildPlan(plan, context, { keepOrder: false, revertWorkflowJourneys: revertAllWorkflowJourneys }));
      expect(engine.stepRequestPreview(plan, steps[0].id)).toEqual(buildStepRequestPreview(plan, context, steps[0].id));

      const removedKey = steps[steps.length - 1].operationKey;
      const removed = applyPlanUpdate(plan, { excludedOperationKeys: [removedKey] }, context);
      expect(engine.removedPreview(removed, removedKey)).toEqual(buildRemovedOperationPreview(removed, context, removedKey));

      const operation = context.apiModel.operations[0];
      expect(engine.responseFields(operationKeyOf(operation))).toEqual(documentedResponseFields(operation));
      expect(() => engine.responseFields("GET /not-an-operation")).toThrow("is not an analyzed operation");

      expect(renderScriptFrom(plan, engine.scriptInputs(plan))).toEqual(renderScript(plan, context));
    });
  }
});
