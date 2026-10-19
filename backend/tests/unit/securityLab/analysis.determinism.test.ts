import { describe, expect, it } from "vitest";
import type { ApiModel } from "@apipilot/shared-domain";
import { analyzeSecurity } from "../../../src/securityLab/analysis/analyzeSecurity";
import { basisHashes, securityBasisHash } from "../../../src/securityLab/analysis/securityBasisHash";
import { asObservedModel, loadSecurityFixtureModel } from "../../fixtures/securityLab/loadModel";

const FILES = ["sample-api.yaml", "no-security.yaml", "root-empty.yaml"];
/** Words an observation must never use, because specification analysis cannot prove a runtime vulnerability (SC-003). */
const OVERCLAIM = /\b(vulnerable|vulnerability is present|exploitable|exploit|proves?|proven|confirmed vulnerability|insecure)\b/i;

async function models(): Promise<Array<[string, ApiModel]>> {
  const loaded: Array<[string, ApiModel]> = [];
  for (const file of FILES) loaded.push([file, await loadSecurityFixtureModel(file)]);
  const sample = loaded[0][1];
  loaded.push(["sample (observed)", asObservedModel(sample)]);
  return loaded;
}

describe("analysis determinism (FR-005, SC-003)", () => {
  it("gives identical observations in identical order when run twice", async () => {
    for (const [name, model] of await models()) {
      const first = analyzeSecurity(model);
      const second = analyzeSecurity(model);
      expect(JSON.stringify(first), name).toBe(JSON.stringify(second));
    }
  });

  it("does not depend on the order operations appear in the model", async () => {
    const sample = await loadSecurityFixtureModel("sample-api.yaml");
    const reversed: ApiModel = { ...sample, operations: [...sample.operations].reverse() };
    expect(JSON.stringify(analyzeSecurity(reversed))).toBe(JSON.stringify(analyzeSecurity(sample)));
  });

  it("does not change the model it is given", async () => {
    const sample = await loadSecurityFixtureModel("sample-api.yaml");
    const before = JSON.stringify(sample);
    analyzeSecurity(sample, { configuredSensitiveFields: ["internalNote"] });
    expect(JSON.stringify(sample)).toBe(before);
  });

  it("never states or implies a proven runtime vulnerability (SC-003)", async () => {
    for (const [name, model] of await models()) {
      for (const observation of analyzeSecurity(model, { configuredSensitiveFields: ["internalNote", "ssn"] }).observations) {
        expect(observation.rationale, `${name}: ${observation.ruleId}`).not.toMatch(OVERCLAIM);
      }
    }
  });

  it("gives every observation a classification from the four allowed, a source element and a rationale", async () => {
    for (const [name, model] of await models()) {
      for (const observation of analyzeSecurity(model).observations) {
        expect(["informational", "potential-risk", "requires-context", "not-measurable"], name).toContain(observation.classification);
        expect(observation.elementPointer.startsWith("/"), name).toBe(true);
        expect(observation.rationale.length, name).toBeGreaterThan(20);
      }
    }
  });
});

describe("security basis hash (research R3)", () => {
  it("is stable for the same model and differs per operation", async () => {
    const sample = await loadSecurityFixtureModel("sample-api.yaml");
    expect(Object.fromEntries(basisHashes(sample))).toEqual(Object.fromEntries(basisHashes(sample)));
    const values = [...basisHashes(sample).values()];
    expect(new Set(values).size).toBeGreaterThan(1);
    for (const value of values) expect(value).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when the effective requirement, a property flag or deprecation changes, and not for an unrelated edit", async () => {
    const sample = await loadSecurityFixtureModel("sample-api.yaml");
    const operation = sample.operations.find((o) => o.method === "POST" && o.path === "/orders");
    if (!operation) throw new Error("fixture changed");
    const base = securityBasisHash(sample, operation);

    expect(securityBasisHash(sample, { ...operation, securitySource: "explicit-public", security: [] })).not.toBe(base);
    expect(securityBasisHash(sample, { ...operation, deprecated: true })).not.toBe(base);

    const schema = Object.values(operation.requestBody?.contentTypes ?? {})[0];
    if (!schema) throw new Error("fixture changed");
    const flagged = {
      ...operation,
      requestBody: {
        required: true,
        contentTypes: { "application/json": { ...schema, properties: { ...schema.properties, total: { ...schema.properties.total, readOnly: true } } } },
      },
    };
    expect(securityBasisHash(sample, flagged)).not.toBe(base);

    // The operation's contract is part of it: a changed parameter or documented response makes a scenario stale.
    expect(securityBasisHash(sample, { ...operation, parameters: [...operation.parameters, { name: "extra", location: "query", required: false, schema: { required: [], properties: {} } }] })).not.toBe(base);
    expect(securityBasisHash(sample, { ...operation, responses: [...operation.responses, { statusCode: "500", description: "x", contentTypes: {}, examples: {} }] })).not.toBe(base);

    // Tags, descriptions and examples are not part of what a scenario depends on.
    expect(securityBasisHash(sample, { ...operation, tags: ["orders"] })).toBe(base);
    expect(securityBasisHash(sample, { ...operation, responses: operation.responses.map((response) => ({ ...response, description: "reworded", examples: { a: 1 } })) })).toBe(base);
  });
});
