import type {
  Environment,
  LoadProfile,
  PerformanceJourney,
  PerformancePlan,
  PerformanceRun,
  PerformanceStep,
} from "@apipilot/shared-domain";

/**
 * Shared AP-029 builders (specs/031-k6-performance-testing tasks T003). Ids are fixed strings, not
 * random, so a test's expected values never depend on generation order.
 */

/** Seeded secrets: every SC-003 test searches every artifact for these two exact strings. */
export const SEEDED_CLIENT_SECRET = "SEEDED-SECRET-CLIENT-9f1c";
export const SEEDED_CLIENT_ID = "SEEDED-SECRET-ID-77ab";

export function stepFixture(overrides: Partial<PerformanceStep> = {}): PerformanceStep {
  return {
    id: "step-get-status",
    operationKey: "GET /status",
    method: "GET",
    path: "/status",
    scenarioId: "scenario-status",
    scenarioDescription: "Service status",
    scenarioChoice: "only-positive",
    tieBrokenByLowestId: false,
    consumes: [],
    produces: [],
    variableBindings: [],
    dependency: null,
    expectedStatuses: [{ code: "200", source: "specification" }],
    auth: { kind: "none", schemeName: null },
    requiredValues: ["baseUrl"],
    ...overrides,
  };
}

export function journeyFixture(overrides: Partial<PerformanceJourney> = {}): PerformanceJourney {
  const steps = overrides.steps ?? [stepFixture()];
  return {
    id: `journey-${steps[0]?.id ?? "empty"}`,
    source: { kind: "operation" },
    ...overrides,
    steps,
  };
}

export function smokeProfile(): LoadProfile {
  return { kind: "smoke", stages: [{ durationMs: 60_000, targetVirtualUsers: 1 }], plannedDurationMs: 60_000 };
}

export function planFixture(overrides: Partial<PerformancePlan> = {}): PerformancePlan {
  return {
    source: "guided",
    excludedOperationKeys: [],
    omitted: [],
    journeys: [journeyFixture()],
    thinkTimeMs: 0,
    loadProfile: smokeProfile(),
    thresholds: [],
    userSuppliedValues: [{ name: "baseUrl", secret: false, neededBySteps: ["step-get-status"], source: "base-url" }],
    uniqueValueFields: [],
    fingerprint: "fingerprint-fixture",
    upstreamFingerprint: "upstream-fixture",
    stepsNeedingExpectedStatus: [],
    credentialProducerOperationKeys: [],
    bodyEdits: [],
    bodyEditNotices: [],
    discardedBodyEdits: [],
    ...overrides,
  };
}

export function environmentFixture(overrides: Partial<Environment> = {}): Environment {
  return {
    id: "env-perf-local",
    name: "perf-local",
    tier: "local",
    baseUrl: "http://127.0.0.1:4600",
    variableValues: { clientId: SEEDED_CLIENT_ID, clientSecret: SEEDED_CLIENT_SECRET },
    requestDelayMs: 0,
    ...overrides,
  };
}

export function runFixture(overrides: Partial<PerformanceRun> = {}): PerformanceRun {
  const environment = environmentFixture();
  return {
    id: "run-fixture",
    status: "in-progress",
    environment: { id: environment.id, name: environment.name, tier: environment.tier, baseUrl: environment.baseUrl },
    planSnapshot: planFixture(),
    planSource: "guided",
    scriptSha256: "a".repeat(64),
    // Any version the readiness gate accepts (≥ 1.0.0, research D9). ApiPilot pins no k6 version:
    // a real run records whatever k6 the user installed. A fixed value keeps tests deterministic.
    k6Version: "1.2.0",
    plannedDurationMs: 60_000,
    startedAt: "2026-09-27T12:00:00.000Z",
    cancelRequested: false,
    ...overrides,
  };
}
