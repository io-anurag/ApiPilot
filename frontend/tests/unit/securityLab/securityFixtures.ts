import type {
  CleanupResult,
  EvidenceRecord,
  FindingListReply,
  FindingOccurrence,
  RetainedDataSummary,
  SecurityExportReply,
  SecurityFinding,
  SecurityOverview,
  SecurityReport,
  SuggestReply,
  ProfileView,
  RunDetail,
  RunPreview,
  ScenarioResult,
  SecurityProfile,
  SecurityRunView,
  TargetEnvironment,
  ScenarioDerivedFlags,
  ScenarioDetail,
  ScenarioListItem,
  ScenarioListReply,
  ScenarioVersionSummary,
  SecurityAnalysis,
  SecurityCategory,
  SecurityObservation,
  SecurityScenarioContent,
} from "@apipilot/shared-domain";
import type { AnalysisReply, CategoriesReply } from "../../../src/services/securityLabClient";

/** Fixtures for Security Lab component tests. Plain data; no clock, no randomness. */

export function observation(overrides: Partial<SecurityObservation> = {}): SecurityObservation {
  return {
    id: "so-0000000000000001",
    ruleId: "effective-security-public",
    classification: "informational",
    operationKey: "GET /public/status",
    elementPointer: "/operations/GET /public/status/security",
    rationale: "The operation declares an empty security requirement, so the specification makes it public on purpose.",
    origin: "documented",
    categoryId: "authentication",
    ...overrides,
  };
}

export function analysis(observations: SecurityObservation[], overrides: Partial<SecurityAnalysis> = {}): SecurityAnalysis {
  const counts = { informational: 0, "potential-risk": 0, "requires-context": 0, "not-measurable": 0 };
  for (const entry of observations) counts[entry.classification] += 1;
  return {
    specificationRevision: "a".repeat(64),
    effective: [],
    observations,
    counts,
    unmeasurable: [],
    ...overrides,
  };
}

export function analysisReply(observations: SecurityObservation[], overrides: Partial<AnalysisReply> = {}): AnalysisReply {
  return { analysis: analysis(observations), configuredSensitiveFields: [], operationCount: 9, ...overrides };
}

export const CATEGORIES: SecurityCategory[] = [
  {
    id: "authentication",
    name: "Authentication",
    description: "x",
    supportLevel: "supported",
    executable: true,
    generatable: true,
    prerequisites: [],
    taxonomy: [{ edition: "owasp-api-top10-2023", id: "API2", relation: "primary" }],
  },
  {
    id: "input-validation",
    name: "Input validation",
    description: "x",
    supportLevel: "supported",
    executable: true,
    generatable: true,
    prerequisites: [],
    taxonomy: [{ edition: "owasp-api-top10-2023", id: "API8", relation: "related" }],
    limitationNote: "OWASP 2023 has no dedicated input-validation entry; the mapping to API8 is ApiPilot's judgement.",
  },
  {
    id: "ssrf-unsafe-consumption",
    name: "SSRF and unsafe API consumption",
    description: "x",
    supportLevel: "limited",
    executable: false,
    generatable: false,
    prerequisites: [],
    taxonomy: [
      { edition: "owasp-api-top10-2023", id: "API7", relation: "primary" },
      { edition: "owasp-api-top10-2023", id: "API10", relation: "primary" },
    ],
    limitationNote: "No reliable detection is claimed.",
  },
  {
    id: "api-inventory",
    name: "API inventory",
    description: "x",
    supportLevel: "analysis-only",
    executable: false,
    generatable: false,
    prerequisites: [],
    taxonomy: [{ edition: "owasp-api-top10-2023", id: "API9", relation: "primary" }],
  },
];

export const categoriesReply: CategoriesReply = {
  edition: "owasp-api-top10-2023",
  editionTitle: "OWASP API Security Top 10 (2023)",
  editionSource: "https://owasp.org/API-Security/editions/2023/en/0x11-t10/",
  taxonomy: [],
  categories: CATEGORIES,
};

// --- Scenarios -----------------------------------------------------------------------------------

export const NO_FLAGS: ScenarioDerivedFlags = { specificationNotLoaded: false, stale: false, orphaned: false, blocked: false, executable: false };

export function scenarioItem(overrides: Partial<ScenarioListItem> = {}): ScenarioListItem {
  return {
    id: "ss-0000000000000001",
    assessmentKey: "assessment-1",
    assessmentLabel: "Orders API · orders.yaml",
    reviewState: "draft",
    executionStatus: "not_run",
    origin: "rule",
    currentVersion: 1,
    title: "Reject a request with no credentials",
    operationKey: "GET /orders",
    categoryId: "authentication",
    severity: "high",
    destructive: false,
    flags: { ...NO_FLAGS },
    prerequisites: { total: 0, met: 0 },
    ...overrides,
  };
}

export function scenarioList(items: ScenarioListItem[], overrides: Partial<ScenarioListReply> = {}): ScenarioListReply {
  const tally = (pick: (item: ScenarioListItem) => string): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const item of items) counts[pick(item)] = (counts[pick(item)] ?? 0) + 1;
    return counts;
  };
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 25,
    counts: {
      byReviewState: tally((item) => item.reviewState),
      byExecutionStatus: tally((item) => item.executionStatus),
      byCategory: tally((item) => item.categoryId),
      bySeverity: tally((item) => item.severity),
    },
    ...overrides,
  };
}

export function scenarioContent(overrides: Partial<SecurityScenarioContent> = {}): SecurityScenarioContent {
  return {
    operationKey: "GET /orders",
    operationMethod: "GET",
    operationPath: "/orders",
    categoryId: "authentication",
    taxonomy: [{ edition: "owasp-api-top10-2023", id: "API2", relation: "primary" }],
    title: "Reject a request with no credentials",
    objective: "Check that the operation refuses a request that carries no credentials.",
    rationale: "The specification requires a bearer token for this operation.",
    prerequisites: [],
    requiredIdentities: [],
    baseRequest: { pathParameters: {}, queryParameters: {}, headers: { Accept: "application/json" } },
    mutations: [{ kind: "auth.omit" }],
    expected: { kind: "rejected", statement: "The operation rejects the request.", basis: "documented", documentedStatusCodes: [401], citation: "#/paths/~1orders/get/responses/401" },
    conditions: [{ kind: "status.in-set", codes: [401] }],
    impact: "Anyone could read orders without signing in.",
    suggestedSeverity: "high",
    destructive: { flag: false, reasons: [] },
    plannedRequestCount: 1,
    limitations: [],
    manualInputs: [],
    provenance: { operationKey: "GET /orders", specElementPointer: "/operations/GET /orders/security", ruleId: "authentication.omit-credentials" },
    ...overrides,
  };
}

export function versionSummary(overrides: Partial<ScenarioVersionSummary> = {}): ScenarioVersionSummary {
  return {
    version: 1,
    author: "generator",
    createdAt: "2026-10-18T09:12:03.000Z",
    materialChange: false,
    contentHash: "a".repeat(64),
    specificationRevision: "b".repeat(64),
    ...overrides,
  };
}

export function scenarioDetail(overrides: { scenario?: Partial<ScenarioListItem>; content?: Partial<SecurityScenarioContent>; versions?: ScenarioVersionSummary[] } = {}): ScenarioDetail {
  const content = scenarioContent(overrides.content);
  return {
    scenario: scenarioItem({ title: content.title, operationKey: content.operationKey, ...overrides.scenario }),
    content,
    versions: overrides.versions ?? [versionSummary()],
  };
}

// --- Profiles and runs ---------------------------------------------------------------------------

export function targetEnvironment(overrides: Partial<TargetEnvironment> = {}): TargetEnvironment {
  return { id: "env-1", name: "Staging", tier: "staging", baseUrl: "https://api.example.test", ...overrides };
}

export function securityProfile(overrides: Partial<SecurityProfile> = {}): SecurityProfile {
  return {
    id: "profile-1",
    name: "Staging run",
    environmentId: "env-1",
    allowedHosts: ["api.example.test"],
    allowedPorts: [443],
    allowedAddressRanges: [],
    tlsPolicy: "verify",
    identities: [{ name: "alice", role: "owner", credentialSchemes: ["bearerAuth"], expiredCredentialSchemes: ["bearerAuth"] }],
    testData: [],
    timeoutMs: 10000,
    maxRequests: 100,
    maxConcurrency: 2,
    permittedCategories: ["authentication"],
    destructivePermitted: false,
    cleanup: { strategy: "none" },
    createdAt: "2026-10-18T09:00:00.000Z",
    updatedAt: "2026-10-18T09:00:00.000Z",
    ...overrides,
  };
}

export function profileView(overrides: Omit<Partial<ProfileView>, "profile"> & { profile?: Partial<SecurityProfile> } = {}): ProfileView {
  const { profile: profileOverrides, ...rest } = overrides;
  return {
    profile: securityProfile(profileOverrides),
    environment: { name: "Staging", tier: "staging", baseUrl: "https://api.example.test" },
    credentialStatus: [
      { identity: "alice", scheme: "bearerAuth", kind: "active", set: false },
      { identity: "alice", scheme: "bearerAuth", kind: "expired", set: false },
    ],
    valid: true,
    problems: [],
    ...rest,
  };
}

export function runPreview(overrides: { summary?: Partial<RunPreview["summary"]>; scenarios?: RunPreview["scenarios"]; problems?: RunPreview["problems"] } = {}): RunPreview {
  const scenarios = overrides.scenarios ?? [
    { scenarioId: "ss-1", version: 1, title: "Reject a request with no credentials", operationKey: "GET /orders", categoryId: "authentication", plannedRequests: 1, destructive: false },
  ];
  return {
    summary: {
      profileName: "Staging run",
      environmentName: "Staging",
      tier: "staging",
      baseUrl: "https://api.example.test",
      tlsPolicy: "verify",
      scenarioCount: scenarios.length,
      plannedRequests: scenarios.reduce((sum, entry) => sum + entry.plannedRequests, 0),
      cleanupRequests: 0,
      destructive: scenarios.filter((entry) => entry.destructive),
      destinations: [{ host: "api.example.test", port: 443 }],
      limits: { maxRequests: 100, maxConcurrency: 2, timeoutMs: 10000 },
      permittedCategories: ["authentication"],
      statement: "Real requests will be sent to this target.",
      ...overrides.summary,
    },
    scenarios,
    planDigest: "d".repeat(64),
    problems: overrides.problems ?? [],
  };
}

export function runView(overrides: Partial<SecurityRunView> = {}): SecurityRunView {
  return {
    id: "run-1",
    status: "in-progress",
    cancelRequested: false,
    startedAt: "2026-10-18T10:00:00.000Z",
    profileSummary: {
      profileId: "profile-1",
      profileName: "Staging run",
      environmentName: "Staging",
      tier: "staging",
      baseUrl: "https://api.example.test",
      tlsPolicy: "verify",
      permittedCategories: ["authentication"],
      limits: { maxRequests: 100, maxConcurrency: 2, timeoutMs: 10000 },
      destructivePermitted: false,
    },
    plan: [{ scenarioId: "ss-1", version: 1, plannedRequests: 1 }],
    planDigest: "d".repeat(64),
    limits: { maxRequests: 100, maxConcurrency: 2, timeoutMs: 10000 },
    budget: { planned: 1, used: 0 },
    confirmation: { targetName: "Staging", targetBaseUrl: "https://api.example.test", authorizationAttested: true, destructiveScenarioIds: [] },
    summary: { passed: 0, failed: 0, inconclusive: 0, blocked: 0, errored: 0, not_run: 0 },
    cleanup: [],
    assessmentKey: "assessment-1",
    ...overrides,
  };
}

export function scenarioResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    id: "res-1",
    runId: "run-1",
    scenarioId: "ss-1",
    version: 1,
    outcome: "passed",
    reason: "The operation rejected the request with 401.",
    conditionResults: [],
    observed: { responseStatus: 401, responseHeadersSelected: {}, statement: "The response status was 401.", truncated: false },
    evidenceCount: 1,
    startedAt: "2026-10-18T10:00:01.000Z",
    durationMs: 12,
    ...overrides,
  };
}

export function runDetail(overrides: { run?: Partial<SecurityRunView>; results?: ScenarioResult[]; progress?: Partial<RunDetail["progress"]> } = {}): RunDetail {
  const run = runView(overrides.run);
  const results = overrides.results ?? [];
  return { run, results, progress: { planned: run.plan.length, finished: results.length, inFlight: 0, ...overrides.progress } };
}

export function cleanupEntry(overrides: Partial<CleanupResult> = {}): CleanupResult {
  return { scenarioId: "ss-1", action: "DELETE /orders/42", state: "done", detail: "Deleted the order the scenario created.", ...overrides };
}

// --- Findings, overview, report, retained data ----------------------------------------------------

export function findingOccurrence(overrides: Partial<FindingOccurrence> = {}): FindingOccurrence {
  return {
    resultId: "res-1",
    runId: "run-1",
    at: "2026-10-18T10:00:05.000Z",
    observed: { responseStatus: 200, responseHeadersSelected: {}, statement: "The operation answered 200 to a request with no credentials.", truncated: false },
    confidence: { level: "high", basis: "The response status contradicted the documented 401." },
    evidenceAvailable: true,
    ...overrides,
  };
}

export function finding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  const occurrences = overrides.occurrences ?? [findingOccurrence()];
  return {
    id: "sf-0000000000000001",
    ownerId: "owner",
    assessmentKey: "assessment-1",
    scenarioId: "ss-1",
    scenarioVersion: 1,
    operationKey: "GET /orders",
    specElementPointer: "/operations/GET /orders/security",
    categoryId: "authentication",
    taxonomy: [{ edition: "owasp-api-top10-2023", id: "API2", relation: "primary" }],
    expected: { kind: "rejected", statement: "The operation rejects a request with no credentials.", basis: "documented", documentedStatusCodes: [401], citation: "#/paths/~1orders/get/responses/401" },
    severity: { suggested: "high", current: "high" },
    confidence: { level: "high", basis: "The response status contradicted the documented 401." },
    remediationId: "auth.require-credentials",
    remediation: "Require a valid credential on this operation and return 401 when it is missing.",
    status: "open",
    resolvedAssertion: "engineer-asserted",
    occurrences,
    occurrenceCount: occurrences.length,
    firstFailedAt: "2026-10-18T10:00:05.000Z",
    latestFailedAt: "2026-10-18T10:00:05.000Z",
    unreviewedOccurrence: false,
    history: [],
    ...overrides,
  };
}

export function findingList(items: SecurityFinding[], overrides: Partial<FindingListReply> = {}): FindingListReply {
  const tally = (pick: (entry: SecurityFinding) => string): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const entry of items) counts[pick(entry)] = (counts[pick(entry)] ?? 0) + 1;
    return counts;
  };
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 25,
    counts: {
      byStatus: tally((entry) => entry.status),
      bySeverity: tally((entry) => entry.severity.current),
      occurrences: items.reduce((sum, entry) => sum + entry.occurrenceCount, 0),
      withUnreviewedOccurrence: items.filter((entry) => entry.unreviewedOccurrence).length,
    },
    ...overrides,
  };
}

export function evidenceRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    index: 0,
    sentAt: "2026-10-18T10:00:04.000Z",
    durationMs: 12,
    method: "GET",
    urlRedacted: "https://api.example.test/orders",
    requestHeadersRedacted: { Accept: "application/json", Authorization: "[redacted]" },
    destination: { host: "api.example.test", port: 443, addressClass: "public", verdict: "allowed" },
    redirects: [],
    responseStatus: 200,
    responseHeadersSelected: { "content-type": "application/json" },
    responseBodyExcerpt: '{"orders":[]}',
    truncated: false,
    ...overrides,
  };
}

export function overview(overrides: Partial<SecurityOverview> = {}): SecurityOverview {
  return {
    specificationLoaded: true,
    specificationRevision: "a".repeat(64),
    observationCounts: { informational: 2, "potential-risk": 1, "requires-context": 1, "not-measurable": 0 },
    scenarioCounts: {
      total: 12,
      byCategory: { authentication: 8, "input-validation": 4 },
      byReviewState: { draft: 7, in_review: 2, approved: 3, rejected: 0 },
      stale: 2,
      orphaned: 0,
      blocked: 5,
      specificationNotLoaded: 0,
    },
    scope: { mode: "selection", included: 3, excluded: 6 },
    latestRun: { id: "run-1", startedAt: "2026-10-18T10:00:00.000Z", status: "completed", summary: { passed: 2, failed: 1, inconclusive: 0, blocked: 1, errored: 0, not_run: 0 } },
    findingCounts: {
      total: 3,
      bySeverity: { info: 0, low: 0, medium: 1, high: 2, critical: 0 },
      byStatus: { open: 2, "accepted-risk": 1, "false-positive": 0, resolved: 0 },
      occurrences: 7,
      withUnreviewedOccurrence: 1,
    },
    untestedHighPriority: [{ operationKey: "DELETE /orders/{id}", basis: "effective-security-public: The operation is public by declaration." }],
    ...overrides,
  };
}

export function securityReport(overrides: Partial<SecurityReport> = {}): SecurityReport {
  const f = finding();
  return {
    generatedAt: "2026-10-18T12:00:00.000Z",
    assessmentLabel: "Orders API · orders.yaml",
    specificationRevision: "a".repeat(64),
    taxonomyEdition: "owasp-api-top10-2023",
    overview: overview(),
    categoryCoverage: [
      { categoryId: "authentication", name: "Authentication", supportLevel: "supported", scenarios: 8, outcomes: { passed: 2, failed: 1, inconclusive: 0, blocked: 1, errored: 0, not_run: 4 } },
      { categoryId: "api-inventory", name: "API inventory", supportLevel: "analysis-only", scenarios: 0, outcomes: { passed: 0, failed: 0, inconclusive: 0, blocked: 0, errored: 0, not_run: 0 } },
    ],
    findings: [f],
    runs: [{ id: "run-1", startedAt: "2026-10-18T10:00:00.000Z", status: "completed", profileName: "Staging run", tier: "staging", baseUrl: "https://api.example.test" }],
    notCovered: [{ categoryId: "api-inventory", reason: "This category is analysis only and cannot be run." }],
    limitsStatement: "This assessment covers only the scenarios that were run, against the target and at the time shown. It does not prove the API is secure.",
    ...overrides,
  };
}

export function exportReply(overrides: Partial<SecurityExportReply> = {}): SecurityExportReply {
  return {
    collection: {
      info: { name: "Security Lab", _postman_id: "id", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
      variable: [{ key: "baseUrl", value: "" }],
      item: [],
    },
    environment: {
      name: "Security Lab environment",
      _postman_variable_scope: "environment",
      values: [
        { key: "baseUrl", value: "", type: "default", enabled: true },
        { key: "bearerToken", value: "", type: "secret", enabled: true },
      ],
    },
    readme: "# Security Lab\n",
    validation: { valid: true, problems: [] },
    limitations: [],
    summary: { requestCount: 4, folderCount: 2, byProvenance: { RULE: 4, AI: 0 } },
    credentialProducers: [],
    excluded: [],
    ...overrides,
  };
}

export function suggestReply(overrides: Partial<SuggestReply> = {}): SuggestReply {
  return {
    accepted: [{ id: "ss-ai-1", title: "Reject a request with no credentials", operationKey: "GET /orders", categoryId: "authentication" }],
    rejected: [{ index: 1, operationKey: "GET /orders", title: "Call another host", reason: "url_in_content: a scenario cannot name a destination.", violations: [{ pointer: "/request/path", code: "url_in_content", message: "a scenario cannot name a destination." }] }],
    model: "mock-model",
    ignored: 0,
    ...overrides,
  };
}

export function retainedData(overrides: Partial<RetainedDataSummary> = {}): RetainedDataSummary {
  return {
    assessments: [
      { assessmentKey: "k1", assessmentLabel: "Orders API · orders.yaml", scenarios: 12, runs: 2, findings: 3 },
      { assessmentKey: "k2", assessmentLabel: "Billing API · billing.yaml", scenarios: 4, runs: 0, findings: 0 },
    ],
    totals: { scenarios: 16, runs: 2, findings: 3 },
    caps: { maxScenarios: 5000, maxRuns: 500 },
    removedWithSession: ["Target profiles, with their allowed hosts and ports, identities and test data", "The credentials you entered for identities", "The raw redacted evidence behind results and finding occurrences"],
    retained: ["Scenarios, with every version and the approval each version received", "Run results, with a bounded observed summary for each", "Findings, with their history and occurrences", "The sensitive field names you configured"],
    ...overrides,
  };
}
