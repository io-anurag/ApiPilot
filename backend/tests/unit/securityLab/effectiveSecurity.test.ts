import { beforeAll, describe, expect, it } from "vitest";
import type { ApiModel, EffectiveSecurity } from "@apipilot/shared-domain";
import {
  allowsAnonymous,
  describeRequirement,
  operationKeyOf,
  resolveEffectiveSecurity,
  schemeNamesOf,
} from "../../../src/securityLab/analysis/effectiveSecurity";
import { OK_RESPONSES, asObservedModel, loadSecurityFixtureModel, modelFromDocument } from "../../fixtures/securityLab/loadModel";

function byKey(entries: EffectiveSecurity[]): Record<string, EffectiveSecurity> {
  return Object.fromEntries(entries.map((entry) => [entry.operationKey, entry]));
}

describe("effective security resolution (FR-006, SC-002)", () => {
  let sample: ApiModel;
  beforeAll(async () => {
    sample = await loadSecurityFixtureModel("sample-api.yaml");
  });

  it("inherits the root requirement, and says so", () => {
    const entry = byKey(resolveEffectiveSecurity(sample))["GET /orders"];
    expect(entry.source).toBe("root");
    expect(schemeNamesOf(entry.requirement)).toEqual(["bearerAuth"]);
    expect(entry.rootExplicitlyEmpty).toBe(false);
  });

  it("uses an operation's own requirement in place of the root's", () => {
    const entry = byKey(resolveEffectiveSecurity(sample))["GET /admin/reports"];
    expect(entry.source).toBe("operation");
    expect(schemeNamesOf(entry.requirement)).toEqual(["apiKeyAuth"]);
  });

  it("treats an own empty requirement as public by declaration, not as a missing one", () => {
    const entry = byKey(resolveEffectiveSecurity(sample))["GET /public/status"];
    expect(entry.source).toBe("explicit-public");
    expect(entry.requirement).toEqual([]);
  });

  it("reports nothing declared anywhere as none-declared", async () => {
    const model = await loadSecurityFixtureModel("no-security.yaml");
    for (const entry of resolveEffectiveSecurity(model)) {
      expect(entry.source).toBe("none-declared");
      expect(entry.rootExplicitlyEmpty).toBe(false);
    }
  });

  it("notes when the root declares an empty requirement on purpose, and still honours an operation's own", async () => {
    const model = await loadSecurityFixtureModel("root-empty.yaml");
    const entries = byKey(resolveEffectiveSecurity(model));
    expect(entries["GET /items"]).toMatchObject({ source: "none-declared", rootExplicitlyEmpty: true });
    expect(entries["GET /secure-items"]).toMatchObject({ source: "operation", rootExplicitlyEmpty: false });
  });

  it("marks input that records no source (captured traffic, definitions) as unknown, never as unprotected", () => {
    for (const entry of resolveEffectiveSecurity(asObservedModel(sample))) {
      expect(entry.source).toBe("unknown");
      expect(entry.rootExplicitlyEmpty).toBe(false);
    }
  });

  it("keeps the anonymous alternative and can say that an anonymous call is allowed", () => {
    const model = modelFromDocument({
      security: [{ bearerAuth: [] }, {}],
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
      paths: { "/x": { get: { responses: OK_RESPONSES } } },
    });
    const entry = resolveEffectiveSecurity(model)[0];
    expect(allowsAnonymous(entry.requirement)).toBe(true);
    expect(describeRequirement(entry.requirement)).toBe("bearerAuth or no credential (anonymous allowed)");
  });

  it("describes scopes-free and empty requirements in plain words", () => {
    expect(describeRequirement([])).toBe("no requirement");
    expect(describeRequirement([{ schemes: [{ name: "a", scopes: [] }, { name: "b", scopes: [] }] }])).toBe("a and b");
    expect(schemeNamesOf([{ schemes: [{ name: "b", scopes: [] }] }, { schemes: [{ name: "a", scopes: [] }, { name: "b", scopes: [] }] }])).toEqual(["a", "b"]);
  });

  it("keys an operation by upper-case method and path", () => {
    expect(operationKeyOf({ method: "get", path: "/x/{id}" })).toBe("GET /x/{id}");
  });

  it("never alters the effective requirement the model already holds", () => {
    for (const entry of resolveEffectiveSecurity(sample)) {
      const operation = sample.operations.find((candidate) => operationKeyOf(candidate) === entry.operationKey);
      expect(entry.requirement).toEqual(operation?.security);
    }
  });
});
