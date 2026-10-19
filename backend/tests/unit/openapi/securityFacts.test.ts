import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildApiModel } from "../../../src/openapi/buildApiModel";
import { parseYaml } from "../../../src/openapi/parseYaml";
import { validateSpec } from "../../../src/openapi/validateSpec";

/** specs/057 research R2: the additive security facts the OpenAPI builder now records. */

const ok = { "200": { description: "ok" } };

function build(document: Record<string, unknown>) {
  return buildApiModel({ openapi: "3.0.3", info: { title: "t", version: "1" }, paths: {}, ...document }, []);
}

function operationOf(model: ReturnType<typeof build>, key: string) {
  const found = model.operations.find((operation) => `${operation.method} ${operation.path}` === key);
  if (!found) throw new Error(`no operation ${key}`);
  return found;
}

describe("securitySource and root security", () => {
  const document = {
    security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" }, key: { type: "apiKey", in: "header", name: "X" } } },
    paths: {
      "/inherits": { get: { responses: ok } },
      "/overrides": { get: { security: [{ key: [] }], responses: ok } },
      "/public": { get: { security: [], responses: ok } },
    },
  };

  it("marks an inherited requirement as `root`, with the root recorded as written", () => {
    const model = build(document);
    const op = operationOf(model, "GET /inherits");
    expect(op.securitySource).toBe("root");
    expect(op.security).toEqual([{ schemes: [{ name: "bearerAuth", scopes: [] }] }]);
    expect(model.rootSecurityDeclared).toBe(true);
    expect(model.rootSecurity).toEqual([{ schemes: [{ name: "bearerAuth", scopes: [] }] }]);
  });

  it("marks an operation's own non-empty requirement as `operation` and keeps it", () => {
    const op = operationOf(build(document), "GET /overrides");
    expect(op.securitySource).toBe("operation");
    expect(op.security).toEqual([{ schemes: [{ name: "key", scopes: [] }] }]);
  });

  it("marks an own empty requirement as `explicit-public`", () => {
    const op = operationOf(build(document), "GET /public");
    expect(op.securitySource).toBe("explicit-public");
    expect(op.security).toEqual([]);
  });

  it("marks nothing declared anywhere as `none-declared` and omits `rootSecurity`", () => {
    const model = build({ paths: { "/x": { get: { responses: ok } } } });
    expect(operationOf(model, "GET /x").securitySource).toBe("none-declared");
    expect(model.rootSecurityDeclared).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(model, "rootSecurity")).toBe(false);
  });

  it("records a root `security: []` as declared and empty, leaving inheriting operations `none-declared`", () => {
    const model = build({ security: [], paths: { "/x": { get: { responses: ok } } } });
    expect(model.rootSecurityDeclared).toBe(true);
    expect(model.rootSecurity).toEqual([]);
    expect(operationOf(model, "GET /x").securitySource).toBe("none-declared");
  });

  it("keeps the anonymous alternative `{}` inside a requirement list", () => {
    const model = build({ security: [{ bearerAuth: [] }, {}], paths: { "/x": { get: { responses: ok } } } });
    expect(operationOf(model, "GET /x").security).toEqual([
      { schemes: [{ name: "bearerAuth", scopes: [] }] },
      { schemes: [] },
    ]);
  });

  it("does not change `security` for any case (effective requirement is exactly as before)", () => {
    const model = build(document);
    expect(operationOf(model, "GET /inherits").security).toEqual(model.rootSecurity);
  });
});

describe("deprecated, property flags and scheme details", () => {
  it("records `deprecated` only when the specification sets a boolean", () => {
    const model = build({
      paths: {
        "/a": { get: { deprecated: true, responses: ok } },
        "/b": { get: { deprecated: false, responses: ok } },
        "/c": { get: { responses: ok } },
      },
    });
    expect(operationOf(model, "GET /a").deprecated).toBe(true);
    expect(operationOf(model, "GET /b").deprecated).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(operationOf(model, "GET /c"), "deprecated")).toBe(false);
  });

  it("carries `readOnly` and `writeOnly` on property constraints, never defaulted", () => {
    const model = build({
      paths: {
        "/o": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "string", readOnly: true },
                      secret: { type: "string", writeOnly: true },
                      plain: { type: "string" },
                    },
                  },
                },
              },
            },
            responses: ok,
          },
        },
      },
    });
    const schema = Object.values(operationOf(model, "POST /o").requestBody?.contentTypes ?? {})[0];
    expect(schema?.properties.id?.readOnly).toBe(true);
    expect(schema?.properties.secret?.writeOnly).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(schema?.properties.plain, "readOnly")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(schema?.properties.plain, "writeOnly")).toBe(false);
  });

  it("folds a flag in from an allOf branch without adding an undefined key elsewhere", () => {
    const model = build({
      paths: {
        "/o": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      composed: { allOf: [{ type: "string", readOnly: true }, { minLength: 1 }] },
                      other: { allOf: [{ type: "string" }] },
                    },
                  },
                },
              },
            },
            responses: ok,
          },
        },
      },
    });
    const schema = Object.values(operationOf(model, "POST /o").requestBody?.contentTypes ?? {})[0];
    expect(schema?.properties.composed?.readOnly).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(schema?.properties.other, "readOnly")).toBe(false);
  });

  it("records `bearerFormat` and `openIdConnectUrl` only when declared, and fetches nothing", () => {
    const model = build({
      components: {
        securitySchemes: {
          jwt: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
          plain: { type: "http", scheme: "bearer" },
          oidc: { type: "openIdConnect", openIdConnectUrl: "https://idp.example.test/.well-known/openid-configuration" },
        },
      },
    });
    expect(model.securitySchemes.jwt?.bearerFormat).toBe("JWT");
    expect(Object.prototype.hasOwnProperty.call(model.securitySchemes.plain, "bearerFormat")).toBe(false);
    expect(model.securitySchemes.oidc?.openIdConnectUrl).toBe("https://idp.example.test/.well-known/openid-configuration");
    expect(Object.prototype.hasOwnProperty.call(model.securitySchemes.plain, "openIdConnectUrl")).toBe(false);
  });
});

describe("YAML and JSON twins give equivalent models", () => {
  it("builds deeply equal models from sample-api.yaml and sample-api.json", async () => {
    const dir = path.resolve(__dirname, "../../fixtures/securityLab");
    const load = async (file: string) => {
      const raw = parseYaml(readFileSync(path.join(dir, file), "utf-8"));
      const { document, issues } = await validateSpec(raw);
      return buildApiModel(document, issues);
    };
    expect(await load("sample-api.json")).toEqual(await load("sample-api.yaml"));
  });
});
