import { describe, expect, it } from "vitest";
import {
  applyReviewEdit,
  createReviewWorkspace,
} from "../../../src/testDesign/reviewTestModel";
import {
  aiDerivedScenario,
  reviewApiModel,
  reviewBaselineTestModel,
} from "../../fixtures/testDesign/reviewScenarioFixtures";

const fixedNow = () => new Date("2026-02-01T00:00:00.000Z");

describe("applyReviewEdit", () => {
  it("applies a supported edit, increments revision, and resets state to pending", () => {
    const workspace = createReviewWorkspace(reviewBaselineTestModel);
    const target = workspace.scenarios.find(
      (s) => s.scenarioId === aiDerivedScenario.id,
    )!;
    const { workspace: next, outcome } = applyReviewEdit(
      workspace,
      reviewApiModel,
      target.scenarioId,
      target.revision,
      {
        request: {
          pathParameters: {},
          queryParameters: {},
          headers: { Authorization: "Bearer token" },
          body: { name: "Widget", quantity: 200 },
        },
        assertions: [{ type: "status-code", expectedStatusCode: "400" }],
        targetLocation: "body",
        targetField: "quantity",
      },
    );
    expect(outcome).toMatchObject({ applied: true, state: "pending", revision: 1 });
    const updated = next.scenarios.find((s) => s.scenarioId === target.scenarioId)!;
    expect(updated.isUserModified).toBe(true);
    expect(updated.revision).toBe(1);
  });

  it("marks the scenario as user-modified while preserving original AI provenance", () => {
    const workspace = createReviewWorkspace(reviewBaselineTestModel);
    const target = workspace.scenarios.find(
      (s) => s.scenarioId === aiDerivedScenario.id,
    )!;
    const { workspace: next } = applyReviewEdit(
      workspace,
      reviewApiModel,
      target.scenarioId,
      target.revision,
      {
        request: {
          pathParameters: {},
          queryParameters: {},
          headers: {},
          body: { name: "Widget", quantity: 200 },
        },
        assertions: [{ type: "status-code", expectedStatusCode: "400" }],
        targetLocation: "body",
        targetField: "quantity",
      },
    );
    const updated = next.scenarios.find((s) => s.scenarioId === target.scenarioId)!;
    expect(updated.scenario.provenance.source).toBe("AI");
    expect(updated.isUserModified).toBe(true);
  });

  it("retains prior history after an edit", () => {
    const workspace = createReviewWorkspace(reviewBaselineTestModel);
    const target = workspace.scenarios.find(
      (s) => s.scenarioId === aiDerivedScenario.id,
    )!;
    const { workspace: next } = applyReviewEdit(
      workspace,
      reviewApiModel,
      target.scenarioId,
      target.revision,
      {
        request: {
          pathParameters: {},
          queryParameters: {},
          headers: {},
          body: { name: "W", quantity: 1 },
        },
        assertions: [],
      },
      fixedNow,
    );
    const updated = next.scenarios.find((s) => s.scenarioId === target.scenarioId)!;
    expect(updated.history).toHaveLength(1);
    expect(updated.history[0]).toMatchObject({ type: "edit", revision: 1 });
  });

  it("increases the revision on each successful edit", () => {
    const workspace = createReviewWorkspace(reviewBaselineTestModel);
    const target = workspace.scenarios.find(
      (s) => s.scenarioId === aiDerivedScenario.id,
    )!;
    const firstEdit = applyReviewEdit(
      workspace,
      reviewApiModel,
      target.scenarioId,
      target.revision,
      {
        request: {
          pathParameters: {},
          queryParameters: {},
          headers: {},
          body: { name: "W", quantity: 1 },
        },
        assertions: [],
      },
    );
    const secondEdit = applyReviewEdit(
      firstEdit.workspace,
      reviewApiModel,
      target.scenarioId,
      1,
      {
        request: {
          pathParameters: {},
          queryParameters: {},
          headers: {},
          body: { name: "W2", quantity: 2 },
        },
        assertions: [],
      },
    );
    expect(secondEdit.outcome.revision).toBe(2);
  });

  it("rejects an edit referencing an unknown request-body field", () => {
    const workspace = createReviewWorkspace(reviewBaselineTestModel);
    const target = workspace.scenarios.find(
      (s) => s.scenarioId === aiDerivedScenario.id,
    )!;
    const { workspace: next, outcome } = applyReviewEdit(
      workspace,
      reviewApiModel,
      target.scenarioId,
      target.revision,
      {
        request: {
          pathParameters: {},
          queryParameters: {},
          headers: {},
          body: { name: "Widget", unknownField: true },
        },
        assertions: [],
      },
    );
    expect(outcome).toMatchObject({ applied: false, finding: { code: "invalid-edit" } });
    expect(next).toBe(workspace);
  });

  it("leaves the current state unchanged when the observed revision is stale", () => {
    const workspace = createReviewWorkspace(reviewBaselineTestModel);
    const target = workspace.scenarios.find(
      (s) => s.scenarioId === aiDerivedScenario.id,
    )!;
    const { workspace: next, outcome } = applyReviewEdit(
      workspace,
      reviewApiModel,
      target.scenarioId,
      target.revision + 1,
      {
        request: {
          pathParameters: {},
          queryParameters: {},
          headers: {},
          body: { name: "W", quantity: 1 },
        },
        assertions: [],
      },
    );
    expect(outcome.finding?.code).toBe("stale-revision");
    expect(next).toBe(workspace);
  });
});
