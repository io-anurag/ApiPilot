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
});
