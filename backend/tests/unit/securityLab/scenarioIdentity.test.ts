import { describe, expect, it } from "vitest";
import type { SecurityScenarioContent } from "@apipilot/shared-domain";
import {
  MATERIAL_FIELDS,
  contentHashOf,
  dedupeKeyOf,
  isMaterialChange,
  materialFieldsOf,
  scenarioIdOf,
} from "../../../src/securityLab/scenarios/scenarioIdentity";
import { makeContent } from "../../fixtures/securityLab/builders";

describe("scenario id", () => {
  it("is derived from the operation, the category and the mutations, with no random or time component", () => {
    const a = scenarioIdOf({ operationKey: "GET /orders", categoryId: "authentication", mutations: [{ kind: "auth.omit" }] });
    const b = scenarioIdOf({ operationKey: "GET /orders", categoryId: "authentication", mutations: [{ kind: "auth.omit" }] });
    expect(a).toBe(b);
    expect(a).toMatch(/^ss-[0-9a-f]{16}$/);
  });

  it("differs for a different operation, category, mutation kind or mutation parameter", () => {
    const base = { operationKey: "GET /orders", categoryId: "authentication", mutations: [{ kind: "auth.omit" }] } as const;
    const ids = new Set([
      scenarioIdOf(base),
      scenarioIdOf({ ...base, operationKey: "GET /items" }),
      scenarioIdOf({ ...base, categoryId: "input-validation" }),
      scenarioIdOf({ ...base, mutations: [{ kind: "auth.malformed" }] }),
      scenarioIdOf({ ...base, mutations: [{ kind: "auth.expired", identity: "any" }] }),
      scenarioIdOf({ ...base, mutations: [{ kind: "auth.expired", identity: "other" }] }),
    ]);
    expect(ids.size).toBe(6);
  });

  it("does not depend on the key order inside a mutation", () => {
    const a = scenarioIdOf({ operationKey: "x", categoryId: "input-validation", mutations: [{ kind: "field.violate-constraint", path: "body:a", constraint: "type" }] });
    const b = scenarioIdOf({ operationKey: "x", categoryId: "input-validation", mutations: [{ constraint: "type", path: "body:a", kind: "field.violate-constraint" }] });
    expect(a).toBe(b);
  });

  it("keeps mutation order significant, because the order changes what is sent", () => {
    const m1 = { kind: "path-id.substitute", parameter: "id", ownerIdentity: "owner" } as const;
    const m2 = { kind: "identity.swap", from: "owner", to: "other-user" } as const;
    const a = scenarioIdOf({ operationKey: "x", categoryId: "broken-object-level-authorization", mutations: [m1, m2] });
    const b = scenarioIdOf({ operationKey: "x", categoryId: "broken-object-level-authorization", mutations: [m2, m1] });
    expect(a).not.toBe(b);
  });
});

describe("content hash (approval binding, FR-030)", () => {
  const base = makeContent();

  it("is a 64-character SHA-256 over the material fields and is deterministic", () => {
    expect(contentHashOf(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHashOf(makeContent())).toBe(contentHashOf(base));
  });

  it("lists exactly the material fields the contract names", () => {
    expect([...MATERIAL_FIELDS]).toEqual([
      "operationKey",
      "categoryId",
      "baseRequest",
      "mutations",
      "expected",
      "conditions",
      "plannedRequestCount",
      "destructive.flag",
      "requiredIdentities",
    ]);
    expect(Object.keys(materialFieldsOf(base)).sort()).toEqual(
      ["baseRequest", "categoryId", "conditions", "destructiveFlag", "expected", "mutations", "operationKey", "plannedRequestCount", "requiredIdentities"],
    );
  });

  it.each<[string, Partial<SecurityScenarioContent>]>([
    ["the target operation", { operationKey: "GET /items", operationMethod: "GET", operationPath: "/items" }],
    ["the category", { categoryId: "input-validation" }],
    ["the request", { baseRequest: { pathParameters: { id: "9" }, queryParameters: {}, headers: {} } }],
    ["the mutations", { mutations: [{ kind: "auth.malformed" }] }],
    ["the expected behavior", { expected: { kind: "rejected", statement: "x", basis: "documented", documentedStatusCodes: [401], citation: "/x" } }],
    ["the conditions", { conditions: [{ kind: "status.in-set", codes: [401] }] }],
    ["the planned request count", { plannedRequestCount: 2 }],
    ["the destructive flag", { destructive: { flag: true, reasons: ["x"] } }],
    ["the required identities", { requiredIdentities: [{ role: "owner", label: "x" }] }],
  ])("changes when %s changes (material)", (_name, change) => {
    const edited = makeContent(change);
    expect(contentHashOf(edited)).not.toBe(contentHashOf(base));
    expect(isMaterialChange(base, edited)).toBe(true);
  });

  it.each<[string, Partial<SecurityScenarioContent>]>([
    ["the title", { title: "A different title" }],
    ["the objective", { objective: "Reworded." }],
    ["the rationale", { rationale: "Reworded." }],
    ["the impact", { impact: "Reworded." }],
    ["the suggested severity", { suggestedSeverity: "low" }],
    ["the limitations", { limitations: ["A note."] }],
    ["the manual inputs", { manualInputs: ["Another note."] }],
    ["the destructive reasons (not the flag)", { destructive: { flag: false, reasons: ["unused text"] } }],
    ["the provenance text", { provenance: { operationKey: "GET /orders", specElementPointer: "/elsewhere", ruleId: "other" } }],
    ["the prerequisite text", { prerequisites: [{ id: "p", kind: "identity", description: "Reworded" }] }],
  ])("does not change when %s changes (non-material, approval kept)", (_name, change) => {
    const edited = makeContent(change);
    expect(contentHashOf(edited)).toBe(contentHashOf(base));
    expect(isMaterialChange(base, edited)).toBe(false);
  });

  it("does not depend on object key order", () => {
    const reordered = { ...base, baseRequest: { headers: {}, queryParameters: {}, pathParameters: {} } };
    expect(contentHashOf(reordered)).toBe(contentHashOf(base));
  });
});

describe("dedupe key (FR-024)", () => {
  const base = makeContent();

  it("includes the mutations, so distinct probes are never collapsed", () => {
    expect(dedupeKeyOf(makeContent({ mutations: [{ kind: "auth.omit" }] }))).not.toBe(dedupeKeyOf(makeContent({ mutations: [{ kind: "auth.malformed" }] })));
  });

  it("includes the expected-behavior kind and the conditions", () => {
    expect(dedupeKeyOf(makeContent({ expected: { ...base.expected, kind: "no-leak" } }))).not.toBe(dedupeKeyOf(base));
    expect(dedupeKeyOf(makeContent({ conditions: [{ kind: "status.in-set", codes: [401] }] }))).not.toBe(dedupeKeyOf(base));
  });

  it("is the same for the same test reached by a different rule", () => {
    const viaOtherRule = makeContent({ provenance: { operationKey: "GET /orders", specElementPointer: "/x", ruleId: "some.other.rule" } });
    expect(dedupeKeyOf(viaOtherRule)).toBe(dedupeKeyOf(base));
  });
});
