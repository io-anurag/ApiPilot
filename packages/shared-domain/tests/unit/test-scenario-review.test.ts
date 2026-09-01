import { describe, expect, it } from "vitest";
import type {
  ReviewDecision,
  ReviewScenario,
  ReviewSummary,
} from "@apipilot/shared-domain";
import { DEFAULT_REVIEW_POLICY } from "@apipilot/shared-domain";
import {
  acceptedReviewScenario,
  pendingReviewScenario,
  policyRequiredReviewWorkspace,
  rejectedReviewScenario,
  staleReviewScenario,
} from "../fixtures/testScenarioReviewFixtures";

describe("Test Scenario Review shared contracts", () => {
  it("restricts ReviewState to pending, accepted, or rejected", () => {
    expect(pendingReviewScenario.state).toBe("pending");
    expect(acceptedReviewScenario.state).toBe("accepted");
    expect(rejectedReviewScenario.state).toBe("rejected");
  });

  it("requires a decision only for accepted or rejected scenarios", () => {
    expect(pendingReviewScenario.decision).toBeUndefined();
    expect(acceptedReviewScenario.decision?.state).toBe("accepted");
    expect(rejectedReviewScenario.decision?.state).toBe("rejected");
  });

  it("requires a non-empty reason on the rejection decision", () => {
    const decision: ReviewDecision | undefined = rejectedReviewScenario.decision;
    expect(decision?.reason?.trim().length).toBeGreaterThan(0);
  });

  it("retains ordered history entries distinct from the active decision", () => {
    expect(acceptedReviewScenario.history).toHaveLength(1);
    expect(acceptedReviewScenario.history[0]).toMatchObject({ type: "decision" });
  });

  it("keeps ReviewScenario identity stable and separate from Provenance", () => {
    const scenario: ReviewScenario = staleReviewScenario;
    expect(scenario.scenarioId).toBe(scenario.scenario.id);
    expect(scenario.scenario.provenance.source).toBe("RULE");
  });

  it("increases revision only after edits or regeneration, defaulting to 0", () => {
    expect(pendingReviewScenario.revision).toBe(0);
    expect(staleReviewScenario.revision).toBe(2);
  });

  it("defines the default policy as requiring review for AI and user-modified origins", () => {
    expect(DEFAULT_REVIEW_POLICY.originsRequiringReview).toEqual(["AI", "USER"]);
  });

  it("summarizes counts that add up to the workspace total", () => {
    const summary: ReviewSummary = policyRequiredReviewWorkspace.summary;
    expect(summary.pending + summary.accepted + summary.rejected).toBe(summary.total);
    expect(summary.requiresReview).toBeLessThanOrEqual(summary.total);
  });
});
