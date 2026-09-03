import type {
  ApiModel,
  GeneratedRequest,
  ReviewEditContent,
  ReviewScenario,
  ReviewUpdateOutcome,
  ReviewUpdateRequest,
  ReviewWorkspace,
  TestModel,
  TestScenario,
} from "@apipilot/shared-domain";

/** A ReviewScenario as returned over HTTP, with an additive redacted display request (FR-018). */
export interface ReviewScenarioWire extends Omit<ReviewScenario, "scenario"> {
  scenario: TestScenario & { displayRequest: GeneratedRequest };
}

/** A ReviewWorkspace as returned over HTTP, using wire-shaped scenarios. */
export interface ReviewWorkspaceWire extends Omit<ReviewWorkspace, "scenarios"> {
  scenarios: ReviewScenarioWire[];
}

export interface ReviewWorkspaceResultWire {
  review: ReviewWorkspaceWire;
  approvedTestModel: TestModel;
  outcomes: ReviewUpdateOutcome[];
}

export type ReviewRequestResult =
  | ({ ok: true } & ReviewWorkspaceResultWire)
  | { ok: false; error: string; message: string };

/** The previously observed workspace state, resent so the stateless review boundary can apply new requests against it. */
export interface ReviewSnapshot {
  workspaceRevision: number;
  scenarios: ReviewScenarioWire[];
}

/** Builds the resend snapshot this stateless API expects from the last known workspace, if any. */
export function toReviewSnapshot(
  review: ReviewWorkspaceWire | null,
): ReviewSnapshot | undefined {
  if (!review) return undefined;
  return { workspaceRevision: review.workspaceRevision, scenarios: review.scenarios };
}

async function postReview(path: string, body: unknown): Promise<ReviewRequestResult> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        error: (parsed?.error as string) ?? "unknown_error",
        message:
          (parsed?.message as string) ?? `Request failed with status ${response.status}`,
      };
    }
    return {
      ok: true,
      review: parsed.review as ReviewWorkspaceWire,
      approvedTestModel: parsed.approvedTestModel as TestModel,
      outcomes: parsed.outcomes as ReviewUpdateOutcome[],
    };
  } catch (err) {
    return {
      ok: false,
      error: "network_error",
      message: err instanceof Error ? err.message : "Request failed",
    };
  }
}

/** Initializes a review workspace for a freshly generated TestModel (US1). */
export function loadReviewWorkspace(
  apiModel: ApiModel,
  testModel: TestModel,
): Promise<ReviewRequestResult> {
  return postReview("/api/test-models/reviews", { apiModel, testModel });
}

/** Applies one or more accept/reject decisions against the last known workspace state (US2). */
export function applyReviewDecisions(
  apiModel: ApiModel,
  testModel: TestModel,
  snapshot: ReviewSnapshot | undefined,
  updates: ReviewUpdateRequest[],
): Promise<ReviewRequestResult> {
  return postReview("/api/test-models/reviews", {
    apiModel,
    testModel,
    review: {
      workspaceRevision: snapshot?.workspaceRevision,
      scenarios: snapshot?.scenarios,
      updates,
    },
  });
}

/** Replaces a scenario's request/assertions with a validated, reviewer-supplied edit (US3). */
export function submitReviewEdit(
  apiModel: ApiModel,
  testModel: TestModel,
  snapshot: ReviewSnapshot | undefined,
  scenarioId: string,
  revision: number,
  edit: ReviewEditContent,
): Promise<ReviewRequestResult> {
  return postReview("/api/test-models/reviews/edit", {
    apiModel,
    testModel,
    review: snapshot,
    scenarioId,
    revision,
    edit,
  });
}

/** Requests an AI regeneration of an AI-derived scenario, preserving the current one on failure (US3). */
export function requestReviewRegeneration(
  apiModel: ApiModel,
  testModel: TestModel,
  snapshot: ReviewSnapshot | undefined,
  scenarioId: string,
  revision: number,
): Promise<ReviewRequestResult> {
  return postReview("/api/test-models/reviews/regenerate", {
    apiModel,
    testModel,
    review: snapshot,
    scenarioId,
    revision,
  });
}
