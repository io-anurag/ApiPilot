import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import {
  approvedTestModel,
  exportApiModel,
  minimalApiModel,
  minimalTestModel,
} from "../fixtures/postman/exportFixtures";

const ENDPOINT = "/api/test-models/postman-collection";

/**
 * Two approved scenarios sharing an id produce two items with the same content-derived id,
 * which the pre-delivery check rejects. It is a real defect the validator exists to catch, so
 * it exercises the refusal path without stubbing the validator.
 */
const duplicateIdTestModel = {
  scenarios: [
    minimalTestModel.scenarios[0],
    { ...minimalTestModel.scenarios[0], category: "invalid-type" },
  ],
};

describe(`${ENDPOINT} validation gate`, () => {
  it("reports a passing validation result alongside a successful export", async () => {
    const response = await request(createApp())
      .post(ENDPOINT)
      .send({ apiModel: exportApiModel, testModel: approvedTestModel });

    expect(response.status).toBe(200);
    expect(response.body.validation).toEqual({ valid: true, problems: [] });
  });

  it("delivers a successful export even when limitations were recorded", async () => {
    const response = await request(createApp())
      .post(ENDPOINT)
      .send({ apiModel: exportApiModel, testModel: approvedTestModel });

    expect(response.status).toBe(200);
    expect(response.body.limitations.length).toBeGreaterThan(0);
    expect(response.body.collection).toBeDefined();
  });

  it("refuses a collection that fails validation and withholds the artifacts", async () => {
    const response = await request(createApp())
      .post(ENDPOINT)
      .send({ apiModel: minimalApiModel, testModel: duplicateIdTestModel });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("collection_validation_failed");
    expect(response.body.problems.length).toBeGreaterThan(0);
    expect(response.body.collection).toBeUndefined();
    expect(response.body.environment).toBeUndefined();
    expect(response.body.readme).toBeUndefined();
  });

  it("describes what was wrong without exposing payloads or internal details", async () => {
    const response = await request(createApp())
      .post(ENDPOINT)
      .send({ apiModel: minimalApiModel, testModel: duplicateIdTestModel });

    const problems = (response.body.problems as string[]).join(" ");
    expect(problems).toContain("is not unique");
    expect(problems).not.toMatch(/\\|src\\|node_modules/);
    expect(response.body.stack).toBeUndefined();
  });

  it("records every limitation kind the approved model produced", async () => {
    const response = await request(createApp())
      .post(ENDPOINT)
      .send({ apiModel: exportApiModel, testModel: approvedTestModel });

    const kinds = new Set(
      (response.body.limitations as { kind: string }[]).map((limitation) => limitation.kind),
    );
    expect(kinds).toContain("no-expected-outcome");
    expect(kinds).toContain("undocumented-status-code");
    expect(kinds).toContain("unsupported-auth-scheme");
    expect(kinds).toContain("unsupported-content-type");
    expect(kinds).toContain("unresolved-path-parameter");
    expect(kinds).toContain("specification-analysis-issue");
    expect(kinds).toContain("alternative-auth-requirement-selected");
  });
});
