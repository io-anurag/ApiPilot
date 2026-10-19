import type {
  ScenarioResult,
  SecurityFinding,
  SecurityProfile,
  SecurityRun,
  SecurityScenario,
  SecurityScenarioContent,
  SecurityScenarioVersion,
} from "@apipilot/shared-domain";

/** Small builders for Security Lab tests. Every value is deterministic; times are fixed. */

export const T0 = "2026-01-01T00:00:00.000Z";
export const T1 = "2026-01-01T01:00:00.000Z";
export const OWNER_A = "aaaaaaaa-0000-4000-8000-000000000001";
export const OWNER_B = "bbbbbbbb-0000-4000-8000-000000000002";

export function makeContent(overrides: Partial<SecurityScenarioContent> = {}): SecurityScenarioContent {
  return {
    operationKey: "GET /orders",
    operationMethod: "GET",
    operationPath: "/orders",
    categoryId: "authentication",
    taxonomy: [{ edition: "owasp-api-top10-2023", id: "API2", relation: "primary" }],
    title: "GET /orders without credentials",
    objective: "Check that the operation rejects a request that carries no credentials.",
    rationale: "The effective security requirement is bearerAuth.",
    prerequisites: [],
    requiredIdentities: [],
    baseRequest: { pathParameters: {}, queryParameters: {}, headers: {} },
    mutations: [{ kind: "auth.omit" }],
    expected: {
      kind: "rejected",
      statement: "A request without valid authorization must not be processed as successful.",
      basis: "product-rule",
      ruleId: "SL-REJECT-NOT-SUCCESS",
    },
    conditions: [{ kind: "status.not-success" }],
    impact: "Unauthenticated callers could read orders.",
    suggestedSeverity: "high",
    destructive: { flag: false, reasons: [] },
    plannedRequestCount: 1,
    limitations: [],
    manualInputs: [],
    provenance: { operationKey: "GET /orders", specElementPointer: "/operations/GET /orders/security", ruleId: "auth-omit" },
    ...overrides,
  };
}

export function makeScenario(overrides: Partial<SecurityScenario> = {}): SecurityScenario {
  return {
    id: "ss-0000000000000001",
    ownerId: OWNER_A,
    assessmentKey: "assess-1",
    assessmentLabel: "Sample Orders API · sample-api.yaml",
    currentVersion: 1,
    reviewState: "draft",
    executionStatus: "not_run",
    origin: "rule",
    createdAt: T0,
    ...overrides,
  };
}

export function makeVersion(overrides: Partial<SecurityScenarioVersion> = {}): SecurityScenarioVersion {
  return {
    scenarioId: "ss-0000000000000001",
    version: 1,
    contentHash: "h".repeat(64),
    specificationRevision: "rev-1",
    securityBasisHash: "basis-1",
    content: makeContent(),
    author: "generator",
    createdAt: T0,
    materialChange: false,
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<SecurityProfile> = {}): SecurityProfile {
  return {
    id: "profile-1",
    name: "Local sample",
    environmentId: "env-1",
    allowedHosts: ["127.0.0.1"],
    allowedPorts: [4700],
    allowedAddressRanges: ["127.0.0.1/32"],
    tlsPolicy: "verify",
    identities: [],
    testData: [],
    timeoutMs: 10_000,
    maxRequests: 100,
    maxConcurrency: 1,
    permittedCategories: ["authentication"],
    destructivePermitted: false,
    cleanup: { strategy: "none" },
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export function makeRun(overrides: Partial<SecurityRun> = {}): SecurityRun {
  return {
    id: "run-1",
    ownerId: OWNER_A,
    sessionId: "session-1",
    status: "in-progress",
    cancelRequested: false,
    startedAt: T0,
    profileSummary: {
      profileId: "profile-1",
      profileName: "Local sample",
      environmentName: "local",
      tier: "local",
      baseUrl: "http://127.0.0.1:4700",
      tlsPolicy: "verify",
      permittedCategories: ["authentication"],
      limits: { maxRequests: 100, maxConcurrency: 1, timeoutMs: 10_000 },
      destructivePermitted: false,
    },
    plan: [{ scenarioId: "ss-0000000000000001", version: 1, plannedRequests: 1 }],
    planDigest: "d".repeat(64),
    limits: { maxRequests: 100, maxConcurrency: 1, timeoutMs: 10_000 },
    budget: { planned: 1, used: 0 },
    confirmation: {
      targetName: "local",
      targetBaseUrl: "http://127.0.0.1:4700",
      authorizationAttested: true,
      destructiveScenarioIds: [],
    },
    summary: { passed: 0, failed: 0, inconclusive: 0, blocked: 0, errored: 0, not_run: 0 },
    cleanup: [],
    assessmentKey: "assess-1",
    ...overrides,
  };
}

export function makeResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    id: "result-1",
    runId: "run-1",
    scenarioId: "ss-0000000000000001",
    version: 1,
    outcome: "failed",
    reason: "status 200 for a request without credentials",
    conditionResults: [{ condition: { kind: "status.not-success" }, state: "violated" }],
    observed: {
      responseStatus: 200,
      responseHeadersSelected: { "content-type": "application/json" },
      statement: "status 200",
      truncated: false,
    },
    evidenceCount: 1,
    startedAt: T0,
    durationMs: 12,
    ...overrides,
  };
}

export function makeFinding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    id: "sf-0000000000000001",
    ownerId: OWNER_A,
    assessmentKey: "assess-1",
    scenarioId: "ss-0000000000000001",
    scenarioVersion: 1,
    operationKey: "GET /orders",
    specElementPointer: "/operations/GET /orders/security",
    categoryId: "authentication",
    taxonomy: [{ edition: "owasp-api-top10-2023", id: "API2", relation: "primary" }],
    expected: makeContent().expected,
    severity: { suggested: "high", current: "high" },
    confidence: { level: "medium", basis: "product rule SL-REJECT-NOT-SUCCESS violated by status 200" },
    remediationId: "authentication.auth.omit",
    remediation: "Require a valid credential for this operation.",
    status: "open",
    resolvedAssertion: "engineer-asserted",
    occurrences: [
      {
        resultId: "result-1",
        runId: "run-1",
        at: T0,
        observed: { responseStatus: 200, responseHeadersSelected: {}, statement: "status 200", truncated: false },
        confidence: { level: "medium", basis: "product rule" },
      },
    ],
    occurrenceCount: 1,
    firstFailedAt: T0,
    latestFailedAt: T0,
    unreviewedOccurrence: false,
    history: [],
    ...overrides,
  };
}
