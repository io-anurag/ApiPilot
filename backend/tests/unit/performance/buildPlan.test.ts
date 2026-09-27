import { describe, expect, it } from "vitest";
import { buildPlan, rebuildPlan, upstreamFingerprint } from "../../../src/performance/plan/buildPlan";
import { applyPlanUpdate } from "../../../src/performance/plan/planUpdate";
import { valueStatuses } from "../../../src/performance/plan/userSuppliedValues";
import { pathParameterVariableName } from "../../../src/postman/artifactVariables";
import { InvalidLoadProfileError, InvalidThresholdError, UnknownOperationError } from "../../../src/performance/errors";
import { STARTING_STAGES, startingProfile, validateLoadProfile } from "../../../src/performance/plan/loadProfiles";
import { environmentFixture, SEEDED_CLIENT_ID, SEEDED_CLIENT_SECRET } from "../../fixtures/performance/builders";
import { performanceContext } from "../../fixtures/performance/context";

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
