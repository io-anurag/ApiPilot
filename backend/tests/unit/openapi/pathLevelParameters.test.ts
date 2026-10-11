import { describe, expect, it } from "vitest";
import { buildApiModel } from "../../../src/openapi/buildApiModel";

/** Minimal dereferenced document; buildApiModel reads only plain objects. */
function documentWith(pathItem: Record<string, unknown>): Record<string, unknown> {
  return { openapi: "3.0.3", info: { title: "T", version: "1" }, paths: { "/things/{id}": pathItem } };
}

const ok = { responses: { "200": { description: "ok" } } };

describe("buildApiModel path-level parameters (AP-046 R5)", () => {
  it("includes path-level parameters in every operation of the path item", () => {
    const model = buildApiModel(
      documentWith({
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        get: ok,
        delete: ok,
      }),
      [],
    );
    for (const op of model.operations) {
      expect(op.parameters.map((p) => `${p.location}:${p.name}`)).toEqual(["path:id"]);
    }
  });

  it("lets an operation-level declaration override a path-level one with the same name and location", () => {
    const model = buildApiModel(
      documentWith({
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "trace", in: "header", schema: { type: "string" } },
        ],
        get: { ...ok, parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }] },
      }),
      [],
    );
    const params = model.operations[0].parameters;
    expect(params).toHaveLength(2);
    const id = params.find((p) => p.name === "id");
    expect(id?.schema.type).toBe("integer");
    expect(params.find((p) => p.name === "trace")?.location).toBe("header");
  });

  it("treats the same name in a different location as a distinct parameter", () => {
    const model = buildApiModel(
      documentWith({
        parameters: [{ name: "v", in: "query", schema: { type: "string" } }],
        get: { ...ok, parameters: [{ name: "v", in: "header", schema: { type: "string" } }] },
      }),
      [],
    );
    expect(model.operations[0].parameters.map((p) => `${p.location}:${p.name}`).sort()).toEqual([
      "header:v",
      "query:v",
    ]);
  });

  it("leaves operations unchanged when the path item declares no parameters", () => {
    const model = buildApiModel(
      documentWith({ get: { ...ok, parameters: [{ name: "q", in: "query", schema: { type: "string" } }] } }),
      [],
    );
    expect(model.operations[0].parameters).toEqual([
      { name: "q", location: "query", required: false, schema: expect.objectContaining({ type: "string" }) },
    ]);
  });
});
