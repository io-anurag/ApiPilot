import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";

/**
 * generateTestModel.ts and generateCollection.ts read apiModel.summary.issues
 * unguarded. Every JSON-body route accepting an apiModel must reject one missing
 * summary/securitySchemes as a structured 400 before reaching that code, rather than
 * an unhandled 500 (constitution/CLAUDE.md "Explicit Failure").
 */
const incompleteApiModel = { operations: [] };
const emptyTestModel = { scenarios: [] };

describe("apiModel structural validation", () => {
  it("POST /api/test-models rejects an apiModel missing summary/securitySchemes", async () => {
    const response = await request(createApp())
      .post("/api/test-models")
      .send({ apiModel: incompleteApiModel });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_api_model");
  });

  it("POST /api/test-models/enhance rejects an apiModel missing summary/securitySchemes", async () => {
    const response = await request(createApp())
      .post("/api/test-models/enhance")
      .send({ apiModel: incompleteApiModel, testModel: emptyTestModel });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_test_model_enhancement_request");
  });

  it("POST /api/test-models/reviews rejects an apiModel missing summary/securitySchemes", async () => {
    const response = await request(createApp())
      .post("/api/test-models/reviews")
      .send({ apiModel: incompleteApiModel, testModel: emptyTestModel });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_test_scenario_review_request");
  });

  it("POST /api/test-models/postman-collection rejects an apiModel missing summary/securitySchemes", async () => {
    const response = await request(createApp())
      .post("/api/test-models/postman-collection")
      .send({ apiModel: incompleteApiModel, testModel: emptyTestModel });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_request");
  });
});