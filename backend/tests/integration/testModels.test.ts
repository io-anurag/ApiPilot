import request from "supertest";
import { describe, expect, it } from "vitest";
import type { TestScenario } from "@apipilot/shared-domain";
import { createApp } from "../../src/app";
import { constraintsApiModel } from "../fixtures/testDesign/constraintsApiModel";
import { nestedRequiredApiModel } from "../fixtures/testDesign/nestedRequiredApiModel";

function scenariosFor(scenarios: TestScenario[], category: string, targetField?: string): TestScenario[] {
  return scenarios.filter((s) => s.category === category && (targetField === undefined || s.targetField === targetField));
}

describe("POST /api/test-models", () => {
  it("generates a positive scenario and nested/top-level required-field scenarios, excluding required path parameters", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/test-models")
      .send({ apiModel: nestedRequiredApiModel });

    expect(response.status).toBe(200);
    const scenarios: TestScenario[] = response.body.testModel.scenarios;

    expect(scenariosFor(scenarios, "positive")).toHaveLength(1);

    // Top-level required field "name".
    expect(scenariosFor(scenarios, "missing-field", "name")).toHaveLength(1);
    expect(scenariosFor(scenarios, "null-value", "name")).toHaveLength(1);
    expect(scenariosFor(scenarios, "empty-value", "name")).toHaveLength(1);

    // Nested required field "address.zipCode", whose immediate parent object is optional.
    expect(scenariosFor(scenarios, "missing-field", "address.zipCode")).toHaveLength(1);
    expect(scenariosFor(scenarios, "null-value", "address.zipCode")).toHaveLength(1);

    // Required query/header parameters receive missing/null/empty scenarios.
    expect(scenariosFor(scenarios, "missing-field", "requestedBy")).toHaveLength(1);
    expect(scenariosFor(scenarios, "missing-field", "X-Trace-Id")).toHaveLength(1);

    // Required path parameter "widgetId" is excluded from missing/null/empty (FR-009),
    // but still receives an invalid-type scenario.
    expect(scenariosFor(scenarios, "missing-field", "widgetId")).toHaveLength(0);
    expect(scenariosFor(scenarios, "null-value", "widgetId")).toHaveLength(0);
    expect(scenariosFor(scenarios, "invalid-type", "widgetId")).toHaveLength(1);
  });

  it("generates invalid-type/invalid-format/invalid-enum/boundary scenarios and an assertion gap when no 2xx is documented", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/api/test-models")
      .send({ apiModel: constraintsApiModel });

    expect(response.status).toBe(200);
    const scenarios: TestScenario[] = response.body.testModel.scenarios;

    expect(scenariosFor(scenarios, "invalid-format", "sku")).toHaveLength(1);
    expect(scenariosFor(scenarios, "invalid-format", "code")).toHaveLength(1);
    expect(scenariosFor(scenarios, "invalid-enum", "status")).toHaveLength(1);

    // The "at-minimum" boundary variant for quantity/label/tags is identical to the
    // conformant base value used by the positive scenario, so it legitimately dedups
    // into the positive scenario rather than appearing as its own entry (FR-012).
    expect(scenariosFor(scenarios, "numeric-boundary", "quantity")).toHaveLength(3);
    expect(scenariosFor(scenarios, "string-boundary", "label")).toHaveLength(3);
    // "tags" is also required, so its "below-minimum" (empty array) boundary variant
    // additionally dedups into the required-field "empty-value" scenario (FR-012).
    expect(scenariosFor(scenarios, "array-boundary", "tags")).toHaveLength(2);

    const positive = scenariosFor(scenarios, "positive")[0];
    expect(positive.assertions).toEqual([{ type: "status-code", expectedStatusCode: "400" }]);
    expect(positive.provenance.duplicateOfRules).toEqual(
      expect.arrayContaining(["numeric-boundary-at-minimum", "string-boundary-at-minimum", "array-boundary-at-minimum"]),
    );

    const requiredEmptyTags = scenariosFor(scenarios, "empty-value", "tags")[0];
    expect(requiredEmptyTags.provenance.duplicateOfRules).toContain("array-boundary-below-minimum");
  });

  it("returns 400 invalid_api_model when the body is missing a valid apiModel", async () => {
    const app = createApp();

    const response = await request(app).post("/api/test-models").send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_api_model");
  });

  it("responds 405 for non-POST methods", async () => {
    const app = createApp();

    const response = await request(app).get("/api/test-models");

    expect(response.status).toBe(405);
  });
});
