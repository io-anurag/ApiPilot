import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ApiModel, ApiOperation } from "@apipilot/shared-domain";
import { buildHarModel } from "../../../src/apiInput/har/buildHarModel";
import { DEFAULT_INPUT_LIMITS } from "../../../src/apiInput/limits";
import { buildApiModel } from "../../../src/openapi/buildApiModel";
import { parseYaml } from "../../../src/openapi/parseYaml";
import { validateSpec } from "../../../src/openapi/validateSpec";
import { generateTestModel, generateTestModelWithNotes } from "../../../src/testDesign/generateTestModel";
import { harOf, jsonEntry } from "../../fixtures/apiInput/harBuilders";

const fixtures = path.resolve(__dirname, "../../fixtures/openapi");

async function openApiModel(file: string): Promise<ApiModel> {
  const { document, issues } = await validateSpec(parseYaml(readFileSync(path.join(fixtures, file), "utf-8")));
  return buildApiModel(document, issues);
}

const withoutIds = (model: { scenarios: { id: string }[] }) => model.scenarios.map(({ id: _id, ...rest }) => rest);

describe("generateTestModelWithNotes: dispatch by provenance (FR-030, FR-034)", () => {
  it("runs the existing rules, unchanged, for every operation without provenance (OpenAPI)", async () => {
    for (const file of ["valid.yaml", "body-heavy.yaml", "performance.yaml"]) {
      const model = await openApiModel(file);
      expect(model.operations.every((operation) => operation.provenance === undefined)).toBe(true);
      const withNotes = generateTestModelWithNotes(model);
      expect(withNotes.notes).toEqual([]);
      expect(withoutIds(withNotes.testModel)).toEqual(withoutIds(generateTestModel(model)));
      expect(withNotes.testModel.scenarios.length).toBeGreaterThan(0);
      // OpenAPI scenarios carry no new fields.
      for (const scenario of withNotes.testModel.scenarios) {
        expect(scenario.evidence).toBeUndefined();
        expect(scenario.assertions.every((assertion) => assertion.basis === undefined)).toBe(true);
      }
    }
  });

  it("treats an operation explicitly marked documented exactly like an OpenAPI one", async () => {
    const model = await openApiModel("valid.yaml");
    const marked: ApiModel = { ...model, operations: model.operations.map((o) => ({ ...o, provenance: { origin: "documented" as const } })) };
    expect(withoutIds(generateTestModel(marked))).toEqual(withoutIds(generateTestModel(model)));
  });

  it("runs only the observed rules for an observed operation and keeps the notes", async () => {
    const har = await buildHarModel(
      harOf([
        jsonEntry("POST", "https://api.shop.test/v1/orders", 201, {}, { sku: "A" }),
        jsonEntry("GET", "https://api.shop.test/v1/denied", 403, {}),
      ]),
      DEFAULT_INPUT_LIMITS,
    );
    const { testModel, notes } = generateTestModelWithNotes(har);
    expect(testModel.scenarios.map((s) => `${s.operationMethod} ${s.operationPath} ${s.category}`)).toEqual(["POST /v1/orders positive"]);
    expect(notes).toEqual([expect.objectContaining({ operationMethod: "GET", operationPath: "/v1/denied" })]);
  });

  it("mixes both in one model, each operation using its own rule set", async () => {
    const openapi = await openApiModel("valid.yaml");
    const har = await buildHarModel(harOf([jsonEntry("GET", "https://api.shop.test/v1/ping", 200, { ok: true })]), DEFAULT_INPUT_LIMITS);
    const mixed: ApiModel = { ...openapi, operations: [...openapi.operations, ...har.operations] };
    const { testModel } = generateTestModelWithNotes(mixed);
    const observed = testModel.scenarios.filter((s) => s.operationPath === "/v1/ping");
    expect(observed).toHaveLength(1);
    expect(observed[0].evidence?.origin).toBe("observed");
    const documented = testModel.scenarios.filter((s) => s.operationPath !== "/v1/ping");
    expect(documented.length).toBeGreaterThan(0);
    expect(documented.every((s) => s.evidence === undefined)).toBe(true);
  });

  it("deduplicates over the combined list and still preserves provenance", async () => {
    const har = await buildHarModel(harOf([jsonEntry("GET", "https://api.shop.test/v1/a", 200, {}), jsonEntry("GET", "https://api.shop.test/v1/a", 200, {})]), DEFAULT_INPUT_LIMITS);
    const { testModel } = generateTestModelWithNotes(har);
    expect(testModel.scenarios).toHaveLength(1);
    expect(testModel.scenarios[0].provenance).toMatchObject({ source: "RULE", duplicateOfRules: [] });
  });

  it("never assigns observed provenance to a scenario of a non-observed operation", () => {
    const operation: ApiOperation = { path: "/x", method: "GET", operationId: undefined, parameters: [], requestBody: undefined, responses: [], security: [], tags: [] };
    const { testModel } = generateTestModelWithNotes({ operations: [operation], securitySchemes: {}, summary: { operationCount: 1, schemaCount: 0, securitySchemeCount: 0, issues: [] } });
    expect(testModel.scenarios.every((s) => s.evidence === undefined)).toBe(true);
  });
});

describe("the test designer reads only the normalized model (FR-030)", () => {
  it("imports nothing from the input layer", () => {
    const root = path.resolve(__dirname, "../../../src/testDesign");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = path.join(dir, entry);
        return statSync(full).isDirectory() ? files(full) : full.endsWith(".ts") ? [full] : [];
      });
    for (const file of files(root)) {
      const source = readFileSync(file, "utf-8");
      expect(source, path.relative(root, file)).not.toMatch(/from\s+["'][^"']*apiInput[^"']*["']/);
      expect(source, path.relative(root, file)).not.toMatch(/from\s+["'][^"']*openapi\/(parseYaml|validateSpec)["']/);
    }
  });
});
