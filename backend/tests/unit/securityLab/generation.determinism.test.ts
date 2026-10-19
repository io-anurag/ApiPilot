import { describe, expect, it } from "vitest";
import type { ApiModel } from "@apipilot/shared-domain";
import { loadSecurityLabLimits } from "../../../src/securityLab/config";
import { generateSecurityScenarios } from "../../../src/securityLab/scenarios/generateSecurityScenarios";
import { contentHashOf } from "../../../src/securityLab/scenarios/scenarioIdentity";
import { OK_RESPONSES, loadSecurityFixtureModel, modelFromDocument } from "../../fixtures/securityLab/loadModel";
import { makeProfile } from "../../fixtures/securityLab/builders";

const limits = loadSecurityLabLimits({});

function generate(model: ApiModel, scope: ReadonlySet<string> | "all" = "all", extra: Partial<Parameters<typeof generateSecurityScenarios>[0]> = {}) {
  return generateSecurityScenarios({ apiModel: model, scope, limits, ...extra });
}

describe("generation determinism (FR-018, SC-004)", () => {
  it("gives identical scenarios, ids and order when generated twice from identical input", async () => {
    for (const file of ["sample-api.yaml", "no-security.yaml", "root-empty.yaml"]) {
      const model = await loadSecurityFixtureModel(file);
      expect(JSON.stringify(generate(model)), file).toBe(JSON.stringify(generate(model)));
    }
  });

  it("gives the same result for the YAML and JSON forms of the same specification", async () => {
    const yaml = await loadSecurityFixtureModel("sample-api.yaml");
    const json = await loadSecurityFixtureModel("sample-api.json");
    expect(JSON.stringify(generate(json))).toBe(JSON.stringify(generate(yaml)));
  });

  it("does not depend on the order operations appear in the model", async () => {
    const sample = await loadSecurityFixtureModel("sample-api.yaml");
    const reversed: ApiModel = { ...sample, operations: [...sample.operations].reverse() };
    expect(JSON.stringify(generate(reversed))).toBe(JSON.stringify(generate(sample)));
  });

  it("does not change the model it is given", async () => {
    const sample = await loadSecurityFixtureModel("sample-api.yaml");
    const before = JSON.stringify(sample);
    generate(sample, "all", { profile: makeProfile({ permittedCategories: ["input-validation"] }) });
    expect(JSON.stringify(sample)).toBe(before);
  });

  it("uses no clock or randomness: ids and hashes are plain functions of content", async () => {
    const sample = await loadSecurityFixtureModel("sample-api.yaml");
    const first = generate(sample).scenarios.map((s) => [s.id, contentHashOf(s.content)]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = generate(sample).scenarios.map((s) => [s.id, contentHashOf(s.content)]);
    expect(second).toEqual(first);
  });

  it("keeps a scenario's id when an unrelated operation, or the specification's revision, changes", async () => {
    const sample = await loadSecurityFixtureModel("sample-api.yaml");
    const before = new Map(generate(sample).scenarios.map((s) => [s.id, s.content.operationKey]));
    const changed: ApiModel = {
      ...sample,
      operations: sample.operations.map((o) =>
        o.path === "/legacy/orders" ? { ...o, responses: [...o.responses, { statusCode: "500", description: "x", contentTypes: {}, examples: {} }] } : o,
      ),
    };
    const after = new Map(generate(changed).scenarios.map((s) => [s.id, s.content.operationKey]));
    for (const [id, operationKey] of before) {
      if (operationKey !== "GET /legacy/orders") expect(after.get(id), id).toBe(operationKey);
    }
  });

  it("gives a scenario a different id for a different mutation on the same operation", async () => {
    const sample = await loadSecurityFixtureModel("sample-api.yaml");
    const ids = generate(sample).scenarios.filter((s) => s.content.operationKey === "GET /orders" && s.content.categoryId === "authentication").map((s) => s.id);
    expect(new Set(ids).size).toBe(4);
  });
});

describe("generation scope (FR-018)", () => {
  const model = modelFromDocument({
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    security: [{ bearerAuth: [] }],
    paths: { "/a": { get: { responses: OK_RESPONSES } }, "/b": { get: { responses: OK_RESPONSES } }, "/c": { get: { responses: OK_RESPONSES } } },
  });

  it("generates for every operation when the scope is all", () => {
    expect(new Set(generate(model).scenarios.map((s) => s.content.operationKey))).toEqual(new Set(["GET /a", "GET /b", "GET /c"]));
  });

  it("generates only for the operations in a selection", () => {
    const scoped = generate(model, new Set(["GET /b"]));
    expect(new Set(scoped.scenarios.map((s) => s.content.operationKey))).toEqual(new Set(["GET /b"]));
  });

  it("gives the same scenario the same id whether it was generated in a narrow or a wide scope, so widening changes nothing already generated", () => {
    const narrow = generate(model, new Set(["GET /a"])).scenarios;
    const wide = generate(model).scenarios;
    for (const scenario of narrow) {
      const match = wide.find((w) => w.id === scenario.id);
      expect(match, scenario.id).toBeDefined();
      expect(JSON.stringify(match?.content)).toBe(JSON.stringify(scenario.content));
    }
    expect(wide.length).toBeGreaterThan(narrow.length);
  });

  it("ignores an operation key that is not in the model", () => {
    expect(generate(model, new Set(["GET /nope"])).scenarios).toEqual([]);
  });
});
