import type { PerformancePlan } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { DependencyOrderViolationError, UnknownOperationError, UserJourneyRefusedError } from "../../../src/performance/errors";
import { buildPlan, rebuildPlan } from "../../../src/performance/plan/buildPlan";
import { applyPlanUpdate } from "../../../src/performance/plan/planUpdate";
import type { PerformanceContext } from "../../../src/performance/plan/stepRequest";
import { userJourneysInput } from "../../../src/performance/plan/userJourneys";
import { userJourneysContext } from "../../fixtures/performance/context";
import { CREATE, lifecycleInput, lifecyclePlan, REMOVE, REPLACE } from "../../fixtures/performance/userJourneyPlans";

/** AP-035 FR-002, FR-006 to FR-008, FR-011, FR-015, FR-026 (research R2, R10, R11; tasks T017). */

function refusal(fn: () => unknown): UserJourneyRefusedError {
  try {
    fn();
  } catch (error) {
    if (error instanceof UserJourneyRefusedError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

function put(plan: PerformancePlan, context: PerformanceContext, journeys: unknown[]): PerformancePlan {
  return applyPlanUpdate(plan, { userJourneys: journeys }, context);
}

describe("validating user journeys", () => {
  it("assigns server ids and keeps nothing the client claims about origin or provenance", async () => {
    const context = await userJourneysContext();
    const journey = { ...lifecycleInput(), origin: { kind: "based-on-workflow", workflowId: "wf" } };
    (journey.steps as Record<string, unknown>[])[0].fromProposedStepId = "s_forged";
    const plan = put(buildPlan(context), context, [journey]);
    const [definition] = plan.userJourneys!;
    expect(definition.id).toMatch(/^j_[0-9a-f]{16}$/);
    expect(definition.origin).toEqual({ kind: "defined" });
    expect(definition.steps.every((step) => /^s_[0-9a-f]{16}$/.test(step.id) && step.fromProposedStepId === undefined)).toBe(true);
    expect(plan.nextUserJourneyNumber).toBe(2);
  });

  it("refuses more than 20 steps and more than 10 captures on a step", async () => {
    const context = await userJourneysContext();
    const plan = buildPlan(context);
    const step = { operationKey: CREATE, captures: [], bindings: [] };
    expect(refusal(() => put(plan, context, [{ name: "Long", steps: Array.from({ length: 21 }, () => step) }])).code).toBe("journey_too_long");
    expect(put(plan, context, [{ name: "Twenty", steps: Array.from({ length: 20 }, () => step) }]).userJourneys![0].steps).toHaveLength(20);
    const captures = Array.from({ length: 11 }, (_, index) => ({ name: `c${index}`, source: { kind: "body", path: "id" } }));
    expect(refusal(() => put(plan, context, [{ name: "Many", steps: [{ operationKey: CREATE, captures }] }])).code).toBe("too_many_captures");
  });

  it("refuses an invalid or repeated capture name, and a path outside the grammar, naming it", async () => {
    const context = await userJourneysContext();
    const plan = buildPlan(context);
    const withCaptures = (captures: unknown[]) => [{ name: "J", steps: [{ operationKey: CREATE, captures }, { operationKey: CREATE, captures: [{ name: "customer_id", source: { kind: "body", path: "id" } }] }] }];
    expect(refusal(() => put(plan, context, withCaptures([{ name: "1st", source: { kind: "body", path: "id" } }]))).code).toBe("capture_name_invalid");
    const taken = refusal(() => put(plan, context, withCaptures([{ name: "customer_id", source: { kind: "body", path: "id" } }])));
    expect(taken.code).toBe("capture_name_taken");
    expect(taken.extra.name).toBe("customer_id");
    const path = refusal(() => put(plan, context, withCaptures([{ name: "x", source: { kind: "body", path: "items[*].id" } }])));
    expect(path).toMatchObject({ code: "capture_path_invalid", extra: { path: "items[*].id", position: 6 } });
  });

  it("refuses a binding to a capture of the same or a later step, naming the capture", async () => {
    const context = await userJourneysContext();
    const plan = buildPlan(context);
    const journey = lifecycleInput();
    const steps = journey.steps as Record<string, unknown>[];
    (steps[1].bindings as Record<string, unknown>[])[0].captureStepIndex = 2;
    expect(() => put(plan, context, [journey])).toThrow(DependencyOrderViolationError);
    try {
      put(plan, context, [journey]);
    } catch (error) {
      expect((error as DependencyOrderViolationError).variable).toBe("customer_id");
    }
  });

  it("refuses a binding to an unknown capture or an undocumented target", async () => {
    const context = await userJourneysContext();
    const plan = buildPlan(context);
    const unknownCapture = lifecycleInput();
    ((unknownCapture.steps as Record<string, unknown>[])[1].bindings as Record<string, unknown>[])[0].captureName = "order_id";
    expect(refusal(() => put(plan, context, [unknownCapture])).code).toBe("binding_capture_unknown");
    const undocumented = lifecycleInput();
    ((undocumented.steps as Record<string, unknown>[])[1].bindings as Record<string, unknown>[])[0].target = { kind: "path", name: "customerId" };
    expect(refusal(() => put(plan, context, [undocumented])).code).toBe("binding_target_unknown");
  });

  it("refuses removing a step or a capture that a later step still uses, naming the capture and the steps (FR-015)", async () => {
    const { plan, context } = await lifecyclePlan();
    const [definition] = plan.userJourneys!;
    const input = userJourneysInput(plan.userJourneys!) as Record<string, unknown>[];
    const withoutProducer = { ...input[0], steps: (input[0].steps as unknown[]).slice(1) };
    const removedStep = refusal(() => put(plan, context, [withoutProducer]));
    expect(removedStep.code).toBe("capture_in_use");
    expect(removedStep.extra).toEqual({ capture: "customer_id", stepIds: [definition.steps[1].id, definition.steps[2].id] });

    const steps = structuredClone(input[0].steps) as Record<string, unknown>[];
    steps[0].captures = [];
    expect(refusal(() => put(plan, context, [{ ...input[0], steps }])).code).toBe("capture_in_use");
    expect(plan.userJourneys).toEqual(lifecyclePlanSnapshot(plan));
  });

  it("refuses an unknown journey or step id, and an operation outside the analysis", async () => {
    const { plan, context } = await lifecyclePlan();
    expect(refusal(() => put(plan, context, [{ ...lifecycleInput(), id: "j_0000000000000000" }])).code).toBe("invalid_user_journey");
    const input = userJourneysInput(plan.userJourneys!) as Record<string, unknown>[];
    const steps = structuredClone(input[0].steps) as Record<string, unknown>[];
    steps[2].id = "s_0000000000000000";
    expect(refusal(() => put(plan, context, [{ ...input[0], steps }])).code).toBe("invalid_user_journey");
    expect(() => put(plan, context, [{ name: "X", steps: [{ operationKey: "GET /nowhere" }] }])).toThrow(UnknownOperationError);
  });

  it("refuses a name that is empty or over 100 characters, and keeps a trimmed one", async () => {
    const context = await userJourneysContext();
    const plan = buildPlan(context);
    expect(refusal(() => put(plan, context, [lifecycleInput("  ")])).code).toBe("invalid_user_journey");
    expect(refusal(() => put(plan, context, [lifecycleInput("x".repeat(101))])).code).toBe("invalid_user_journey");
    expect(put(plan, context, [lifecycleInput("  Lifecycle ")]).userJourneys![0].name).toBe("Lifecycle");
  });
});

/** The plan's definitions, unchanged by a refused update. */
function lifecyclePlanSnapshot(plan: PerformancePlan) {
  return plan.userJourneys;
}

describe("PUT /plan step order in a user journey", () => {
  it("reorders the definition, and refuses a move before the capture's step (FR-015)", async () => {
    const { plan, context } = await lifecyclePlan();
    const journey = plan.journeys.find((candidate) => candidate.source.kind === "user")!;
    const [create, replace, remove] = journey.steps.map((step) => step.id);
    const moved = applyPlanUpdate(plan, { stepOrder: { [journey.id]: [create, remove, replace] } }, context);
    expect(moved.userJourneys![0].steps.map((step) => step.operationKey)).toEqual([CREATE, REMOVE, REPLACE]);
    expect(() => applyPlanUpdate(plan, { stepOrder: { [journey.id]: [replace, create, remove] } }, context)).toThrow(DependencyOrderViolationError);
  });
});

/** AP-035 User Story 2: FR-007, FR-009, FR-011, FR-013, FR-014, FR-016 (research R8 to R10; tasks T038). */
describe("captures and bindings beyond a path parameter", () => {
  const ORDER_JOURNEY = (bindings: unknown[], extraCaptures: unknown[] = []) => ({
    name: "Orders",
    steps: [
      { operationKey: CREATE, captures: [{ name: "customer_id", source: { kind: "body", path: "id" } }, ...extraCaptures] },
      { operationKey: "POST /api/v1/orders", captures: [], bindings },
    ],
  });
  const bind = (target: unknown) => ({ target, captureStepIndex: 0, captureName: "customer_id" });

  it("takes a header capture by name, stored lowercased, and refuses an invalid one", async () => {
    const context = await userJourneysContext();
    const plan = put(buildPlan(context), context, [ORDER_JOURNEY([], [{ name: "customer_url", source: { kind: "header", name: "Location" } }])]);
    const capture = plan.userJourneys![0].steps[0].captures[1];
    expect(capture).toEqual({ name: "customer_url", source: { kind: "header", name: "location" }, documented: null });
    expect(refusal(() => put(buildPlan(context), context, [ORDER_JOURNEY([], [{ name: "bad", source: { kind: "header", name: "a b" } }])])).code).toBe("capture_header_invalid");
  });

  it("binds a body field of the step's base body, and refuses one the body does not have", async () => {
    const context = await userJourneysContext();
    const plan = put(buildPlan(context), context, [ORDER_JOURNEY([bind({ kind: "body", fieldPath: "customerId" })])]);
    const order = plan.journeys.find((journey) => journey.source.kind === "user")!.steps[1];
    expect(order.bindings).toEqual([expect.objectContaining({ target: { kind: "body", fieldPath: "customerId" }, state: "active" })]);
    expect(refusal(() => put(buildPlan(context), context, [ORDER_JOURNEY([bind({ kind: "body", fieldPath: "missing" })])])).code).toBe("binding_target_unknown");
    expect(refusal(() => put(buildPlan(context), context, [ORDER_JOURNEY([bind({ kind: "body", fieldPath: "items[9].sku" })])])).code).toBe("binding_target_unknown");
    expect(put(buildPlan(context), context, [ORDER_JOURNEY([bind({ kind: "body", fieldPath: "items[0].sku" })])]).userJourneys).toHaveLength(1);
  });

  it("binds a documented query parameter, and refuses two bindings on one target", async () => {
    const context = await userJourneysContext();
    const journey = { name: "Read order", steps: [{ operationKey: CREATE, captures: [{ name: "customer_id", source: { kind: "body", path: "id" } }, { name: "other", source: { kind: "body", path: "name" } }] }, { operationKey: "GET /api/v1/orders/{id}", bindings: [bind({ kind: "query", name: "customer" })] }] };
    expect(put(buildPlan(context), context, [journey]).journeys.find((candidate) => candidate.source.kind === "user")!.steps[1].requiredValues).not.toContain("customer");
    const twice = structuredClone(journey);
    (twice.steps[1].bindings as unknown[]).push({ target: { kind: "query", name: "customer" }, captureStepIndex: 0, captureName: "other" });
    expect(refusal(() => put(buildPlan(context), context, [twice])).code).toBe("binding_target_taken");
  });

  it("refuses a header the step's authentication sends", async () => {
    const context = await userJourneysContext();
    const operation = context.apiModel.operations.find((candidate) => candidate.path === "/api/v1/orders" && candidate.method.toLowerCase() === "post")!;
    const secured = {
      ...context,
      apiModel: {
        ...context.apiModel,
        securitySchemes: { ApiKey: { type: "apiKey", in: "header", name: "X-Api-Key" } },
        operations: context.apiModel.operations.map((candidate) =>
          candidate === operation
            ? { ...candidate, security: [{ schemes: [{ name: "ApiKey", scopes: [] }] }], parameters: [...candidate.parameters, { name: "X-Api-Key", location: "header" as const, required: false, schema: { required: [], properties: {} } }] }
            : candidate,
        ),
      },
    };
    expect(refusal(() => put(buildPlan(secured), secured, [ORDER_JOURNEY([bind({ kind: "header", name: "X-Api-Key" })])])).code).toBe("binding_target_unknown");
  });

  it("asks before binding a parameter with an edited value, and accepts the binding sent with the edit that drops it (FR-014)", async () => {
    const context = await userJourneysContext();
    const journey = { name: "Read order", steps: [{ operationKey: CREATE, captures: [{ name: "customer_id", source: { kind: "body", path: "id" } }] }, { operationKey: "GET /api/v1/orders/{id}", bindings: [] }] };
    let plan = put(buildPlan(context), context, [journey]);
    const [definition] = plan.userJourneys!;
    const orderStep = definition.steps[1].id;
    plan = applyPlanUpdate(plan, { parameterEdits: { [orderStep]: { parameters: [{ location: "query", name: "customer", action: "set", value: "c-1" }] } } }, context);
    const bound = userJourneysInput(plan.userJourneys!) as Record<string, unknown>[];
    ((bound[0].steps as Record<string, unknown>[])[1].bindings as unknown[]) = [{ target: { kind: "query", name: "customer" }, captureStepId: definition.steps[0].id, captureName: "customer_id" }];
    expect(refusal(() => applyPlanUpdate(plan, { userJourneys: bound }, context))).toMatchObject({ code: "parameter_edited", extra: { stepId: orderStep, name: "customer" } });
    const accepted = applyPlanUpdate(plan, { userJourneys: bound, parameterEdits: { [orderStep]: null } }, context);
    expect(accepted.parameterEdits).toEqual([]);
    expect(accepted.userJourneys![0].steps[1].bindings).toHaveLength(1);
  });

  it("marks a binding whose target a rebuild removed, lists the step, and keeps accepting other edits (FR-016)", async () => {
    const context = await userJourneysContext();
    const plan = put(buildPlan(context), context, [ORDER_JOURNEY([bind({ kind: "body", fieldPath: "customerId" })])]);
    const withoutField = {
      ...context,
      approvedScenarios: context.approvedScenarios.map((scenario) =>
        scenario.operationPath === "/api/v1/orders" && scenario.operationMethod.toLowerCase() === "post" ? { ...scenario, request: { ...scenario.request, body: { items: [] } } } : scenario,
      ),
    };
    const rebuilt = rebuildPlan(plan, withoutField, { keepOrder: true });
    const orderStep = rebuilt.userJourneys![0].steps[1];
    expect(orderStep.bindings[0].state).toBe("target-missing");
    expect(rebuilt.bindingsNeedingAttention).toEqual([orderStep.id]);
    const renamed = applyPlanUpdate(rebuilt, { userJourneys: [{ ...(userJourneysInput(rebuilt.userJourneys!)[0] as object), name: "Renamed" }] }, withoutField);
    expect(renamed.bindingsNeedingAttention).toEqual([orderStep.id]);
  });

  it("drops a body binding whose field an edit removes, with a notice (FR-013)", async () => {
    const context = await userJourneysContext();
    const plan = put(buildPlan(context), context, [ORDER_JOURNEY([bind({ kind: "body", fieldPath: "customerId" })])]);
    const orderStep = plan.userJourneys![0].steps[1].id;
    const edited = applyPlanUpdate(plan, { bodyEdits: { [orderStep]: { kind: "json", text: '{"items":[]}' } } }, context);
    expect(edited.userJourneys![0].steps[1].bindings).toEqual([]);
    expect(edited.bodyEditNotices).toContainEqual({ stepId: orderStep, kind: "capture-binding-dropped", name: "customerId" });
  });

  it("marks a typed body path the specification does not document, without refusing it (FR-009)", async () => {
    const context = await userJourneysContext();
    const plan = put(buildPlan(context), context, [ORDER_JOURNEY([], [{ name: "trace", source: { kind: "body", path: "meta.trace" } }])]);
    expect(plan.journeys.find((journey) => journey.source.kind === "user")!.steps[0].captures![1]).toMatchObject({ name: "trace", documented: false });
  });
});

/** AP-035 FR-027, FR-028, SC-007 (research R12; tasks T050). */
describe("restoring a past run's journeys", () => {
  it("accepts the snapshot's own ids back, giving the same journeys, captures and bindings", async () => {
    const { plan: snapshot, context } = await lifecyclePlan();
    const cleared = applyPlanUpdate(snapshot, { userJourneys: [] }, context);
    const restored = applyPlanUpdate(cleared, { userJourneys: userJourneysInput(snapshot.userJourneys!), nextUserJourneyNumber: snapshot.nextUserJourneyNumber }, context);
    expect(restored.userJourneys).toEqual(snapshot.userJourneys);
    expect(restored.journeys.find((journey) => journey.source.kind === "user")).toEqual(snapshot.journeys.find((journey) => journey.source.kind === "user"));
    const next = applyPlanUpdate(restored, { userJourneys: [...userJourneysInput(restored.userJourneys!), lifecycleInput("New")] }, context);
    expect(new Set(next.userJourneys!.map((definition) => definition.id)).size).toBe(2);
  });

  it("refuses foreign ids outside a restore, and ids already used by another journey of the plan", async () => {
    const { plan: snapshot, context } = await lifecyclePlan();
    const cleared = applyPlanUpdate(snapshot, { userJourneys: [] }, context);
    expect(refusal(() => applyPlanUpdate(cleared, { userJourneys: userJourneysInput(snapshot.userJourneys!) }, context)).code).toBe("invalid_user_journey");
    const single = cleared.journeys.find((journey) => journey.source.kind === "operation")!;
    const forged = { ...(userJourneysInput(snapshot.userJourneys!)[0] as object), id: single.id };
    expect(refusal(() => applyPlanUpdate(cleared, { userJourneys: [forged], nextUserJourneyNumber: 5 }, context)).code).toBe("invalid_user_journey");
  });

  it("restores a journey whose operation is now removed as incomplete, not refused (FR-028)", async () => {
    const { plan: snapshot, context } = await lifecyclePlan();
    const now = applyPlanUpdate(applyPlanUpdate(snapshot, { userJourneys: [] }, context), { excludedOperationKeys: [REMOVE] }, context);
    const restored = applyPlanUpdate(now, { userJourneys: userJourneysInput(snapshot.userJourneys!), nextUserJourneyNumber: snapshot.nextUserJourneyNumber }, context);
    expect(restored.journeys.find((journey) => journey.source.kind === "user")!.incompleteReason).toEqual({ missingOperationKeys: [REMOVE] });
  });
});
