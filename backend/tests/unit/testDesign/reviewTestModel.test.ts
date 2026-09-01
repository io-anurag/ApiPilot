import { describe, expect, it } from "vitest";
import type { ReviewUpdateRequest } from "@apipilot/shared-domain";
import {
  applyReviewUpdates,
  computeReviewSummary,
  createReviewWorkspace,
  projectApprovedTestModel,
} from "../../../src/testDesign/reviewTestModel";
import {
  aiDerivedScenario,
  deterministicScenario,
  duplicateOfDeterministicScenario,
  reviewBaselineTestModel,
} from "../../fixtures/testDesign/reviewScenarioFixtures";

const fixedNow = () => new Date("2026-02-01T00:00:00.000Z");

describe("createReviewWorkspace", () => {
  it("starts every scenario as pending with revision 0 and no history", () => {
    const workspace = createReviewWorkspace(reviewBaselineTestModel);
    expect(workspace.workspaceRevision).toBe(0);
    for (const scenario of workspace.scenarios) {
      expect(scenario.state).toBe("pending");
      expect(scenario.revision).toBe(0);
      expect(scenario.history).toEqual([]);
    }
  });

  it("computes a summary where pending+accepted+rejected equals total", () => {
    const workspace = createReviewWorkspace(reviewBaselineTestModel);
    const { total, pending, accepted, rejected } = workspace.summary;
    expect(pending + accepted + rejected).toBe(total);
  });

  it("marks AI-derived pending scenarios as requiring review under the default policy", () => {
    const workspace = createReviewWorkspace({ scenarios: [aiDerivedScenario] });
    expect(workspace.summary.requiresReview).toBe(1);
  });
});

describe("computeReviewSummary", () => {
  it("counts zero requiresReview once every scenario has a decision", () => {
    const workspace = createReviewWorkspace(reviewBaselineTestModel);
    const updates: ReviewUpdateRequest[] = workspace.scenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      revision: scenario.revision,
      action: "accept",
    }));
    const { workspace: next } = applyReviewUpdates(workspace, updates, fixedNow);
    expect(computeReviewSummary(next.scenarios, next.policy).requiresReview).toBe(0);
  });
});

describe("applyReviewUpdates", () => {
  it("accepts a pending scenario and increments the workspace revision", () => {
    const workspace = createReviewWorkspace(reviewBaselineTestModel);
    const target = workspace.scenarios[0];
    const { workspace: next, outcomes } = applyReviewUpdates(
      workspace,
      [{ scenarioId: target.scenarioId, revision: target.revision, action: "accept" }],
      fixedNow,
    );
    expect(outcomes[0]).toMatchObject({ applied: true, state: "accepted" });
    expect(next.workspaceRevision).toBe(workspace.workspaceRevision + 1);
    expect(next.summary.accepted).toBe(1);
  });

  it("requires a non-empty rejection reason", () => {
    const workspace = createReviewWorkspace(reviewBaselineTestModel);
    const target = workspace.scenarios[0];
    const { outcomes } = applyReviewUpdates(
      workspace,
      [
        {
          scenarioId: target.scenarioId,
          revision: target.revision,
          action: "reject",
          reason: "   ",
        },
      ],
      fixedNow,
    );
    expect(outcomes[0]).toMatchObject({
      applied: false,
      finding: { code: "invalid-rejection-reason" },
    });
  });

  it("rejects a scenario with a valid reason and records it in history", () => {
    const workspace = createReviewWorkspace(reviewBaselineTestModel);
    const target = workspace.scenarios[0];
    const { workspace: next } = applyReviewUpdates(
      workspace,
      [
        {
          scenarioId: target.scenarioId,
          revision: target.revision,
          action: "reject",
          reason: "Duplicates an existing case",
        },
      ],
      fixedNow,
    );
    const updated = next.scenarios.find(
      (scenario) => scenario.scenarioId === target.scenarioId,
    )!;
    expect(updated.state).toBe("rejected");
    expect(updated.decision?.reason).toBe("Duplicates an existing case");
    expect(updated.history).toHaveLength(1);
  });

  it("produces a scenario-not-found finding for an unknown scenario ID", () => {
    const workspace = createReviewWorkspace(reviewBaselineTestModel);
    const { outcomes } = applyReviewUpdates(
      workspace,
      [{ scenarioId: "missing", revision: 0, action: "accept" }],
      fixedNow,
    );
    expect(outcomes[0].finding?.code).toBe("scenario-not-found");
  });

  it("produces a stale-revision finding and does not overwrite the current state", () => {
    const workspace = createReviewWorkspace(reviewBaselineTestModel);
    const target = workspace.scenarios[0];
    const { workspace: next, outcomes } = applyReviewUpdates(
      workspace,
      [
        {
          scenarioId: target.scenarioId,
          revision: target.revision + 5,
          action: "accept",
        },
      ],
      fixedNow,
    );
    expect(outcomes[0].finding?.code).toBe("stale-revision");
    expect(next.scenarios[0].state).toBe("pending");
  });

  it("prevents accepting a scenario equivalent to an already-accepted scenario", () => {
    const workspace = createReviewWorkspace({
      scenarios: [deterministicScenario, duplicateOfDeterministicScenario],
    });
    const [first, second] = workspace.scenarios;
    const { workspace: afterFirst } = applyReviewUpdates(
      workspace,
      [{ scenarioId: first.scenarioId, revision: first.revision, action: "accept" }],
      fixedNow,
    );
    const { outcomes } = applyReviewUpdates(
      afterFirst,
      [{ scenarioId: second.scenarioId, revision: second.revision, action: "accept" }],
      fixedNow,
    );
    expect(outcomes[0]).toMatchObject({
      applied: false,
      finding: { code: "duplicate-scenario" },
    });
  });

  it("applies ordered updates deterministically for identical input", () => {
    const workspace = createReviewWorkspace(reviewBaselineTestModel);
    const updates: ReviewUpdateRequest[] = [
      { scenarioId: workspace.scenarios[0].scenarioId, revision: 0, action: "accept" },
      {
        scenarioId: workspace.scenarios[1].scenarioId,
        revision: 0,
        action: "reject",
        reason: "no",
      },
    ];
    const runA = applyReviewUpdates(workspace, updates, fixedNow);
    const runB = applyReviewUpdates(workspace, updates, fixedNow);
    expect(runA.workspace.summary).toEqual(runB.workspace.summary);
    expect(runA.outcomes).toEqual(runB.outcomes);
  });
});

describe("projectApprovedTestModel", () => {
  it("includes only accepted scenarios", () => {
    const workspace = createReviewWorkspace(reviewBaselineTestModel);
    const target = workspace.scenarios[0];
    const { workspace: next } = applyReviewUpdates(
      workspace,
      [{ scenarioId: target.scenarioId, revision: target.revision, action: "accept" }],
      fixedNow,
    );
    const approved = projectApprovedTestModel(next);
    expect(approved.scenarios).toHaveLength(1);
    expect(approved.scenarios[0].id).toBe(target.scenarioId);
  });

  it("never includes pending or rejected scenarios", () => {
    const workspace = createReviewWorkspace(reviewBaselineTestModel);
    const approved = projectApprovedTestModel(workspace);
    expect(approved.scenarios).toHaveLength(0);
  });

  it("defensively deduplicates equivalent accepted scenarios", () => {
    const workspace = createReviewWorkspace({
      scenarios: [deterministicScenario, duplicateOfDeterministicScenario],
    });
    // Directly force both into accepted state bypassing the duplicate guard, to prove the
    // projection itself is defensively deduplicated even if an upstream invariant were violated.
    const forced = {
      ...workspace,
      scenarios: workspace.scenarios.map((scenario) => ({
        ...scenario,
        state: "accepted" as const,
      })),
    };
    const approved = projectApprovedTestModel(forced);
    expect(approved.scenarios).toHaveLength(1);
  });
});
