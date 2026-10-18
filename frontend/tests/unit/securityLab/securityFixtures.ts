import type {
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
