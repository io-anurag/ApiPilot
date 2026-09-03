import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import {
  aiDerivedScenario,
  deterministicScenario,
  duplicateOfDeterministicScenario,
  reviewApiModel,
  reviewBaselineTestModel,
} from "../fixtures/testDesign/reviewScenarioFixtures";

describe("POST /api/test-models/reviews", () => {
  it("initializes a review workspace with every scenario pending when updates is empty", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/test-models/reviews")
      .send({ apiModel: reviewApiModel, testModel: reviewBaselineTestModel });

    expect(response.status).toBe(200);
    expect(response.body.review.summary.total).toBe(2);
    expect(response.body.review.summary.pending).toBe(2);
    expect(response.body.approvedTestModel.scenarios).toHaveLength(0);
    expect(response.body.outcomes).toEqual([]);
  });

  it("applies accept and reject updates and reports summary counts", async () => {
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
            {
              scenarioId: aiDerivedScenario.id,
              revision: 0,
              action: "reject",
              reason: "Not relevant to this release",
            },
          ],
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.review.summary).toMatchObject({
      total: 2,
      pending: 0,
      accepted: 1,
      rejected: 1,
    });
    expect(response.body.outcomes).toHaveLength(2);
    expect(response.body.outcomes.every((o: { applied: boolean }) => o.applied)).toBe(
      true,
    );
  });

  it("projects only accepted scenarios into the approved TestModel", async () => {
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

    expect(response.body.approvedTestModel.scenarios).toHaveLength(1);
    expect(response.body.approvedTestModel.scenarios[0].id).toBe(
      deterministicScenario.id,
    );
  });

  it("rejects an empty rejection reason with an invalid-rejection-reason finding", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/test-models/reviews")
      .send({
        apiModel: reviewApiModel,
        testModel: reviewBaselineTestModel,
        review: {
          workspaceRevision: 0,
          updates: [
            {
              scenarioId: deterministicScenario.id,
              revision: 0,
              action: "reject",
              reason: "  ",
            },
          ],
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.outcomes[0]).toMatchObject({
      applied: false,
      finding: { code: "invalid-rejection-reason" },
    });
  });

  it("prevents accepting a scenario equivalent to an already-accepted scenario", async () => {
    const app = createApp();
    const testModel = {
      scenarios: [deterministicScenario, duplicateOfDeterministicScenario],
    };
    const first = await request(app)
      .post("/api/test-models/reviews")
      .send({
        apiModel: reviewApiModel,
        testModel,
        review: {
          workspaceRevision: 0,
          updates: [
            { scenarioId: deterministicScenario.id, revision: 0, action: "accept" },
          ],
        },
      });

    const second = await request(app)
      .post("/api/test-models/reviews")
      .send({
        apiModel: reviewApiModel,
        testModel,
        review: {
          workspaceRevision: first.body.review.workspaceRevision,
          scenarios: first.body.review.scenarios,
          updates: [
            {
              scenarioId: duplicateOfDeterministicScenario.id,
              revision: 0,
              action: "accept",
            },
          ],
        },
      });

    expect(second.body.outcomes[0]).toMatchObject({
      applied: false,
      finding: { code: "duplicate-scenario" },
    });
    expect(second.body.approvedTestModel.scenarios).toHaveLength(1);
  });

  it("returns 400 invalid_test_scenario_review_request when apiModel or testModel is missing", async () => {
    const app = createApp();
    const response = await request(app).post("/api/test-models/reviews").send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_test_scenario_review_request");
  });

  it("returns 405 method_not_allowed for unsupported methods", async () => {
    const app = createApp();
    const response = await request(app).get("/api/test-models/reviews");

    expect(response.status).toBe(405);
    expect(response.body.error).toBe("method_not_allowed");
  });
});

describe("POST /api/test-models/reviews/edit", () => {
  it("returns 409 for a stale revision", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/test-models/reviews/edit")
      .send({
        apiModel: reviewApiModel,
        testModel: reviewBaselineTestModel,
        scenarioId: aiDerivedScenario.id,
        revision: 5,
        edit: {
          request: aiDerivedScenario.request,
          assertions: aiDerivedScenario.assertions,
        },
      });

    expect(response.status).toBe(409);
    expect(response.body.outcomes[0]).toMatchObject({
      applied: false,
      finding: { code: "stale-revision" },
    });
  });

  it("returns 405 method_not_allowed for unsupported methods", async () => {
    const app = createApp();
    const response = await request(app).get("/api/test-models/reviews/edit");

    expect(response.status).toBe(405);
    expect(response.body.error).toBe("method_not_allowed");
  });
});
