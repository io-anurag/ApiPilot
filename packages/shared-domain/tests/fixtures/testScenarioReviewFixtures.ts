import type {
  ReviewScenario,
  ReviewWorkspace,
  TestScenario,
} from "@apipilot/shared-domain";
import { DEFAULT_REVIEW_POLICY } from "@apipilot/shared-domain";

/** A rule-derived, positive scenario used as a pending baseline fixture. */
export const pendingRuleScenario: TestScenario = {
  id: "scenario-rule-1",
  operationPath: "/widgets",
  operationMethod: "POST",
  category: "positive",
  request: {
    pathParameters: {},
    queryParameters: {},
    headers: {},
    body: { name: "Widget" },
  },
  assertions: [{ type: "status-code", expectedStatusCode: "201" }],
  provenance: {
    source: "RULE",
    rule: "positive-request",
    description: "Fully conformant request",
    duplicateOfRules: [],
  },
};

/** An AI-derived scenario used to exercise policy-required review fixtures. */
export const pendingAIScenario: TestScenario = {
  id: "scenario-ai-1",
  operationPath: "/widgets",
  operationMethod: "POST",
  category: "invalid-format",
  targetLocation: "body",
  targetField: "name",
  request: {
    pathParameters: {},
    queryParameters: {},
    headers: {},
    body: { name: 12345 },
  },
  assertions: [{ type: "status-code", expectedStatusCode: "400" }],
  provenance: {
    source: "AI",
    aiCandidateId: "candidate-1",
    description: "Wrong type for name",
    duplicateOfRules: [],
    duplicateOfAICandidates: [],
    aiModel: "mock-model",
    aiProvider: "mock",
    aiRationale: "name should be a string",
    aiConfidence: 0.8,
    aiAssumptions: [],
  },
};

export const pendingReviewScenario: ReviewScenario = {
  scenarioId: pendingRuleScenario.id,
  revision: 0,
  scenario: pendingRuleScenario,
  state: "pending",
  isUserModified: false,
  history: [],
};

export const acceptedReviewScenario: ReviewScenario = {
  scenarioId: pendingAIScenario.id,
  revision: 0,
  scenario: pendingAIScenario,
  state: "accepted",
  isUserModified: false,
  decision: {
    state: "accepted",
    recordedAt: "2026-01-01T00:00:00.000Z",
    revision: 0,
  },
  history: [
    {
      type: "decision",
      decision: {
        state: "accepted",
        recordedAt: "2026-01-01T00:00:00.000Z",
        revision: 0,
      },
    },
  ],
};

export const rejectedReviewScenario: ReviewScenario = {
  scenarioId: "scenario-rule-2",
  revision: 0,
  scenario: {
    ...pendingRuleScenario,
    id: "scenario-rule-2",
    category: "missing-field",
    request: { pathParameters: {}, queryParameters: {}, headers: {}, body: {} },
    assertions: [{ type: "status-code", expectedStatusCode: "400" }],
  },
  state: "rejected",
  isUserModified: false,
  decision: {
    state: "rejected",
    reason: "Duplicates an already-approved scenario",
    recordedAt: "2026-01-01T00:00:00.000Z",
    revision: 0,
  },
  history: [
    {
      type: "decision",
      decision: {
        state: "rejected",
        reason: "Duplicates an already-approved scenario",
        recordedAt: "2026-01-01T00:00:00.000Z",
        revision: 0,
      },
    },
  ],
};

export const staleReviewScenario: ReviewScenario = {
  scenarioId: "scenario-stale-1",
  revision: 2,
  scenario: { ...pendingRuleScenario, id: "scenario-stale-1" },
  state: "pending",
  isUserModified: false,
  history: [],
};

export const policyRequiredReviewWorkspace: ReviewWorkspace = {
  workspaceRevision: 1,
  scenarios: [pendingReviewScenario, acceptedReviewScenario, rejectedReviewScenario],
  policy: DEFAULT_REVIEW_POLICY,
  summary: { total: 3, pending: 1, accepted: 1, rejected: 1, requiresReview: 1 },
};
