import type { ApiModel } from "./apiModel";
import type { Provenance, TestModel, TestScenario } from "./testModel";

/** Current human review decision for one scenario (data-model.md: Review State). */
export type ReviewState = "pending" | "accepted" | "rejected";

/** One reviewer decision applied to a specific scenario revision (data-model.md: Review Decision). */
export interface ReviewDecision {
  state: "accepted" | "rejected";
  reason?: string;
  actor?: string;
  recordedAt: string;
  revision: number;
}

/** A retained decision or content-changing event, oldest first (data-model.md: Review Scenario history). */
export type ReviewHistoryEntry =
  | { type: "decision"; decision: ReviewDecision }
  | { type: "edit"; revision: number; recordedAt: string; previousProvenance: Provenance }
  | {
      type: "regeneration";
      revision: number;
      recordedAt: string;
      previousProvenance: Provenance;
    };

/** A TestScenario plus its review workflow metadata (data-model.md: Review Scenario). */
export interface ReviewScenario {
  scenarioId: string;
  revision: number;
  scenario: TestScenario;
  state: ReviewState;
  isUserModified: boolean;
  decision?: ReviewDecision;
  history: ReviewHistoryEntry[];
}

/** Scenario origins recognized by review policy (data-model.md: Review Policy). */
export type ReviewPolicyOrigin = "AI" | "RULE" | "USER";

/** Identifies which scenario origins require explicit reviewer acceptance (FR-010). */
export interface ReviewPolicy {
  originsRequiringReview: readonly ReviewPolicyOrigin[];
}

/** The default AP-006 policy: AI-derived and user-modified content require explicit review (FR-010). */
export const DEFAULT_REVIEW_POLICY: ReviewPolicy = {
  originsRequiringReview: ["AI", "USER"],
};

/** Aggregate review progress for one workspace (data-model.md: Review Summary). */
export interface ReviewSummary {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  requiresReview: number;
}

/** The reviewable collection of scenarios for one TestModel (data-model.md: Review Workspace). */
export interface ReviewWorkspace {
  workspaceRevision: number;
  scenarios: ReviewScenario[];
  summary: ReviewSummary;
  policy: ReviewPolicy;
}

/** One accept/reject request for a single scenario at an observed revision. */
export interface ReviewUpdateRequest {
  scenarioId: string;
  revision: number;
  action: "accept" | "reject";
  reason?: string;
  actor?: string;
}

/** Distinguishable reasons an update, edit, or regeneration could not be applied (contracts: Update Outcomes). */
export type ReviewFindingCode =
  | "scenario-not-found"
  | "invalid-rejection-reason"
  | "stale-revision"
  | "duplicate-scenario"
  | "invalid-edit"
  | "policy-requires-review";

export interface ReviewFinding {
  code: ReviewFindingCode;
  message: string;
}

/** The result of applying one review update, edit, or regeneration request. */
export interface ReviewUpdateOutcome {
  scenarioId: string;
  applied: boolean;
  revision: number;
  state: ReviewState;
  finding?: ReviewFinding;
}

/** A supported replacement for a scenario's request/assertions (data-model.md: Review Edit). */
export interface ReviewEditContent {
  request: TestScenario["request"];
  assertions: TestScenario["assertions"];
  targetLocation?: TestScenario["targetLocation"];
  targetField?: TestScenario["targetField"];
}

/** Request to replace one scenario's test intent with a supported edit. */
export interface ReviewEditRequest {
  scenarioId: string;
  revision: number;
  edit: ReviewEditContent;
  actor?: string;
}

/** Request to regenerate an AI-derived scenario suggestion (data-model.md: Regeneration Request). */
export interface RegenerationRequest {
  scenarioId: string;
  revision: number;
}

/** Response payload for the review workspace endpoint (contracts/test-scenario-review-api.md). */
export interface ReviewWorkspaceResult {
  review: ReviewWorkspace;
  approvedTestModel: TestModel;
  outcomes: ReviewUpdateOutcome[];
}

/**
 * The workspace state a caller previously observed, resent so this stateless boundary can
 * apply new updates against the exact prior state instead of a fresh, empty workspace.
 */
export interface ReviewWorkspaceSnapshot {
  workspaceRevision: number;
  scenarios: ReviewScenario[];
}

/** Full request body accepted by `POST /api/test-models/reviews`. */
export interface TestScenarioReviewRequest {
  apiModel: ApiModel;
  testModel: TestModel;
  review?: {
    workspaceRevision?: number;
    scenarios?: ReviewScenario[];
    updates?: ReviewUpdateRequest[];
  };
}

/** Request body shared by the edit and regenerate endpoints. */
export interface ReviewScenarioActionRequest {
  apiModel: ApiModel;
  testModel: TestModel;
  review?: ReviewWorkspaceSnapshot;
  scenarioId: string;
  revision: number;
}
