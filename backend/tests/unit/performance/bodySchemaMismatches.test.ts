import { describe, expect, it } from "vitest";
import type { SchemaConstraint } from "@apipilot/shared-domain";
import { bodySchemaMismatches } from "../../../src/performance/plan/bodySchemaMismatches";
import { primaryRequestBodySchema } from "../../../src/testDesign/requestHelpers";
import { loadBodyEditsApiModel } from "../../fixtures/performance/specification";

/** AP-033 FR-005 (specs/033-edit-step-request-body research R7, tasks T017). */

async function ordersSchema(): Promise<SchemaConstraint> {
  const apiModel = await loadBodyEditsApiModel();
  const operation = apiModel.operations.find((candidate) => candidate.method.toUpperCase() === "POST" && candidate.path === "/orders")!;
  return primaryRequestBodySchema(operation)!;
}

const VALID = { quantity: 1, status: "new", customerEmail: "a@example.com", shipping: { city: "Pune" }, items: [{ sku: "SKU-1" }] };

function schema(overrides: Partial<SchemaConstraint>): SchemaConstraint {
  return { required: [], properties: {}, ...overrides };
}

describe("bodySchemaMismatches", () => {
  it("reports nothing for a body that matches the schema", async () => {
    expect(bodySchemaMismatches(await ordersSchema(), VALID)).toEqual([]);
  });

  it("reports missing required properties, nested ones included", async () => {
    const result = bodySchemaMismatches(await ordersSchema(), { ...VALID, quantity: undefined, shipping: {} });
    expect(result).toEqual([
      { fieldPath: "quantity", rule: "required", message: "`quantity` is required by the specification and missing." },
      { fieldPath: "shipping.city", rule: "required", message: "`shipping.city` is required by the specification and missing." },
    ]);
  });

  it("reports a wrong type, an enum miss and a format miss", async () => {
    const result = bodySchemaMismatches(await ordersSchema(), { ...VALID, quantity: "3", status: "unknown", customerEmail: "not-an-email" });
    expect(result.map((mismatch) => [mismatch.fieldPath, mismatch.rule])).toEqual([
      ["customerEmail", "format"],
      ["quantity", "type"],
      ["status", "enum"],
    ]);
    expect(result.find((mismatch) => mismatch.rule === "type")?.message).toBe("`quantity` should be an integer, not a string.");
  });

  it("reports numeric, string and array bounds, and walks array items", async () => {
    const result = bodySchemaMismatches(await ordersSchema(), {
      ...VALID,
      quantity: 0,
      items: [{ sku: "ok" }, { sku: "THIS-SKU-IS-TOO-LONG" }, { sku: "a" }, { sku: "b" }],
    });
    expect(result.map((mismatch) => [mismatch.fieldPath, mismatch.rule])).toEqual([
      ["items", "maxItems"],
      ["items[1].sku", "maxLength"],
      ["quantity", "minimum"],
    ]);
  });

  it("never reports a value that is exactly one {{name}} reference", async () => {
    expect(bodySchemaMismatches(await ordersSchema(), { ...VALID, quantity: "{{qty}}", customerEmail: "{{email}}" })).toEqual([]);
  });

  it("reports a top-level type that differs from the schema at the root", async () => {
    expect(bodySchemaMismatches(await ordersSchema(), 3)).toEqual([
      { fieldPath: "", rule: "type", message: "The body should be an object, not an integer." },
    ]);
  });

  it("never evaluates a pattern from the specification", async () => {
    // An invalid regular expression would throw if it were ever compiled.
    const withPattern = schema({ type: "object", properties: { note: schema({ type: "string", pattern: "(" }) } });
    expect(bodySchemaMismatches(withPattern, { note: "anything" })).toEqual([]);
  });

  it("stops at the traversal depth limit", () => {
    let nested: SchemaConstraint = schema({ type: "string", minLength: 5 });
    let value: unknown = "x";
    for (let level = 0; level < 60; level += 1) {
      nested = schema({ type: "object", properties: { child: nested } });
      value = { child: value };
    }
    expect(bodySchemaMismatches(nested, value)).toEqual([]);
  });
});
