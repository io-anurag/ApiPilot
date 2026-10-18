import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ApiModel, TestScenario } from "@apipilot/shared-domain";
import { loadDefinition } from "../../../../src/apiInput/definition/loadDefinition";
import { buildApiModel } from "../../../../src/openapi/buildApiModel";
import { parseYaml } from "../../../../src/openapi/parseYaml";
import { validateSpec } from "../../../../src/openapi/validateSpec";
import { generateTestModel } from "../../../../src/testDesign/generateTestModel";

/**
 * specs/056 FR-037, SC-007: a definition and the OpenAPI document that states the same thing produce
 * the same deterministic scenarios. The existing rules read declared schemas exactly as they read
 * OpenAPI ones; the only differences are the origin labels the definition adds.
 */

const DEFINITION = path.resolve(__dirname, "../../../fixtures/apiInput/definitions/valid.json");

const EQUIVALENT_OPENAPI = `
openapi: 3.0.3
info:
  title: Orders API
  version: 1.0.0
paths:
  /orders:
    post:
      operationId: createOrder
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [sku, quantity]
              properties:
                sku: { type: string, minLength: 3 }
                quantity: { type: integer, minimum: 1, maximum: 100 }
      responses:
        "201":
          description: Order created.
          content:
            application/json:
              schema:
                type: object
                required: [id]
                properties:
                  id: { type: string }
        "400":
          description: Invalid order.
  /orders/{orderId}:
    get:
      operationId: getOrder
      parameters:
        - { name: orderId, in: path, required: true, schema: { type: string } }
        - { name: expand, in: query, schema: { type: string, enum: [items] } }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  id: { type: string }
`;

async function openApiModel(): Promise<ApiModel> {
  const { document, issues } = await validateSpec(parseYaml(EQUIVALENT_OPENAPI));
  return buildApiModel(document, issues);
}

/** What a scenario is, without its random id and without the origin labels only a definition adds. */
function essence(scenarios: TestScenario[]): string[] {
  return scenarios
    .map((scenario) =>
      JSON.stringify({
        operationPath: scenario.operationPath,
        operationMethod: scenario.operationMethod,
        category: scenario.category,
        targetLocation: scenario.targetLocation,
        targetField: scenario.targetField,
        request: scenario.request,
        assertions: scenario.assertions.map(({ basis: _basis, ...rest }) => rest),
        provenance: scenario.provenance,
      }),
    )
    .sort();
}

describe("a definition and its OpenAPI equivalent", () => {
  it("produce the same scenarios", async () => {
    const fromDefinition = generateTestModel(loadDefinition(JSON.parse(readFileSync(DEFINITION, "utf-8")))).scenarios;
    const fromOpenApi = generateTestModel(await openApiModel()).scenarios;
    expect(fromDefinition.length).toBeGreaterThan(8);
    expect(essence(fromDefinition)).toEqual(essence(fromOpenApi));
  });

  it("differ only in the declared label on each assertion, and only the definition carries it", async () => {
    const fromDefinition = generateTestModel(loadDefinition(JSON.parse(readFileSync(DEFINITION, "utf-8")))).scenarios;
    const fromOpenApi = generateTestModel(await openApiModel()).scenarios;
    for (const scenario of fromDefinition) for (const assertion of scenario.assertions) expect(assertion.basis).toBe("declared");
    for (const scenario of fromOpenApi) for (const assertion of scenario.assertions) expect(assertion.basis).toBeUndefined();
  });

  it("cover the same scenario categories the existing rules generate for a documented schema", () => {
    const categories = new Set(generateTestModel(loadDefinition(JSON.parse(readFileSync(DEFINITION, "utf-8")))).scenarios.map((s) => s.category));
    for (const expected of ["positive", "missing-field", "invalid-type", "invalid-enum", "numeric-boundary", "string-boundary"]) {
      expect(categories.has(expected as never), expected).toBe(true);
    }
  });
});
