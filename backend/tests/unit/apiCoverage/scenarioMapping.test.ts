import type { TestScenario } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { extractOperationElements } from "../../../src/apiCoverage/elements";
import { mapScenario, scenarioGroup } from "../../../src/apiCoverage/scenarioMapping";
import { findScenario, ordersApiModel, ordersScenarios } from "../../fixtures/apiCoverage/coverageFixtures";

const scenarios = ordersScenarios();
const elementsFor = (method: string, path: string) => {
  const operation = ordersApiModel.operations.find((o) => o.method === method && o.path === path);
  if (!operation) throw new Error("missing operation");
  return extractOperationElements(operation);
};
const ids = (method: string, path: string, scenario: TestScenario) =>
  mapScenario(elementsFor(method, path), scenario).map((m) => m.requirementId);

describe("scenarioGroup", () => {
  it("derives the group from the rule, so at-boundary variants count as boundary", () => {
    expect(scenarioGroup(findScenario(scenarios, "POST", "/orders", "numeric-boundary-at-maximum", "quantity"))).toBe("boundary");
    expect(scenarioGroup(findScenario(scenarios, "POST", "/orders", "numeric-boundary-above-maximum", "quantity"))).toBe("boundary");
    expect(scenarioGroup(findScenario(scenarios, "POST", "/orders", "positive-scenario"))).toBe("positive");
    expect(scenarioGroup(findScenario(scenarios, "POST", "/orders", "enum-positive-variant", "status"))).toBe("positive");
    expect(scenarioGroup(findScenario(scenarios, "POST", "/orders", "required-field-missing", "sku"))).toBe("negative");
    expect(scenarioGroup(findScenario(scenarios, "POST", "/orders", "invalid-enum", "status"))).toBe("negative");
  });

  it("falls back to the category for AI scenarios", () => {
    const ai = { ...findScenario(scenarios, "POST", "/orders", "invalid-type", "sku"), provenance: { source: "AI" } } as unknown as TestScenario;
    expect(scenarioGroup(ai)).toBe("negative");
    expect(scenarioGroup({ ...ai, category: "positive" })).toBe("positive");
    expect(scenarioGroup({ ...ai, category: "numeric-boundary" })).toBe("boundary");
  });
});

describe("mapScenario", () => {
  it("maps a required-field scenario only to that field's required case, never to the happy path (D-3)", () => {
    const scenario = findScenario(scenarios, "POST", "/orders", "required-field-missing", "sku");
    const mapped = ids("POST", "/orders", scenario);
    expect(mapped).not.toContain("op:POST /orders");
    expect(mapped.some((id) => id.startsWith("cat:"))).toBe(false);
    expect(mapped).toContain("reqprop:POST /orders:sku#required");
    expect(mapped).not.toContain("reqprop:POST /orders:quantity#required");
    expect(mapped).not.toContain("reqprop:POST /orders:sku");
  });

  it("does not mark a field exercised merely because a negative scenario for another field carries its base value", () => {
    const scenario = findScenario(scenarios, "POST", "/orders", "required-field-missing", "sku");
    expect(ids("POST", "/orders", scenario)).not.toContain("reqprop:POST /orders:quantity");
    expect(ids("POST", "/orders", scenario).some((id) => id.includes("quantity#boundary"))).toBe(false);
  });

  it("maps the base positive scenario to every field it carries and to the first enum value", () => {
    const mapped = ids("POST", "/orders", findScenario(scenarios, "POST", "/orders", "positive-scenario"));
    for (const field of ["sku", "quantity", "status", "notes"]) expect(mapped).toContain(`reqprop:POST /orders:${field}`);
    expect(mapped).toContain('reqprop:POST /orders:status#enum:"new"');
    expect(mapped).not.toContain('reqprop:POST /orders:status#enum:"paid"');
  });

  it("maps the minimal positive scenario only to the fields it carries", () => {
    const mapped = ids("POST", "/orders", findScenario(scenarios, "POST", "/orders", "minimal-positive-scenario"));
    expect(mapped).toContain("reqprop:POST /orders:sku");
    expect(mapped).not.toContain("reqprop:POST /orders:notes");
  });

  it("maps an enum variant to the specific enum value it carries", () => {
    const mapped = ids("POST", "/orders", findScenario(scenarios, "POST", "/orders", "enum-positive-variant", "status"));
    expect(mapped).toContain('reqprop:POST /orders:status#enum:"paid"');
    expect(mapped).not.toContain('reqprop:POST /orders:status#enum:"new"');
  });

  it("matches boundary elements by the value carried, including at-boundary values the designer deduplicated", () => {
    const below = ids("POST", "/orders", findScenario(scenarios, "POST", "/orders", "numeric-boundary-below-minimum", "quantity"));
    expect(below).toContain("reqprop:POST /orders:quantity#boundary:numeric-boundary-below-minimum");
    // The at-minimum value (1) equals the baseline's value, so the baseline covers it.
    const base = ids("POST", "/orders", findScenario(scenarios, "POST", "/orders", "positive-scenario"));
    expect(base).toContain("reqprop:POST /orders:quantity#boundary:numeric-boundary-at-minimum");
  });

  it("maps status and schema assertions to the expected response code, with the matching check scope", () => {
    const mapped = mapScenario(elementsFor("POST", "/orders"), findScenario(scenarios, "POST", "/orders", "positive-scenario"));
    expect(mapped).toContainEqual({ requirementId: "resp:POST /orders:201", scope: "status-code", responseCode: "201" });
    expect(mapped).toContainEqual({ requirementId: "respschema:POST /orders:201", scope: "schema-conformance" });
    const negative = mapScenario(elementsFor("POST", "/orders"), findScenario(scenarios, "POST", "/orders", "invalid-type", "sku"));
    expect(negative.some((m) => m.requirementId === "resp:POST /orders:400")).toBe(true);
    expect(negative.some((m) => m.requirementId.startsWith("respschema:"))).toBe(false);
  });

  it("never maps a documented range or default to an arbitrary specific code", () => {
    const mapped = ids("GET", "/orders/{id}", findScenario(scenarios, "GET", "/orders/{id}", "invalid-type", "id"));
    expect(mapped).toContain("resp:GET /orders/{id}:404");
    expect(mapped).not.toContain("resp:GET /orders/{id}:default");
  });

  it("is deterministic and free of duplicates", () => {
    const scenario = findScenario(scenarios, "POST", "/orders", "positive-scenario");
    const a = mapScenario(elementsFor("POST", "/orders"), scenario);
    const b = mapScenario(elementsFor("POST", "/orders"), scenario);
    expect(a).toEqual(b);
    expect(new Set(a.map((m) => `${m.requirementId}|${m.scope}|${m.responseCode ?? ""}`)).size).toBe(a.length);
  });

  it("credits the happy path and exercised fields from positive scenarios only, with the status scope", () => {
    const happy = mapScenario(elementsFor("POST", "/orders"), findScenario(scenarios, "POST", "/orders", "positive-scenario"));
    expect(happy).toContainEqual({ requirementId: "op:POST /orders", scope: "status" });
    expect(happy).toContainEqual({ requirementId: "reqprop:POST /orders:sku", scope: "status" });
    const atBoundary = ids("POST", "/orders", findScenario(scenarios, "POST", "/orders", "numeric-boundary-at-maximum", "quantity"));
    expect(atBoundary).not.toContain("op:POST /orders");
    expect(atBoundary).not.toContain("reqprop:POST /orders:quantity");
    expect(atBoundary).toContain("reqprop:POST /orders:quantity#boundary:numeric-boundary-at-maximum");
  });

  it("lets a beyond-boundary scenario credit the documented 400 and its own boundary requirement, not the happy path", () => {
    const below = ids("POST", "/orders", findScenario(scenarios, "POST", "/orders", "numeric-boundary-below-minimum", "quantity"));
    expect(below).toContain("resp:POST /orders:400");
    expect(below).toContain("reqprop:POST /orders:quantity#boundary:numeric-boundary-below-minimum");
    expect(below).not.toContain("op:POST /orders");
  });

  it("credits response codes from scenarios of any group", () => {
    const negative = ids("POST", "/orders", findScenario(scenarios, "POST", "/orders", "invalid-type", "sku"));
    expect(negative).toContain("resp:POST /orders:400");
  });

  it("gives a scenario whose target cannot be determined no field-level credit and no happy-path credit", () => {
    const base = findScenario(scenarios, "POST", "/orders", "invalid-type", "sku");
    const untargeted = { ...base, targetField: undefined, targetLocation: undefined } as TestScenario;
    const mapped = ids("POST", "/orders", untargeted);
    expect(mapped).not.toContain("op:POST /orders");
    expect(mapped.some((id) => id.startsWith("reqprop:") || id.startsWith("param:"))).toBe(false);
  });
});
