import type { ApiModel } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { extractOperationElements, notMeasurableFromIssues, operationKeyOfLocation } from "../../../src/apiCoverage/elements";
import { ordersApiModel } from "../../fixtures/apiCoverage/coverageFixtures";

const op = (method: string, path: string) => {
  const found = ordersApiModel.operations.find((o) => o.method === method && o.path === path);
  if (!found) throw new Error("missing operation");
  return found;
};

describe("extractOperationElements", () => {
  it("keeps the same path with different methods as separate operations with separate ids", () => {
    const get = extractOperationElements(op("GET", "/orders/{id}"));
    const del = extractOperationElements(op("DELETE", "/orders/{id}"));
    expect(get.operationKey).toBe("GET /orders/{id}");
    expect(del.operationKey).toBe("DELETE /orders/{id}");
    const ids = new Set([...get.ids, ...del.ids]);
    expect(ids.size).toBe(get.ids.size + del.ids.size);
  });

  it("emits one element per documented response and one schema element only where a schema is declared", () => {
    const elements = extractOperationElements(op("GET", "/orders/{id}"));
    expect(elements.ids.has("resp:GET /orders/{id}:200")).toBe(true);
    expect(elements.ids.has("resp:GET /orders/{id}:404")).toBe(true);
    expect(elements.ids.has("resp:GET /orders/{id}:default")).toBe(true);
    expect(elements.ids.has("respschema:GET /orders/{id}:200")).toBe(true);
    expect(elements.ids.has("respschema:GET /orders/{id}:404")).toBe(false);
  });

  it("derives required, type, enum, format and boundary cases from declared constraints only", () => {
    const { ids } = extractOperationElements(op("POST", "/orders"));
    const f = (field: string, suffix: string) => ids.has(`reqprop:POST /orders:${field}#${suffix}`);
    expect(f("sku", "required")).toBe(true);
    expect(f("sku", "format")).toBe(true);
    expect(f("notes", "required")).toBe(false);
    expect(f("status", "enum:\"new\"")).toBe(true);
    expect(f("status", "enum:\"paid\"")).toBe(true);
    expect(f("status", "enum-invalid")).toBe(true);
    expect(f("quantity", "boundary:numeric-boundary-below-minimum")).toBe(true);
    expect(f("quantity", "boundary:numeric-boundary-above-maximum")).toBe(true);
    expect(f("notes", "boundary:string-boundary-above-maximum")).toBe(true);
    expect(f("notes", "boundary:string-boundary-below-minimum")).toBe(false);
    expect(f("sku", "boundary:numeric-boundary-below-minimum")).toBe(false);
  });

  it("does not treat a path parameter as omittable", () => {
    const { ids } = extractOperationElements(op("GET", "/orders/{id}"));
    expect(ids.has("param:GET /orders/{id}:path:id")).toBe(true);
    expect(ids.has("param:GET /orders/{id}:path:id#required")).toBe(false);
    expect(ids.has("param:GET /orders/{id}:path:id#type")).toBe(true);
  });

  it("lists cookie parameters as not measurable instead of counting them", () => {
    const elements = extractOperationElements(op("GET", "/orders"));
    expect(elements.requirements.some((r) => r.id.includes("cookie"))).toBe(false);
    expect(elements.notMeasurable).toEqual([
      expect.objectContaining({ kind: "parameter", reason: expect.stringContaining("cookie") }),
    ]);
  });

  it("assigns every requirement one category group and has no scenario-category requirements", () => {
    const noConstraints = extractOperationElements(op("DELETE", "/orders/{id}"));
    expect([...noConstraints.ids].some((id) => id.startsWith("cat:"))).toBe(false);
    expect(noConstraints.requirements.some((r) => r.group === "boundary")).toBe(false);
    expect(noConstraints.groups.has("boundary")).toBe(false);
    const constrained = extractOperationElements(op("POST", "/orders"));
    expect(constrained.requirements.some((r) => r.group === "boundary")).toBe(true);
    expect(constrained.requirements.some((r) => r.group === "negative")).toBe(true);
    expect(constrained.requirements.find((r) => r.id === "op:POST /orders")).toMatchObject({ group: "positive", source: "#/paths/~1orders/post" });
  });

  it("classifies response keys: exact 2xx positive, exact 4xx negative, everything else unclassified (D-6)", () => {
    const elements = extractOperationElements(op("GET", "/orders/{id}"));
    const group = (id: string) => elements.requirements.find((r) => r.id === id)?.group;
    expect(group("resp:GET /orders/{id}:200")).toBe("positive");
    expect(group("resp:GET /orders/{id}:404")).toBe("negative");
    expect(group("resp:GET /orders/{id}:default")).toBe("unclassified");
    expect(group("respschema:GET /orders/{id}:200")).toBe("positive");
  });

  it("lists array item constraints as not measurable", () => {
    const model: ApiModel = structuredClone(ordersApiModel);
    const body = model.operations[0].requestBody?.contentTypes["application/json"];
    if (!body) throw new Error("missing body");
    body.properties.tags = {
      type: "array",
      required: [],
      properties: {},
      items: { type: "string", required: [], properties: {}, enum: ["a", "b"] },
    };
    const elements = extractOperationElements(model.operations[0]);
    expect(elements.notMeasurable.some((n) => n.reason.includes("Array item"))).toBe(true);
  });

  it("gives every requirement a stable id and contract hash", () => {
    const a = extractOperationElements(op("POST", "/orders"));
    const b = extractOperationElements(op("POST", "/orders"));
    expect(a.requirements.map((r) => [r.id, r.contractHash])).toEqual(b.requirements.map((r) => [r.id, r.contractHash]));
  });
});

describe("notMeasurableFromIssues", () => {
  const model: ApiModel = {
    ...ordersApiModel,
    summary: {
      ...ordersApiModel.summary,
      issues: [
        { kind: "unsupported-construct", location: "#/paths//orders/post/requestBody", message: "oneOf is not supported" },
        { kind: "circular-ref", location: "#/components/schemas/Node", message: "circular" },
        { kind: "composed-schema", location: "#/paths//orders/get", message: "allOf merged" },
        { kind: "unsupported-construct", location: "#/paths//hidden/get", message: "callbacks" },
      ],
    },
  };

  it("lists unsupported and unresolved constructs, skipping informational and out-of-scope ones", () => {
    const entries = notMeasurableFromIssues(model, new Set(["POST /orders"]));
    expect(entries.map((e) => e.reason)).toEqual(["oneOf is not supported", "circular"]);
    expect(entries[0].operationKey).toBe("POST /orders");
    expect(entries[1].operationKey).toBeUndefined();
  });

  it("attributes a location to its operation", () => {
    expect(operationKeyOfLocation("#/paths//orders/{id}/delete/responses")).toBe("DELETE /orders/{id}");
    expect(operationKeyOfLocation("#/components/schemas/X")).toBeUndefined();
  });
});
