import { describe, expect, it } from "vitest";
import type { PerformancePlan } from "@apipilot/shared-domain";
import { journeyStepsNotRestored, restoreOrderFromRun, restoreSettingsFromRun } from "../../src/components/performance/restoreFromRun";
import { planFixture, readyPlan } from "./performanceFixtures";

/** AP-029 FR-024b (amended 2026-09-30): a past run's settings, rebuilt on the current plan. */

/** The run's plan: two operations removed, a load profile, a threshold, reordered journeys. */
function snapshot(): PerformancePlan {
  const plan = readyPlan();
  return {
    ...plan,
    excludedOperationKeys: ["GET /warehouses/{warehouseId}"],
    journeys: [plan.journeys[1]!, plan.journeys[0]!],
    thinkTimeMs: 250,
    loadProfile: { kind: "load", stages: [{ durationMs: 30_000, targetVirtualUsers: 5 }], plannedDurationMs: 30_000 },
    thresholds: [{ id: "t-1", scope: { kind: "run" }, metric: "p95", comparator: "<=", limit: 800 }],
  };
}

describe("restoreSettingsFromRun", () => {
  it("restores the removed operations, load profile, think time, thresholds and the expected statuses the user set", () => {
    const restore = restoreSettingsFromRun("run-12345678", snapshot(), planFixture());
    expect(restore).toEqual({
      ok: true,
      notRestored: [],
      settings: {
        excludedOperationKeys: ["GET /warehouses/{warehouseId}"],
        thinkTimeMs: 250,
        loadProfile: { kind: "load", stages: [{ durationMs: 30_000, targetVirtualUsers: 5 }] },
        thresholds: [{ scope: { kind: "run" }, metric: "p95", comparator: "<=", limit: 800 }],
        // Only s-status's code was set by the user; s-create's 201 comes from the specification.
        expectedStatuses: { "s-status": ["200"] },
      },
    });
  });

  it("names the steps whose body or parameter edits a run does not record", () => {
    const run = snapshot();
    run.journeys = run.journeys.map((journey) => ({ ...journey, steps: journey.steps.map((step) => (step.id === "s-create" ? { ...step, bodyEdited: true as const } : step)) }));
    const restore = restoreSettingsFromRun("run-12345678", run, planFixture());
    expect(restore.ok && restore.notRestored).toEqual(["POST /orders"]);
  });

  it("refuses a run built from a different specification or scenarios", () => {
    expect(restoreSettingsFromRun("run-12345678", snapshot(), planFixture({ upstreamFingerprint: "up-2" }))).toEqual({
      ok: false,
      reason: "Run run-1234 was built from a different specification or scenarios, so its settings cannot be restored.",
    });
    expect(restoreSettingsFromRun("run-12345678", snapshot(), planFixture({ source: "quick" })).ok).toBe(false);
  });
});

describe("restoreOrderFromRun", () => {
  const withoutWarehouse = () => ({ ...readyPlan(), journeys: readyPlan().journeys.slice(0, 2) });

  it("restores the run's journey and step order when the plan's differs", () => {
    const run = snapshot();
    run.journeys = [run.journeys[0]!, { ...run.journeys[1]!, steps: [...run.journeys[1]!.steps].reverse() }];
    expect(restoreOrderFromRun("run-12345678", run, withoutWarehouse())).toEqual({ journeyOrder: ["j2", "j1"], stepOrder: { j1: ["s-read", "s-create"] } });
  });

  it("sends nothing when the plan already has the run's order", () => {
    const run = { ...snapshot(), journeys: withoutWarehouse().journeys };
    expect(restoreOrderFromRun("run-12345678", run, withoutWarehouse())).toBeNull();
  });

  it("says so when the plan's journeys are not the run's", () => {
    expect(restoreOrderFromRun("run-12345678", snapshot(), readyPlan())).toEqual({
      reason: "The plan's journeys differ from run run-1234's, so its order was not restored.",
    });
  });
});

/** AP-035 FR-028 (specs/035-user-defined-journeys research R12; tasks T049). */
describe("restoring a run's user-defined journeys", () => {
  const definition = {
    id: "j-user",
    name: "Lifecycle",
    origin: { kind: "defined" as const },
    nextStepNumber: 3,
    steps: [
      { id: "s-1", operationKey: "POST /orders", captures: [{ name: "order_id", source: { kind: "body" as const, path: "orderId", segments: [{ field: "orderId" }] }, documented: true }], bindings: [] },
      { id: "s-2", operationKey: "GET /orders/{orderId}", captures: [], bindings: [{ target: { kind: "path" as const, name: "orderId" }, captureStepId: "s-1", captureName: "order_id", state: "active" as const }] },
    ],
  };

  it("sends the run's journeys with their own ids, sequence numbers and standalone operations", () => {
    const run = { ...snapshot(), userJourneys: [definition], nextUserJourneyNumber: 4, alsoStandalone: ["POST /orders"] };
    const restore = restoreSettingsFromRun("run-12345678", run, planFixture());
    expect(restore.ok && restore.settings).toMatchObject({
      userJourneys: [
        {
          id: "j-user",
          name: "Lifecycle",
          nextStepNumber: 3,
          steps: [
            { id: "s-1", operationKey: "POST /orders", captures: [{ name: "order_id", source: { kind: "body", path: "orderId" } }], bindings: [] },
            { id: "s-2", operationKey: "GET /orders/{orderId}", captures: [], bindings: [{ target: { kind: "path", name: "orderId" }, captureStepId: "s-1", captureName: "order_id" }] },
          ],
        },
      ],
      nextUserJourneyNumber: 4,
      alsoStandalone: ["POST /orders"],
    });
  });

  it("clears today's journeys when the run had none, and leaves a plan from before AP-035 as it was", () => {
    const now = { ...planFixture(), userJourneys: [definition] };
    expect(restoreSettingsFromRun("run-12345678", snapshot(), now)).toMatchObject({ ok: true, settings: { userJourneys: [] } });
    const older = restoreSettingsFromRun("run-12345678", snapshot(), planFixture());
    expect(older.ok && "userJourneys" in older.settings).toBe(false);
  });

  it("names the journey steps that came back incomplete or with a missing target", () => {
    const restored = {
      ...planFixture(),
      journeys: [
        { id: "j-user", source: { kind: "user" as const, userJourneyId: "j-user", name: "Lifecycle" }, steps: [], incompleteReason: { missingOperationKeys: ["POST /orders"] } },
      ],
    };
    expect(journeyStepsNotRestored(restored)).toEqual(["Lifecycle: POST /orders"]);
  });
});
