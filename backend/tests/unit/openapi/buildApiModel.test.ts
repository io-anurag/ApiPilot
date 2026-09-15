import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildApiModel } from "../../../src/openapi/buildApiModel";
import { validateSpec } from "../../../src/openapi/validateSpec";

const fixturesDir = path.join(__dirname, "..", "..", "fixtures", "openapi");
const loadFixture = (name: string) => yaml.load(readFileSync(path.join(fixturesDir, name), "utf-8"));

describe("buildApiModel", () => {
  it("extracts parameters, request bodies, responses and security for every operation", async () => {
    const raw = loadFixture("valid.yaml");
    const { document, issues } = await validateSpec(raw);

    const model = buildApiModel(document, issues);

    expect(model.summary.operationCount).toBe(3);
    expect(model.summary.securitySchemeCount).toBe(1);
    expect(model.info).toEqual({ title: "Pet Store", version: "1.0.0" });
    expect(model.securitySchemes.ApiKeyAuth).toEqual({
      type: "apiKey",
      scheme: undefined,
      in: "header",
      name: "X-API-Key",
    });

    const listPets = model.operations.find((op) => op.operationId === "listPets");
    expect(listPets).toBeDefined();
    expect(listPets?.parameters).toEqual([
      { name: "limit", location: "query", required: false, schema: expect.objectContaining({ type: "integer" }) },
    ]);
    // Operation-level `security: []` explicitly overrides the global requirement.
    expect(listPets?.security).toEqual([]);

    const createPet = model.operations.find((op) => op.operationId === "createPet");
    expect(createPet?.requestBody?.required).toBe(true);
    expect(createPet?.requestBody?.contentTypes["application/json"].required).toEqual(["id", "name"]);
    // No operation-level override: inherits the document-level security requirement.
    expect(createPet?.security).toEqual([{ schemes: [{ name: "ApiKeyAuth", scopes: [] }] }]);

    const getPet = model.operations.find((op) => op.operationId === "getPet");
    expect(getPet?.parameters).toEqual([
      { name: "petId", location: "path", required: true, schema: expect.objectContaining({ type: "string" }) },
    ]);
    expect(getPet?.responses.map((r) => r.statusCode).sort()).toEqual(["200", "404"]);
  });

  it("flags duplicate operationId and path+method combinations without rejecting the upload", async () => {
    const raw = loadFixture("duplicate-operation-id.yaml");
    const { document, issues } = await validateSpec(raw);

    const model = buildApiModel(document, issues);

    expect(model.operations).toHaveLength(2);
    expect(model.summary.issues.some((issue) => issue.kind === "duplicate-operation")).toBe(true);
  });

  it("extracts minLength/maxLength/minItems/maxItems boundary constraints", async () => {
    const raw = loadFixture("valid.yaml");
    const { document, issues } = await validateSpec(raw);

    const model = buildApiModel(document, issues);

    const createPet = model.operations.find((op) => op.operationId === "createPet");
    const petSchema = createPet?.requestBody?.contentTypes["application/json"];
    expect(petSchema?.properties.name).toEqual(expect.objectContaining({ minLength: 1, maxLength: 100 }));
    expect(petSchema?.properties.photoUrls).toEqual(expect.objectContaining({ minItems: 1, maxItems: 5 }));
  });

  it("leaves info undefined rather than fabricating a title when the document declares none", () => {
    const model = buildApiModel({ paths: {} }, []);
    expect(model.info).toBeUndefined();
  });

  it("leaves info undefined when info.title is present but blank", () => {
    const model = buildApiModel({ info: { title: "   " }, paths: {} }, []);
    expect(model.info).toBeUndefined();
  });

  describe("style/explode/contentEncoded extraction (specs/022-openapi-parameter-serialization)", () => {
    function operationWith(parameters: unknown[]) {
      return buildApiModel(
        { paths: { "/things": { get: { operationId: "listThings", parameters } } } },
        [],
      );
    }

    it("copies a declared style and explode verbatim", () => {
      const model = operationWith([
        { name: "sort", in: "query", schema: { type: "array" }, style: "spaceDelimited", explode: false },
      ]);
      expect(model.operations[0].parameters[0]).toEqual(
        expect.objectContaining({ style: "spaceDelimited", explode: false }),
      );
    });

    it("leaves style and explode undefined when the specification omits them, rather than persisting a fabricated default", () => {
      const model = operationWith([{ name: "sort", in: "query", schema: { type: "array" } }]);
      const parameter = model.operations[0].parameters[0];
      expect(parameter.style).toBeUndefined();
      expect(parameter.explode).toBeUndefined();
    });

    it("marks a parameter declaring content instead of schema as contentEncoded", () => {
      const model = operationWith([
        { name: "filter", in: "query", content: { "application/json": { schema: { type: "object" } } } },
      ]);
      expect(model.operations[0].parameters[0].contentEncoded).toBe(true);
    });

    it("leaves contentEncoded undefined for an ordinary schema-based parameter", () => {
      const model = operationWith([{ name: "sort", in: "query", schema: { type: "array" } }]);
      expect(model.operations[0].parameters[0].contentEncoded).toBeUndefined();
    });

    it("ignores a non-string style and a non-boolean explode rather than fabricating a coerced value", () => {
      const model = operationWith([
        { name: "sort", in: "query", schema: { type: "array" }, style: 123, explode: "yes" },
      ]);
      const parameter = model.operations[0].parameters[0];
      expect(parameter.style).toBeUndefined();
      expect(parameter.explode).toBeUndefined();
    });
  });
});
