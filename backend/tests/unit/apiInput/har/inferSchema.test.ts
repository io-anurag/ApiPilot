import { describe, expect, it } from "vitest";
import { SchemaInferrer } from "../../../../src/apiInput/har/inferSchema";

function infer(...bodies: unknown[]) {
  const inferrer = new SchemaInferrer();
  for (const body of bodies) inferrer.add(body);
  return inferrer.build();
}

describe("SchemaInferrer: structure only (FR-015)", () => {
  it("infers type, properties and items and nothing else", () => {
    const { schema } = infer({ id: "a", count: 3, price: 1.5, tags: ["x", "y"], ok: true, meta: { n: 1 } });
    expect(schema).toEqual({
      type: "object",
      required: ["id", "count", "price", "tags", "ok", "meta"],
      properties: {
        id: { type: "string", required: [], properties: {} },
        count: { type: "integer", required: [], properties: {} },
        price: { type: "number", required: [], properties: {} },
        tags: { type: "array", required: [], properties: {}, items: { type: "string", required: [], properties: {} } },
        ok: { type: "boolean", required: [], properties: {} },
        meta: { type: "object", required: ["n"], properties: { n: { type: "integer", required: [], properties: {} } } },
      },
    });
  });

  it("never infers an enum, format, range, pattern, length or item count from values that were seen", () => {
    const { schema } = infer({ email: "ada@example.test", when: "2026-01-01T00:00:00Z", qty: 5, code: "ABC", list: [1, 2, 3] });
    const text = JSON.stringify(schema);
    for (const keyword of ["enum", "format", "minimum", "maximum", "pattern", "minLength", "maxLength", "minItems", "maxItems"]) {
      expect(text, keyword).not.toContain(`"${keyword}"`);
    }
  });

  it("marks a field required only when every observation carries it", () => {
    const { schema, evidence } = infer({ id: 1, note: "a" }, { id: 2 }, { id: 3, note: "c" });
    expect(schema.required).toEqual(["id"]);
    expect(evidence.observations).toBe(3);
    expect(evidence.fields.id).toEqual({ presentIn: 3, types: { integer: 3 } });
    expect(evidence.fields.note).toEqual({ presentIn: 2, types: { string: 2 } });
  });

  it("treats integer and float observations of one field as a number", () => {
    const { schema, conflicts } = infer({ v: 1 }, { v: 2.5 });
    expect(schema.properties.v.type).toBe("number");
    expect(conflicts).toEqual([]);
  });

  it("does not call a field that is sometimes null a conflict", () => {
    const { schema, conflicts, evidence } = infer({ v: "a" }, { v: null });
    expect(schema.properties.v.type).toBe("string");
    expect(conflicts).toEqual([]);
    expect(evidence.fields.v.types).toEqual({ string: 1, null: 1 });
  });

  it("reports conflicting types by field path, without a value, and infers no type for them", () => {
    const { schema, conflicts } = infer({ count: 1, nested: { flag: true } }, { count: "two", nested: { flag: "yes" } });
    expect(conflicts).toEqual(["count", "nested.flag"]);
    expect(schema.properties.count).toEqual({ required: [], properties: {} });
    expect(JSON.stringify(conflicts)).not.toContain("two");
  });

  it("merges the elements of arrays across observations and records element evidence", () => {
    const { schema, evidence } = infer({ items: [{ id: 1 }, { id: 2, label: "x" }] }, { items: [{ id: 3 }] });
    expect(schema.properties.items.items?.required).toEqual(["id"]);
    expect(Object.keys(schema.properties.items.items?.properties ?? {})).toEqual(["id", "label"]);
    expect(evidence.fields["items[].id"].presentIn).toBe(3);
    expect(evidence.fields["items[].label"].presentIn).toBe(1);
  });

  it("handles a root array and scalar roots", () => {
    expect(infer([{ a: 1 }, { a: 2 }]).schema.type).toBe("array");
    expect(infer("x", "y").schema.type).toBe("string");
    expect(infer(null).schema).toEqual({ required: [], properties: {} });
  });

  it("is safe against a __proto__ key and does not pollute prototypes", () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":true},"ok":1}');
    const { schema } = infer(hostile);
    expect(Object.keys(schema.properties)).toEqual(["ok"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("keeps the schema separate for each inferrer, so statuses are never merged", () => {
    const ok = infer({ id: 1 });
    const notFound = infer({ error: "missing" });
    expect(Object.keys(ok.schema.properties)).toEqual(["id"]);
    expect(Object.keys(notFound.schema.properties)).toEqual(["error"]);
  });

  it("is deterministic", () => {
    const bodies = [{ a: 1, b: { c: [1, 2] } }, { a: 2, b: { c: [3] }, d: null }];
    expect(JSON.stringify(infer(...bodies))).toBe(JSON.stringify(infer(...bodies)));
  });

  it("flags truncation instead of growing without bound", () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 3000; i += 1) wide[`f${i}`] = i;
    const result = infer(wide);
    expect(result.truncated).toBe(true);
    expect(Object.keys(result.schema.properties).length).toBeLessThan(3000);
  });
});
