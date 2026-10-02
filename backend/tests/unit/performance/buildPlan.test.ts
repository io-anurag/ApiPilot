import type { CollectionPlanInfo, PerformancePlan } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { assemblePlan, buildPlan, choicesOf, finalizePlan, rebuildPlan, upstreamFingerprint } from "../../../src/performance/plan/buildPlan";
import { planSnapshotForRun } from "../../../src/performance/plan/runSnapshot";
import { applyPlanUpdate } from "../../../src/performance/plan/planUpdate";
import { valueStatuses } from "../../../src/performance/plan/userSuppliedValues";
import { pathParameterVariableName } from "../../../src/postman/artifactVariables";
import { InvalidLoadProfileError, InvalidThresholdError, UnknownOperationError, UserJourneyRefusedError } from "../../../src/performance/errors";
import { userJourneysInput } from "../../../src/performance/plan/userJourneys";
import { STARTING_STAGES, startingProfile, validateLoadProfile } from "../../../src/performance/plan/loadProfiles";
import { environmentFixture, planFixture, SEEDED_CLIENT_ID, SEEDED_CLIENT_SECRET } from "../../fixtures/performance/builders";
import { bodyEditsContext, performanceContext, quickContext, userJourneysContext } from "../../fixtures/performance/context";
import { CREATE, lifecycleInput, lifecyclePlan, READ, REMOVE, REPLACE } from "../../fixtures/performance/userJourneyPlans";

/** US1 plan building (research D4, D5, D6, D13, D26; tasks T024 to T029). */

function stepKeys(plan: ReturnType<typeof buildPlan>): string[][] {
  return plan.journeys.map((journey) => journey.steps.map((step) => step.operationKey));
}

describe("buildPlan over performance.yaml", () => {
  it("proposes the workflow journey first, then single-step journeys by method and path (FR-006)", async () => {
    const plan = buildPlan(await performanceContext());
    expect(stepKeys(plan)).toEqual([
      ["POST /orders", "GET /orders/{orderId}"],
      ["GET /status"],
      ["GET /warehouses/{warehouseId}"],
    ]);
    expect(plan.journeys[0].source.kind).toBe("workflow");
    expect(plan.journeys[1].source).toEqual({ kind: "operation" });
  });

  it("records the dependency, its confidence and where each variable comes from (FR-039)", async () => {
    const plan = buildPlan(await performanceContext());
    const [producer, consumer] = plan.journeys[0].steps;
    expect(producer.dependency?.confidence).toBe("CONFIRMED");
    expect(producer.produces).toEqual(["orderId"]);
    expect(consumer.variableBindings).toEqual([
      { variable: "orderId", role: "consumes", field: "orderId", location: "path", producerStepId: producer.id },
    ]);
    expect(plan.journeys[1].steps[0].dependency).toBeNull();
  });

  it("uses content-derived ids that are stable across builds", async () => {
    const a = buildPlan(await performanceContext());
    const b = buildPlan(await performanceContext());
    expect(a.journeys.map((j) => [j.id, j.steps.map((s) => s.id)])).toEqual(b.journeys.map((j) => [j.id, j.steps.map((s) => s.id)]));
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.journeys[0].steps[0].id).toMatch(/^s_[0-9a-f]{16}$/);
  });

  it("pre-fills expected statuses from the specification and lists the step that needs one (FR-012a)", async () => {
    const plan = buildPlan(await performanceContext());
    const status = plan.journeys[1].steps[0];
    expect(plan.journeys[0].steps[0].expectedStatuses).toEqual([{ code: "201", source: "specification" }]);
    expect(status.expectedStatuses).toEqual([]);
    expect(plan.stepsNeedingExpectedStatus).toEqual([status.id]);
  });

  it("starts with the smoke profile, no thresholds and no think time (FR-017, FR-018)", async () => {
    const plan = buildPlan(await performanceContext());
    expect(plan.loadProfile).toEqual(startingProfile("smoke"));
    expect(plan.thresholds).toEqual([]);
    expect(plan.thinkTimeMs).toBe(0);
  });

  it("lists user-supplied values by name, with who needs them and whether they are secret (FR-013, D6)", async () => {
    const plan = buildPlan(await performanceContext());
    const warehouseName = pathParameterVariableName("/warehouses/{warehouseId}", "warehouseId");
    expect(warehouseName).toBe("warehouseId");
    expect(plan.userSuppliedValues.map((value) => [value.name, value.source, value.secret])).toEqual([
      ["baseUrl", "base-url", false],
      ["clientId", "oauth2-client", true],
      ["clientSecret", "oauth2-client", true],
      [warehouseName, "path-parameter", false],
    ]);
    expect(plan.userSuppliedValues.find((value) => value.name === "orderId")).toBeUndefined();
    const warehouse = plan.userSuppliedValues.find((value) => value.name === warehouseName)!;
    expect(warehouse.neededBySteps).toEqual([plan.journeys[2].steps[0].id]);
  });

  it("judges presence per environment and never returns a value (FR-013)", async () => {
    const plan = buildPlan(await performanceContext());
    const statuses = valueStatuses(plan.userSuppliedValues, environmentFixture());
    expect(statuses.map((status) => [status.name, status.present])).toEqual([
      ["baseUrl", true],
      ["clientId", true],
      ["clientSecret", true],
      ["warehouseId", false],
    ]);
    const serialized = JSON.stringify(statuses);
    expect(serialized).not.toContain(SEEDED_CLIENT_SECRET);
    expect(serialized).not.toContain(SEEDED_CLIENT_ID);
  });

  it("lists POST /orders' customerEmail as a unique-value field (FR-016, D13)", async () => {
    const plan = buildPlan(await performanceContext());
    expect(plan.uniqueValueFields).toEqual([
      { stepId: plan.journeys[0].steps[0].id, location: "body", fieldPath: "customerEmail", format: "email" },
    ]);
  });

  it("changes the fingerprint for any plan edit, and not for the derived list", async () => {
    const context = await performanceContext();
    const plan = buildPlan(context);
    const statusStep = plan.journeys[1].steps[0].id;
    const edited = applyPlanUpdate(plan, { expectedStatuses: { [statusStep]: ["200"] } }, context);
    expect(edited.fingerprint).not.toBe(plan.fingerprint);
    expect(edited.stepsNeedingExpectedStatus).toEqual([]);
    const profile = applyPlanUpdate(plan, { loadProfile: { kind: "load", stages: STARTING_STAGES.load } }, context);
    expect(profile.fingerprint).not.toBe(plan.fingerprint);
  });

  it("changes the upstream fingerprint when approvals change, even with the same scenario ids", async () => {
    const base = await performanceContext();
    const revised = await performanceContext({
      mutateScenarios: (scenarios) =>
        scenarios.map((s) => (s.operationPath === "/status" ? { ...s, request: { ...s.request, headers: { "X-Trace": "1" } } } : s)),
    });
    expect(upstreamFingerprint(revised)).not.toBe(upstreamFingerprint(base));
    expect(upstreamFingerprint({ ...base, workflows: [] })).not.toBe(upstreamFingerprint(base));
  });

  it("keeps the profile, thresholds and surviving expected statuses on rebuild (D26)", async () => {
    const context = await performanceContext();
    let plan = buildPlan(context);
    const statusStep = plan.journeys[1].steps[0].id;
    plan = applyPlanUpdate(
      plan,
      {
        loadProfile: { kind: "load", stages: STARTING_STAGES.load },
        thresholds: [{ scope: { kind: "run" }, metric: "p95", comparator: "<=", limit: 500 }],
        expectedStatuses: { [statusStep]: ["200", "503"] },
      },
      context,
    );
    const rebuilt = rebuildPlan(plan, context, { keepOrder: false });
    expect(rebuilt.loadProfile.kind).toBe("load");
    expect(rebuilt.thresholds).toHaveLength(1);
    expect(rebuilt.journeys[1].steps[0].expectedStatuses).toEqual([
      { code: "200", source: "user" },
      { code: "503", source: "user" },
    ]);
  });
});

describe("plan updates (tasks T028)", () => {
  it("matches data-model.md's starting stages exactly", () => {
    expect(startingProfile("load").stages).toEqual([
      { durationMs: 120_000, targetVirtualUsers: 10 },
      { durationMs: 300_000, targetVirtualUsers: 10 },
      { durationMs: 60_000, targetVirtualUsers: 0 },
    ]);
    expect(startingProfile("load").plannedDurationMs).toBe(480_000);
    expect(startingProfile("soak").plannedDurationMs).toBe(70 * 60_000);
    expect(startingProfile("spike").stages).toHaveLength(6);
    expect(startingProfile("stress").stages).toHaveLength(5);
  });

  it("rejects malformed profiles and applies no maximum or warning (FR-019)", () => {
    for (const bad of [{ kind: "load", stages: [] }, { kind: "x", stages: [{ durationMs: 1, targetVirtualUsers: 1 }] }, { kind: "load", stages: [{ durationMs: 0, targetVirtualUsers: 1 }] }, { kind: "load", stages: [{ durationMs: 1000, targetVirtualUsers: -1 }] }]) {
      expect(() => validateLoadProfile(bad)).toThrow(InvalidLoadProfileError);
    }
    const huge = validateLoadProfile({ kind: "soak", stages: [{ durationMs: 48 * 3_600_000, targetVirtualUsers: 100_000 }] });
    expect(huge.plannedDurationMs).toBe(48 * 3_600_000);
  });

  it("validates thresholds and unknown operations, and leaves the plan unchanged when rejected", async () => {
    const context = await performanceContext();
    const plan = buildPlan(context);
    expect(() => applyPlanUpdate(plan, { thresholds: [{ scope: { kind: "run" }, metric: "p95", comparator: "<=", limit: 0 }] }, context)).toThrow(InvalidThresholdError);
    expect(() => applyPlanUpdate(plan, { thresholds: [{ scope: { kind: "run" }, metric: "error-rate", comparator: "<=", limit: 101 }] }, context)).toThrow(InvalidThresholdError);
    expect(() => applyPlanUpdate(plan, { thresholds: [{ scope: { kind: "step", stepId: "nope" }, metric: "p95", comparator: "<=", limit: 5 }] }, context)).toThrow(InvalidThresholdError);
    expect(() => applyPlanUpdate(plan, { excludedOperationKeys: ["DELETE /nothing"] }, context)).toThrow(UnknownOperationError);
    expect(plan.thresholds).toEqual([]);
  });

  it("removes an operation from every journey, and breaks a workflow journey whose step is removed", async () => {
    const context = await performanceContext();
    const plan = applyPlanUpdate(buildPlan(context), { excludedOperationKeys: ["POST /orders"] }, context);
    // Existing journeys keep their order; a journey that newly appears is appended, so an edit
    // never discards an order the user chose.
    expect(stepKeys(plan)).toEqual([["GET /status"], ["GET /warehouses/{warehouseId}"], ["GET /orders/{orderId}"]]);
    expect(plan.excludedOperationKeys).toEqual(["POST /orders"]);
    expect(plan.userSuppliedValues.some((value) => value.name === "orderId")).toBe(true);
  });
});

describe("credential producers (AP-032 FR-003a, US1 AS6; specs/032 tasks T017)", () => {
  it("lists the login the chained-login token source calls, on both paths", async () => {
    expect(buildPlan(await quickContext()).credentialProducerOperationKeys).toEqual(["POST /auth/login"]);
    expect(buildPlan(await quickContext("guided")).credentialProducerOperationKeys).toEqual(["POST /auth/login"]);
    expect(buildPlan(await performanceContext()).credentialProducerOperationKeys).toEqual([]);
  });

  it("starts a quick plan with the login removed, and the secured steps authenticated by it", async () => {
    const plan = buildPlan(await quickContext());
    expect(plan.source).toBe("quick");
    expect(plan.excludedOperationKeys).toEqual(["POST /auth/login"]);
    const steps = plan.journeys.flatMap((journey) => journey.steps);
    expect(steps.map((step) => step.operationKey)).not.toContain("POST /auth/login");
    const listOrders = steps.find((step) => step.operationKey === "GET /orders")!;
    expect(listOrders.auth).toEqual({ kind: "chained-login", schemeName: "LoginAuth" });
    expect(plan.journeys.every((journey) => journey.source.kind === "operation" && journey.steps.length === 1)).toBe(true);
  });

  it("keeps a guided plan's exclusions empty (AP-029 behaviour)", async () => {
    const plan = buildPlan(await quickContext("guided"));
    expect(plan.source).toBe("guided");
    expect(plan.excludedOperationKeys).toEqual([]);
    expect(plan.journeys.flatMap((journey) => journey.steps).map((step) => step.operationKey)).toContain("POST /auth/login");
  });

  it("makes the login a journey again when it is restored, and still acquires the token from it", async () => {
    const context = await quickContext();
    const restored = applyPlanUpdate(buildPlan(context), { excludedOperationKeys: [] }, context);
    const keys = restored.journeys.flatMap((journey) => journey.steps).map((step) => step.operationKey);
    expect(keys).toContain("POST /auth/login");
    expect(restored.credentialProducerOperationKeys).toEqual(["POST /auth/login"]);
    expect(restored.journeys.flatMap((journey) => journey.steps).find((step) => step.operationKey === "GET /orders")!.auth.kind).toBe("chained-login");
  });

  it("never removes an operation by its name: logout stays in the plan", async () => {
    const plan = buildPlan(await quickContext());
    expect(plan.journeys.flatMap((journey) => journey.steps).map((step) => step.operationKey)).toContain("POST /auth/logout");
  });

  it("fingerprints the source, and not the derived producer list", async () => {
    const quick = buildPlan(await quickContext());
    const guidedWithSameChoices = applyPlanUpdate(buildPlan(await quickContext("guided")), { excludedOperationKeys: ["POST /auth/login"] }, await quickContext("guided"));
    expect(guidedWithSameChoices.journeys).toEqual(quick.journeys);
    expect(guidedWithSameChoices.fingerprint).not.toBe(quick.fingerprint);
  });
});

describe("operations in scope follow the API review selection (AP-032 FR-022, FR-023, SC-005; specs/032 tasks T058)", () => {
  it("covers only the selected operations and never lists the others as left out", async () => {
    const context = await quickContext("guided");
    const selected = ["GET /orders", "POST /orders", "GET /orders/{orderId}", "DELETE /orders/{orderId}", "GET /status"];
    const plan = buildPlan({ ...context, selectedOperationKeys: selected });
    const keys = plan.journeys.flatMap((journey) => journey.steps).map((step) => step.operationKey);
    expect([...keys].sort()).toEqual([...selected].sort());
    expect(plan.omitted.every((entry) => selected.includes(entry.operationKey))).toBe(true);
  });

  it("covers every analyzed operation when no subset was selected", async () => {
    const context = await quickContext("guided");
    const plan = buildPlan(context);
    expect(plan.journeys.flatMap((journey) => journey.steps)).toHaveLength(context.apiModel.operations.length);
  });

  it("has no scope, and rejects an update that sends one", async () => {
    const context = await quickContext("guided");
    const plan = buildPlan(context);
    expect("scope" in plan).toBe(false);
    expect(() => applyPlanUpdate(plan, { scope: "all" }, context)).toThrow("The operations in scope follow the API review selection.");
  });
});

/** AP-033 (specs/033-edit-step-request-body research R3, R10; tasks T008). */
describe("body edits in the plan", () => {
  // Captured on 2026-09-29 from the unchanged code, before body edits reached plan assembly.
  const GUIDED_FINGERPRINT_BEFORE_AP033 = "bc88539bc6a4e34e92be582a3ec63b0dbbad5bfd643ad8664c5a56c68f037298";
  const QUICK_FINGERPRINT_BEFORE_AP033 = "bb330c7d4fa69a067705e70d4933c6f821cb1d03ec48ebb4028d5c78e218e689";

  it("keeps the fingerprint of a plan without edits exactly as it was (R10)", async () => {
    expect(buildPlan(await performanceContext()).fingerprint).toBe(GUIDED_FINGERPRINT_BEFORE_AP033);
    expect(buildPlan(await quickContext()).fingerprint).toBe(QUICK_FINGERPRINT_BEFORE_AP033);
  });

  it("applies an edit to the step's needed values, unique fields, marker and fingerprint", async () => {
    const context = await bodyEditsContext();
    const plan = buildPlan(context);
    const step = plan.journeys.flatMap((journey) => journey.steps).find((candidate) => candidate.operationKey === "POST /orders")!;
    expect(plan.uniqueValueFields.map((field) => field.fieldPath)).toEqual(["customerEmail"]);
    const edited = assemblePlan(context, {
      ...choicesOf(plan),
      bodyEdits: [
        { stepId: step.id, operationKey: step.operationKey, scenarioId: step.scenarioId, kind: "json", json: { quantity: 2, warehouseId: "{{warehouseId}}" } },
      ],
    });
    const editedStep = edited.journeys.flatMap((journey) => journey.steps).find((candidate) => candidate.id === step.id)!;
    expect(editedStep.bodyEdited).toBe(true);
    expect(editedStep.requiredValues).toContain("warehouseId");
    expect(edited.uniqueValueFields).toEqual([]);
    expect(edited.bodyEdits).toHaveLength(1);
    expect(edited.fingerprint).not.toBe(plan.fingerprint);
    expect(plan.journeys.flatMap((journey) => journey.steps).every((candidate) => !("bodyEdited" in candidate))).toBe(true);
  });

  it("ignores an edit made for a different scenario of the step", async () => {
    const context = await bodyEditsContext();
    const plan = buildPlan(context);
    const step = plan.journeys.flatMap((journey) => journey.steps).find((candidate) => candidate.operationKey === "POST /orders")!;
    const edited = assemblePlan(context, {
      ...choicesOf(plan),
      bodyEdits: [{ stepId: step.id, operationKey: step.operationKey, scenarioId: "another-scenario", kind: "json", json: { quantity: 2 } }],
    });
    expect(edited.bodyEdits).toEqual([]);
    expect(edited.fingerprint).toBe(plan.fingerprint);
  });
});

/** AP-035 FR-002 to FR-005, FR-012, FR-025 (specs/035-user-defined-journeys research R2, R4, R17; tasks T018). */
describe("assembling user-defined journeys (AP-035)", () => {
  const userSteps = (plan: PerformancePlan) => plan.journeys.find((journey) => journey.source.kind === "user")!.steps;
  const singleKeys = (plan: PerformancePlan) =>
    plan.journeys.filter((journey) => journey.source.kind === "operation").map((journey) => journey.steps[0].operationKey);

  it("starts a quick plan with single-step journeys only and no bindings (FR-006, FR-030)", async () => {
    const context = await userJourneysContext();
    const plan = buildPlan(context);
    expect(plan.journeys.every((journey) => journey.source.kind === "operation" && journey.steps.length === 1)).toBe(true);
    expect(plan.journeys.flatMap((journey) => journey.steps).every((step) => step.variableBindings.length === 0)).toBe(true);
    expect(plan.userJourneys).toBeUndefined();
  });

  it("keeps ids across a rename and a reorder, and gives a repeated operation its own step id (FR-002, R2)", async () => {
    const { plan, context } = await lifecyclePlan();
    const ids = userSteps(plan).map((step) => step.id);
    const input = userJourneysInput(plan.userJourneys!) as Record<string, unknown>[];
    const renamed = applyPlanUpdate(plan, { userJourneys: [{ ...input[0], name: "Renamed" }] }, context);
    expect(userSteps(renamed).map((step) => step.id)).toEqual(ids);
    expect(renamed.journeys.find((journey) => journey.source.kind === "user")!.id).toBe(plan.journeys.find((journey) => journey.source.kind === "user")!.id);
    const repeated = applyPlanUpdate(
      plan,
      { userJourneys: [{ ...input[0], steps: [...(input[0].steps as unknown[]), { operationKey: REPLACE, captures: [], bindings: [] }] }] },
      context,
    );
    const replaceSteps = userSteps(repeated).filter((step) => step.operationKey === REPLACE);
    expect(replaceSteps).toHaveLength(2);
    expect(new Set(replaceSteps.map((step) => step.id)).size).toBe(2);
    expect(replaceSteps[0].id).toBe(ids[1]);
  });

  it("takes a journey's operations out of the single-step list, unless also run on their own, and returns them on delete (FR-003, FR-004)", async () => {
    const { plan, context } = await lifecyclePlan();
    expect(singleKeys(plan)).not.toContain(CREATE);
    expect(singleKeys(plan)).not.toContain(REMOVE);
    expect(singleKeys(plan)).toContain(READ);
    const standalone = applyPlanUpdate(plan, { alsoStandalone: [CREATE] }, context);
    expect(singleKeys(standalone)).toContain(CREATE);
    expect(() => applyPlanUpdate(plan, { alsoStandalone: [READ] }, context)).toThrow(UserJourneyRefusedError);
    const deleted = applyPlanUpdate(standalone, { userJourneys: [] }, context);
    expect(singleKeys(deleted)).toEqual(expect.arrayContaining([CREATE, REPLACE, REMOVE]));
    expect(deleted.alsoStandalone ?? []).toEqual([]);
  });

  it("appends a new journey to the journey order (FR-005)", async () => {
    const { plan } = await lifecyclePlan();
    expect(plan.journeys[plan.journeys.length - 1].source.kind).toBe("user");
    const { plan: second, context } = await lifecyclePlan();
    const reordered = applyPlanUpdate(second, { journeyOrder: [...second.journeys].reverse().map((journey) => journey.id) }, context);
    const input = userJourneysInput(reordered.userJourneys!);
    const added = applyPlanUpdate(reordered, { userJourneys: [...input, lifecycleInput("Second")] }, context);
    expect(added.journeys[added.journeys.length - 1].source).toMatchObject({ kind: "user", name: "Second" });
  });

  it("binds the path parameter instead of asking the environment for it (FR-012)", async () => {
    const { plan } = await lifecyclePlan();
    const [create, replace, remove] = userSteps(plan);
    for (const step of [replace, remove]) {
      expect(step.requiredValues).not.toContain("customer_id");
      expect(step.variableBindings).toContainEqual({ variable: "customer_id", role: "consumes", field: "id", location: "path", producerStepId: create.id });
      expect(step.bindings).toEqual([{ target: { kind: "path", name: "id" }, captureStepId: create.id, captureName: "customer_id", state: "active" }]);
      expect(step.userDefined).toBe(true);
    }
    expect(create.captures).toEqual([{ name: "customer_id", source: { kind: "body", path: "id", segments: [{ field: "id" }] }, documented: true }]);
    const customerId = plan.userSuppliedValues.find((value) => value.name === "customer_id");
    expect(customerId?.neededBySteps ?? []).not.toEqual(expect.arrayContaining([replace.id, remove.id]));
  });

  it("marks a journey incomplete while one of its operations is removed, and complete again once restored (FR-025)", async () => {
    const { plan, context } = await lifecyclePlan();
    const removed = applyPlanUpdate(plan, { excludedOperationKeys: [REPLACE] }, context);
    const journey = removed.journeys.find((candidate) => candidate.source.kind === "user")!;
    expect(journey.incompleteReason).toEqual({ missingOperationKeys: [REPLACE] });
    expect(removed.userJourneys![0].steps.map((step) => step.operationKey)).toEqual([CREATE, REPLACE, REMOVE]);
    expect(removed.stepsNeedingExpectedStatus.some((id) => journey.steps.some((step) => step.id === id))).toBe(false);
    const restored = applyPlanUpdate(removed, { excludedOperationKeys: [] }, context);
    expect(restored.journeys.find((candidate) => candidate.source.kind === "user")!.incompleteReason).toBeUndefined();
  });

  it("marks a journey incomplete when a guided rebuild takes an operation out of scope, rather than shortening it (spec Edge Cases)", async () => {
    const { plan, context } = await lifecyclePlan();
    const narrowed = { ...context, selectedOperationKeys: context.apiModel.operations.map((operation) => `${operation.method.toUpperCase()} ${operation.path}`).filter((key) => key !== REMOVE) };
    const rebuilt = rebuildPlan(plan, narrowed, { keepOrder: true });
    const journey = rebuilt.journeys.find((candidate) => candidate.source.kind === "user")!;
    expect(journey.incompleteReason).toEqual({ missingOperationKeys: [REMOVE] });
    expect(rebuilt.userJourneys![0].steps).toHaveLength(3);
  });

  it("changes the fingerprint with any journey change, and returns to the plan's own fingerprint without journeys (FR-021, R17)", async () => {
    const context = await userJourneysContext();
    const base = buildPlan(context);
    const { plan } = await lifecyclePlan();
    expect(plan.fingerprint).not.toBe(base.fingerprint);
    const input = userJourneysInput(plan.userJourneys!) as Record<string, unknown>[];
    expect(applyPlanUpdate(plan, { userJourneys: [{ ...input[0], name: "Other" }] }, context).fingerprint).not.toBe(plan.fingerprint);
    const cleared = applyPlanUpdate(plan, { userJourneys: [] }, context);
    expect(cleared.userJourneys).toBeUndefined();
    // The returned single-step journeys come back at the end of the order; in the base order the plan is the base plan.
    const reordered = applyPlanUpdate(cleared, { journeyOrder: base.journeys.map((journey) => journey.id) }, context);
    expect(reordered.fingerprint).toBe(base.fingerprint);
  });
});

/** AP-036 (specs/036-collection-performance-test research R16, R19; tasks T008). */
describe("a collection plan's fingerprint and run snapshot", () => {
  function collectionInfo(overrides: Partial<CollectionPlanInfo> = {}): CollectionPlanInfo {
    return {
      collectionId: "c-1",
      collectionName: "APIFoundry",
      collectionTier: "local",
      collectionDigest: "d".repeat(64),
      collectionState: "current",
      orderedRequestIds: ["r1"],
      excludedRequestIds: [],
      excludedRequests: [],
      leftOut: [],
      credentialRequests: [],
      findings: [
        { kind: "condition", owner: { kind: "request", itemId: "r1" }, event: "test", stepIds: ["s_1"], line: 3, column: null, excerpt: "if (x) { pm.environment.set(\"a\", 1) }", detail: null },
      ],
      baseUrlVariable: "baseUrl",
      hosts: [],
      generatedValueCount: 0,
      addedBindings: [],
      review: { reviewed: false, conversionDigest: "c".repeat(64) },
      ...overrides,
    };
  }

  it("keeps the fingerprint of a plan without collection data", async () => {
    const context = await performanceContext();
    const plan = buildPlan(context);
    const { fingerprint, stepsNeedingExpectedStatus, ...rest } = plan;
    expect(finalizePlan(rest).fingerprint).toBe(fingerprint);
    expect(stepsNeedingExpectedStatus).toEqual(finalizePlan(rest).stepsNeedingExpectedStatus);
  });

  it("fingerprints the collection data, but not its review or derived state", () => {
    const base = planFixture({ source: "collection", collection: collectionInfo() });
    const rest: Omit<PerformancePlan, "fingerprint" | "stepsNeedingExpectedStatus"> = { ...base };
    const fingerprint = finalizePlan(rest).fingerprint;
    expect(finalizePlan({ ...rest, collection: collectionInfo({ review: { reviewed: true, conversionDigest: "e".repeat(64) } }) }).fingerprint).toBe(fingerprint);
    expect(finalizePlan({ ...rest, collection: collectionInfo({ collectionState: "changed" }) }).fingerprint).toBe(fingerprint);
    expect(finalizePlan({ ...rest, collection: collectionInfo({ excludedRequestIds: ["r1"] }) }).fingerprint).not.toBe(fingerprint);
    expect(finalizePlan({ ...rest, collection: undefined }).fingerprint).not.toBe(fingerprint);
  });

  it("empties every finding's excerpt in a run snapshot, keeping its kind, owner and line", () => {
    const plan = planFixture({ source: "collection", collection: collectionInfo() });
    const snapshot = planSnapshotForRun(plan);
    expect(snapshot.collection!.findings).toEqual([{ ...plan.collection!.findings[0], excerpt: null }]);
    expect(JSON.stringify(snapshot)).not.toContain("pm.environment.set");
    expect(plan.collection!.findings[0].excerpt).not.toBeNull();
  });
});
