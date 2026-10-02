import type { PerformancePlan } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { UserJourneyRefusedError } from "../../../src/performance/errors";
import { buildPlan, rebuildPlan } from "../../../src/performance/plan/buildPlan";
import { revertAllWorkflowJourneys } from "../../../src/performance/plan/convertWorkflowJourney";
import { applyPlanUpdate } from "../../../src/performance/plan/planUpdate";
import type { PerformanceContext } from "../../../src/performance/plan/stepRequest";
import { userJourneysInput } from "../../../src/performance/plan/userJourneys";
import { performanceContext, userJourneysContext } from "../../fixtures/performance/context";

/** AP-035 FR-024 (specs/035-user-defined-journeys research R14, Clarifications 2026-10-02; tasks T048). */

async function guided(): Promise<{ plan: PerformancePlan; context: PerformanceContext }> {
  const context = await performanceContext();
  return { plan: buildPlan(context), context };
}

const proposedOf = (plan: PerformancePlan) => plan.journeys.find((journey) => journey.source.kind === "workflow")!;
const editedOf = (plan: PerformancePlan) => plan.journeys.find((journey) => journey.source.kind === "user")!;

describe("editing a proposed workflow journey", () => {
  it("becomes a journey based on the workflow, with each variable a capture and a binding that keep the relationship", async () => {
    const { plan, context } = await guided();
    const proposed = proposedOf(plan);
    const edited = applyPlanUpdate(plan, { editProposedJourney: proposed.id }, context);
    expect(edited.journeys.some((journey) => journey.id === proposed.id)).toBe(false);
    const journey = editedOf(edited);
    const [definition] = edited.userJourneys!;
    expect(definition.origin).toEqual({ kind: "based-on-workflow", workflowId: (proposed.source as { workflowId: string }).workflowId });
    expect(journey.source).toMatchObject({ kind: "user", basedOnWorkflowId: definition.origin.kind === "based-on-workflow" ? definition.origin.workflowId : "" });
    expect(definition.steps.map((step) => step.fromProposedStepId)).toEqual(proposed.steps.map((step) => step.id));
    expect(definition.steps.map((step) => step.operationKey)).toEqual(proposed.steps.map((step) => step.operationKey));

    const [producer, consumer] = definition.steps;
    expect(producer.captures).toEqual([expect.objectContaining({ name: "orderId", source: { kind: "body", path: "orderId", segments: [{ field: "orderId" }] }, relationshipId: expect.any(String) })]);
    expect(consumer.bindings).toEqual([
      expect.objectContaining({ target: { kind: "path", name: "orderId" }, captureStepId: producer.id, captureName: "orderId", state: "active", confidence: proposed.steps[1].dependency!.confidence }),
    ]);
    // The same requests, now through captures.
    expect(journey.steps[1].requiredValues).toEqual(proposed.steps[1].requiredValues);
  });

  it("moves the steps' expected statuses and keeps the journey's place in the order", async () => {
    const { plan, context } = await guided();
    const proposed = proposedOf(plan);
    const withStatus = applyPlanUpdate(plan, { expectedStatuses: { [proposed.steps[1].id]: ["200", "404"] } }, context);
    const edited = applyPlanUpdate(withStatus, { editProposedJourney: proposed.id }, context);
    expect(editedOf(edited).steps[1].expectedStatuses.map((status) => status.code)).toEqual(["200", "404"]);
    expect(edited.journeys.findIndex((journey) => journey.source.kind === "user")).toBe(withStatus.journeys.findIndex((journey) => journey.id === proposed.id));
  });

  it("is refused for a journey that is not a proposed workflow journey, or on the quick path", async () => {
    const { plan, context } = await guided();
    const single = plan.journeys.find((journey) => journey.source.kind === "operation")!;
    expect(() => applyPlanUpdate(plan, { editProposedJourney: single.id }, context)).toThrow(UserJourneyRefusedError);
    const quick = await userJourneysContext();
    expect(() => applyPlanUpdate(buildPlan(quick), { editProposedJourney: buildPlan(quick).journeys[0].id }, quick)).toThrow(UserJourneyRefusedError);
    expect(() => applyPlanUpdate(plan, { editProposedJourney: proposedOf(plan).id, userJourneys: [] }, context)).toThrow(/one of/);
  });
});

describe("reverting an edited workflow journey", () => {
  it("brings back the proposed journey with its ids, carrying back workflow steps' settings and discarding added steps'", async () => {
    const { plan, context } = await guided();
    const proposed = proposedOf(plan);
    let edited = applyPlanUpdate(plan, { editProposedJourney: proposed.id }, context);
    const input = userJourneysInput(edited.userJourneys!) as Record<string, unknown>[];
    const added = { operationKey: "GET /status", captures: [], bindings: [] };
    edited = applyPlanUpdate(edited, { userJourneys: [{ ...input[0], steps: [...(input[0].steps as unknown[]), added] }] }, context);
    const steps = editedOf(edited).steps;
    edited = applyPlanUpdate(edited, { expectedStatuses: { [steps[1].id]: ["200", "404"], [steps[2].id]: ["418"] } }, context);

    const reverted = applyPlanUpdate(edited, { revertProposedJourney: edited.userJourneys![0].id }, context);
    const back = proposedOf(reverted);
    expect(back.id).toBe(proposed.id);
    expect(back.steps.map((step) => step.id)).toEqual(proposed.steps.map((step) => step.id));
    expect(back.steps[1].expectedStatuses.map((status) => status.code)).toEqual(["200", "404"]);
    expect(reverted.userJourneys).toBeUndefined();
    expect(reverted.journeys.flatMap((journey) => journey.steps).some((step) => step.expectedStatuses.some((status) => status.code === "418"))).toBe(false);
    expect(reverted.journeys.findIndex((journey) => journey.id === proposed.id)).toBe(edited.journeys.findIndex((journey) => journey.source.kind === "user"));
  });

  it("is refused for a journey defined by the engineer", async () => {
    const context = await userJourneysContext();
    const plan = applyPlanUpdate(buildPlan(context), { userJourneys: [{ name: "Mine", steps: [{ operationKey: "GET /api/v1/customers/{id}" }] }] }, context);
    expect(() => applyPlanUpdate(plan, { revertProposedJourney: plan.userJourneys![0].id }, context)).toThrow(UserJourneyRefusedError);
  });
});

describe("resetting a plan with user journeys (spec Edge Cases)", () => {
  it("keeps the engineer's journeys and reverts edited workflow journeys", async () => {
    const { plan, context } = await guided();
    let edited = applyPlanUpdate(plan, { editProposedJourney: proposedOf(plan).id }, context);
    const input = userJourneysInput(edited.userJourneys!);
    edited = applyPlanUpdate(edited, { userJourneys: [...input, { name: "Mine", steps: [{ operationKey: "GET /status" }] }] }, context);
    const reset = rebuildPlan(edited, context, { keepOrder: false, revertWorkflowJourneys: revertAllWorkflowJourneys });
    expect(reset.userJourneys!.map((definition) => definition.name)).toEqual(["Mine"]);
    expect(proposedOf(reset).id).toBe(proposedOf(plan).id);
  });
});
