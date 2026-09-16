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

  describe("allOf composition", () => {
    function documentWithBodySchema(schema: unknown): Record<string, unknown> {
      return {
        openapi: "3.0.1",
        info: { title: "Composed", version: "1.0.0" },
        paths: {
          "/widgets": {
            post: {
              operationId: "createWidget",
              requestBody: {
                required: true,
                content: { "application/json": { schema } },
              },
              responses: { "200": { description: "OK" } },
            },
          },
        },
      };
    }

    const composedSchema = {
      allOf: [
        { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        {
          type: "object",
          required: ["quantity"],
          properties: { quantity: { type: "integer", minimum: 1 } },
        },
      ],
    };

    it("merges every allOf branch's properties and required fields into one constraint", () => {
      const model = buildApiModel(documentWithBodySchema(composedSchema), []);
      const operation = model.operations.find((op) => op.operationId === "createWidget");
      const schema = operation?.requestBody?.contentTypes["application/json"];

      expect(schema?.required).toEqual(["id", "quantity"]);
      expect(schema?.properties.id).toEqual(expect.objectContaining({ type: "string" }));
      expect(schema?.properties.quantity).toEqual(expect.objectContaining({ type: "integer", minimum: 1 }));
    });

    it("records a composed-schema issue rather than an unsupported-construct issue for allOf", () => {
      const model = buildApiModel(documentWithBodySchema(composedSchema), []);

      expect(model.summary.issues).toEqual([
        expect.objectContaining({
          kind: "composed-schema",
          location: "#/paths//widgets/post/requestBody/content/application/json/schema",
        }),
      ]);
      expect(model.summary.issues.some((issue) => issue.kind === "unsupported-construct")).toBe(false);
    });

    it("still reports oneOf as an unsupported construct (branch ambiguity is not merged)", () => {
      const model = buildApiModel(
        documentWithBodySchema({ oneOf: [{ type: "object" }, { type: "string" }] }),
        [],
      );

      expect(model.summary.issues).toEqual([
        expect.objectContaining({ kind: "unsupported-construct" }),
      ]);
      const operation = model.operations.find((op) => op.operationId === "createWidget");
      expect(operation?.requestBody?.contentTypes["application/json"]).toEqual({
        required: [],
        properties: {},
      });
    });

    it("keeps the composing node's own declared field over a same-named allOf branch field", () => {
      const model = buildApiModel(
        documentWithBodySchema({
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 5 } },
          allOf: [{ type: "object", properties: { id: { type: "string", minLength: 1 } } }],
        }),
        [],
      );
      const operation = model.operations.find((op) => op.operationId === "createWidget");
      const schema = operation?.requestBody?.contentTypes["application/json"];

      // The node's own "id" (minLength: 5) wins over the branch's "id" (minLength: 1).
      expect(schema?.properties.id).toEqual(expect.objectContaining({ minLength: 5 }));
    });
  });

  describe("OAuth2 clientCredentials flow extraction (specs/024-oauth2-client-credentials-auth)", () => {
    function documentWithScheme(scheme: unknown): Record<string, unknown> {
      return {
        openapi: "3.0.1",
        info: { title: "OAuth2", version: "1.0.0" },
        paths: {},
        components: { securitySchemes: { Oauth2: scheme } },
      };
    }

    it("extracts tokenUrl and scope identifiers verbatim, in declaration order", () => {
      const model = buildApiModel(
        documentWithScheme({
          type: "oauth2",
          flows: {
            clientCredentials: {
              tokenUrl: "/v1/oauth2/token",
              scopes: { read: "Read access", write: "Write access" },
            },
          },
        }),
        [],
      );

      expect(model.securitySchemes.Oauth2.flows).toEqual({
        clientCredentials: { tokenUrl: "/v1/oauth2/token", scopes: ["read", "write"] },
      });
    });

    it("yields an empty scopes array, not a missing/error case, when clientCredentials declares no scopes", () => {
      const model = buildApiModel(
        documentWithScheme({
          type: "oauth2",
          flows: { clientCredentials: { tokenUrl: "/oauth2/token", scopes: {} } },
        }),
        [],
      );
      expect(model.securitySchemes.Oauth2.flows).toEqual({
        clientCredentials: { tokenUrl: "/oauth2/token", scopes: [] },
      });
    });

    it("omits flows entirely for an oauth2 scheme whose only declared flow is authorizationCode", () => {
      const model = buildApiModel(
        documentWithScheme({
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: "/authorize",
              tokenUrl: "/token",
              scopes: { read: "Read access" },
            },
          },
        }),
        [],
      );
      expect(model.securitySchemes.Oauth2.flows).toBeUndefined();
    });

    it("omits flows entirely for an oauth2 scheme whose only declared flow is password", () => {
      const model = buildApiModel(
        documentWithScheme({
          type: "oauth2",
          flows: { password: { tokenUrl: "/token", scopes: {} } },
        }),
        [],
      );
      expect(model.securitySchemes.Oauth2.flows).toBeUndefined();
    });

    it("omits flows entirely for an oauth2 scheme declaring no flows object at all", () => {
      const model = buildApiModel(documentWithScheme({ type: "oauth2" }), []);
      expect(model.securitySchemes.Oauth2.flows).toBeUndefined();
    });

    it("never fabricates a tokenUrl when clientCredentials declares a non-string one", () => {
      const model = buildApiModel(
        documentWithScheme({
          type: "oauth2",
          flows: { clientCredentials: { tokenUrl: 12345, scopes: {} } },
        }),
        [],
      );
      expect(model.securitySchemes.Oauth2.flows).toBeUndefined();
    });

    it("classifies both clientCredentials and authorizationCode on the same scheme as supported via clientCredentials", () => {
      const model = buildApiModel(
        documentWithScheme({
          type: "oauth2",
          flows: {
            clientCredentials: { tokenUrl: "/oauth2/token", scopes: { read: "Read access" } },
            authorizationCode: {
              authorizationUrl: "/authorize",
              tokenUrl: "/token",
              scopes: { read: "Read access" },
            },
          },
        }),
        [],
      );
      expect(model.securitySchemes.Oauth2.flows).toEqual({
        clientCredentials: { tokenUrl: "/oauth2/token", scopes: ["read"] },
      });
    });

    it("leaves a non-oauth2 scheme's flows field untouched (undefined)", () => {
      const model = buildApiModel(
        documentWithScheme({ type: "http", scheme: "bearer" }),
        [],
      );
      expect(model.securitySchemes.Oauth2.flows).toBeUndefined();
    });
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
