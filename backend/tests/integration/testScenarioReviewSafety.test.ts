import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import {
  deterministicScenario,
  reviewApiModel,
  reviewBaselineTestModel,
} from "../fixtures/testDesign/reviewScenarioFixtures";

describe("Test Scenario Review safety boundary", () => {
  it("never executes the underlying API request when accepting or rejecting a scenario", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = createApp();

    await request(app)
      .post("/api/test-models/reviews")
      .send({
        apiModel: reviewApiModel,
        testModel: reviewBaselineTestModel,
        review: {
          workspaceRevision: 0,
          updates: [
            { scenarioId: deterministicScenario.id, revision: 0, action: "accept" },
          ],
        },
      });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("does not generate or execute any artifact merely because a scenario was accepted", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/test-models/reviews")
      .send({
        apiModel: reviewApiModel,
        testModel: reviewBaselineTestModel,
        review: {
          workspaceRevision: 0,
          updates: [
            { scenarioId: deterministicScenario.id, revision: 0, action: "accept" },
          ],
        },
      });

    // Acceptance only affects review state and the approved TestModel projection; the
    // response never carries execution results, run identifiers, or artifact locations.
    expect(response.body).not.toHaveProperty("executionResult");
    expect(response.body).not.toHaveProperty("artifact");
    expect(response.body.review.scenarios[0].state).toBe("accepted");
  });

  it("redacts sensitive header values in the review display request, without altering approval outcomes", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/test-models/reviews")
      .send({
        apiModel: reviewApiModel,
        testModel: reviewBaselineTestModel,
        review: {
          workspaceRevision: 0,
          updates: [
            { scenarioId: deterministicScenario.id, revision: 0, action: "accept" },
          ],
        },
      });

    const accepted = response.body.review.scenarios.find(
      (s: { scenarioId: string }) => s.scenarioId === deterministicScenario.id,
    );
    expect(accepted.scenario.displayRequest.headers.Authorization).toBe("[redacted]");
  });
});
