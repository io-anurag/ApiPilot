import { beforeAll, describe, expect, it } from "vitest";
import type { ApiModel, SecurityAnalysis, SecurityObservation } from "@apipilot/shared-domain";
import { analyzeSecurity } from "../../../src/securityLab/analysis/analyzeSecurity";
import { OK_RESPONSES, asObservedModel, loadSecurityFixtureModel, modelFromDocument } from "../../fixtures/securityLab/loadModel";

function ofRule(analysis: SecurityAnalysis, ruleId: string): SecurityObservation[] {
  return analysis.observations.filter((observation) => observation.ruleId === ruleId);
}

function forOperation(analysis: SecurityAnalysis, ruleId: string, key: string): SecurityObservation | undefined {
  return analysis.observations.find((observation) => observation.ruleId === ruleId && observation.operationKey === key);
}

describe("security analysis rules (FR-007 to FR-011)", () => {
  let sample: ApiModel;
  let analysis: SecurityAnalysis;
  beforeAll(async () => {
    sample = await loadSecurityFixtureModel("sample-api.yaml");
    analysis = analyzeSecurity(sample);
  });

  describe("authentication and effective security", () => {
    it("declares each scheme once and reports the unused one separately", () => {
      const declared = ofRule(analysis, "auth-scheme-declared").map((o) => o.elementPointer);
      expect(declared).toEqual(["/securitySchemes/apiKeyAuth", "/securitySchemes/bearerAuth", "/securitySchemes/unusedBasic"]);
      expect(ofRule(analysis, "auth-scheme-unused").map((o) => o.elementPointer)).toEqual(["/securitySchemes/unusedBasic"]);
      expect(ofRule(analysis, "auth-scheme-declared").every((o) => o.classification === "informational")).toBe(true);
    });

    it("records a public operation as informational, naming the declaration", () => {
      const observation = forOperation(analysis, "effective-security-public", "GET /public/status");
      expect(observation?.classification).toBe("informational");
      expect(observation?.rationale).toMatch(/empty security requirement/);
      expect(observation?.rationale).toMatch(/public on purpose/);
    });

    it("raises nothing for an operation that merely inherits the root requirement", () => {
      const inheriting = analysis.observations.filter((o) => o.operationKey === "GET /orders" && /^effective-security|security-override/.test(o.ruleId));
      expect(inheriting).toEqual([]);
    });

    it("names both the override and the root requirement it replaced", () => {
      const observation = forOperation(analysis, "security-override", "GET /admin/reports");
      expect(observation?.classification).toBe("informational");
      expect(observation?.rationale).toContain("bearerAuth");
      expect(observation?.rationale).toContain("apiKeyAuth");
    });

    it("says an operation with nothing declared requires context when schemes exist, and notes an empty root", async () => {
      const model = await loadSecurityFixtureModel("root-empty.yaml");
      const result = analyzeSecurity(model);
      const observation = forOperation(result, "effective-security-none-declared", "GET /items");
      expect(observation?.classification).toBe("requires-context");
      expect(observation?.rationale).toMatch(/root declares an empty requirement on purpose/);
      expect(observation?.rationale).toMatch(/may be public or the requirement may be undocumented/);
    });

    it("says authentication is not measurable when no scheme or requirement is declared anywhere, once", async () => {
      const model = await loadSecurityFixtureModel("no-security.yaml");
      const result = analyzeSecurity(model);
      const none = ofRule(result, "effective-security-none-declared");
      expect(none).toHaveLength(1);
      expect(none[0]).toMatchObject({ classification: "not-measurable", elementPointer: "/securitySchemes" });
      expect(none[0].operationKey).toBeUndefined();
      expect(result.unmeasurable).toContain("authentication scheme declarations");
      // No operation is called unprotected.
      expect(result.observations.some((o) => /unprotected|unauthenticated/i.test(o.rationale) && !/not call/i.test(o.rationale))).toBe(false);
    });

    it("flags a requirement that names an undeclared scheme as a specification inconsistency, not a runtime claim", () => {
      const model = modelFromDocument({
        components: { securitySchemes: { real: { type: "http", scheme: "bearer" } } },
        paths: { "/x": { get: { security: [{ ghost: [] }], responses: OK_RESPONSES } } },
      });
      const observation = forOperation(analyzeSecurity(model), "operation-uses-undeclared-scheme", "GET /x");
      expect(observation?.classification).toBe("potential-risk");
      expect(observation?.rationale).toMatch(/inconsistency inside the specification|inconsistency/);
      expect(observation?.rationale).toMatch(/not evidence about the running service/);
    });

    it("flags an anonymous alternative as requiring context", () => {
      const model = modelFromDocument({
        components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
        paths: { "/x": { get: { security: [{ bearerAuth: [] }, {}], responses: OK_RESPONSES } } },
      });
      const observation = forOperation(analyzeSecurity(model), "security-override", "GET /x");
      expect(observation?.classification).toBe("requires-context");
      expect(observation?.rationale).toMatch(/anonymous/);
    });
  });

  describe("sensitive operations", () => {
    it("explains why an operation looks sensitive and treats a protected one as informational", () => {
      const observation = forOperation(analysis, "sensitive-operation", "DELETE /orders/{orderId}");
      expect(observation?.classification).toBe("informational");
      expect(observation?.rationale).toMatch(/deletes a resource/);
      expect(observation?.rationale).toMatch(/resource identifier "orderId"/);
    });

    it("raises a potential risk only when a sensitive, state-changing operation is declared public on purpose", () => {
      const model = modelFromDocument({
        components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
        security: [{ bearerAuth: [] }],
        paths: {
          "/admin/users": { post: { security: [], responses: OK_RESPONSES } },
          "/admin/users/list": { get: { security: [], responses: OK_RESPONSES } },
        },
      });
      const result = analyzeSecurity(model);
      expect(forOperation(result, "sensitive-operation", "POST /admin/users")?.classification).toBe("potential-risk");
      expect(forOperation(result, "sensitive-operation", "GET /admin/users/list")?.classification).toBe("requires-context");
      expect(forOperation(result, "effective-security-public", "POST /admin/users")?.classification).toBe("potential-risk");
    });

    it("never calls a merely sensitive-looking operation a risk when security applies", () => {
      expect(analysis.observations.filter((o) => o.ruleId === "sensitive-operation" && o.classification === "potential-risk")).toEqual([]);
    });
  });

  describe("sensitive properties (FR-009)", () => {
    it("reports a declared password with its basis", () => {
      const password = analysis.observations.find(
        (o) => o.ruleId === "sensitive-property" && o.operationKey === "POST /orders" && o.elementPointer.endsWith("/requestBody/password"),
      );
      expect(password).toMatchObject({ classification: "informational", basis: "format-password" });
      expect(password?.rationale).toMatch(/format: password/);
    });

    it("reports a writeOnly response property with its basis", () => {
      const token = analysis.observations.find((o) => o.ruleId === "sensitive-property" && o.basis === "write-only");
      expect(token?.classification).toBe("informational");
    });

    it("reports a name-only match as requiring context and never as a confirmed sensitive field", () => {
      const model = modelFromDocument({
        paths: {
          "/people": {
            post: {
              requestBody: { content: { "application/json": { schema: { type: "object", properties: { ssn: { type: "string" }, nickname: { type: "string" } } } } } },
              responses: OK_RESPONSES,
            },
          },
        },
      });
      const result = analyzeSecurity(model);
      const properties = ofRule(result, "sensitive-property");
      expect(properties).toHaveLength(1);
      expect(properties[0]).toMatchObject({ classification: "requires-context", basis: "name-match" });
      expect(properties[0].rationale).toMatch(/not treated as a confirmed sensitive field/);
    });

    it("records a user-configured field as user-provided, not as specification fact", () => {
      const configured = analyzeSecurity(sample, { configuredSensitiveFields: ["InternalNote"] });
      const note = configured.observations.find((o) => o.ruleId === "sensitive-property" && o.elementPointer.endsWith("/requestBody/internalNote"));
      expect(note).toMatchObject({ classification: "informational", basis: "user-configured" });
      expect(note?.rationale).toMatch(/you configured/);
    });
  });

  describe("mass-assignment candidates and error responses", () => {
    it("lists a readOnly property that appears in a request schema, as a candidate only", () => {
      const candidates = ofRule(analysis, "read-only-property-in-request").map((o) => o.operationKey);
      expect(candidates).toEqual(["POST /orders", "PUT /orders/{orderId}"]);
      expect(ofRule(analysis, "read-only-property-in-request")[0].rationale).toMatch(/candidate for a mass-assignment check/);
    });

    it("notes a protected operation that documents no 401 or 403, and skips one that does", () => {
      const keys = ofRule(analysis, "documented-error-responses").map((o) => o.operationKey);
      expect(keys).toContain("GET /v1/export");
      expect(keys).not.toContain("GET /orders");
      expect(keys).not.toContain("GET /public/status");
    });
  });

  describe("inventory (analysis only)", () => {
    it("records a deprecated operation", () => {
      expect(forOperation(analysis, "inventory-deprecated", "GET /legacy/orders")?.categoryId).toBe("api-inventory");
    });

    it("records a duplicate operation definition from the model's own issues, as an inconsistency", () => {
      const withDuplicate: ApiModel = {
        ...sample,
        summary: {
          ...sample.summary,
          issues: [{ kind: "duplicate-operation", location: "paths./orders.get", message: "Duplicate path+method combination: GET /orders" }],
        },
      };
      const [observation] = ofRule(analyzeSecurity(withDuplicate), "inventory-duplicate-operation");
      expect(observation).toMatchObject({ classification: "potential-risk", categoryId: "api-inventory" });
      expect(observation.rationale).toMatch(/inconsistency inside the specification/);
    });

    it("raises a version-marker observation only when more than one distinct version appears", () => {
      expect(ofRule(analysis, "inventory-version-marker")).toEqual([]);
      const multi = modelFromDocument({
        paths: { "/v1/a": { get: { responses: OK_RESPONSES } }, "/v2/a": { get: { responses: OK_RESPONSES } } },
      });
      const [observation] = ofRule(analyzeSecurity(multi), "inventory-version-marker");
      expect(observation.rationale).toContain("v1, v2");
      expect(observation.rationale).toMatch(/cannot show versions it does not describe/);
    });
  });

  describe("SSRF candidates (limited category)", () => {
    it("lists URL-like inputs as a place to look, and claims no detection", () => {
      const model = modelFromDocument({
        paths: {
          "/hooks": {
            post: {
              parameters: [{ name: "callbackUrl", in: "query", schema: { type: "string" } }],
              requestBody: { content: { "application/json": { schema: { type: "object", properties: { target: { type: "string", format: "uri" }, label: { type: "string" } } } } } },
              responses: OK_RESPONSES,
            },
          },
        },
      });
      const [observation] = ofRule(analyzeSecurity(model), "ssrf-candidate-input");
      expect(observation).toMatchObject({ classification: "requires-context", categoryId: "ssrf-unsafe-consumption", operationKey: "POST /hooks" });
      expect(observation.rationale).toContain('"callbackUrl", "target"');
      expect(observation.rationale).not.toContain('"label"');
      expect(observation.rationale).toMatch(/makes no detection claim/);
    });

    it("raises nothing for a specification with no URL-like input", () => {
      expect(ofRule(analysis, "ssrf-candidate-input")).toEqual([]);
    });

    it("does not treat a numeric input named like a URL as one", () => {
      const model = modelFromDocument({ paths: { "/x": { get: { parameters: [{ name: "url", in: "query", schema: { type: "integer" } }], responses: OK_RESPONSES } } } });
      expect(ofRule(analyzeSecurity(model), "ssrf-candidate-input")).toEqual([]);
    });
  });

  describe("captured and declared input (FR-011)", () => {
    it("says authentication is not measurable, once, labelled with the model's origin, and calls nothing unauthenticated", () => {
      const result = analyzeSecurity(asObservedModel(sample));
      const limits = ofRule(result, "observed-model-limits");
      expect(limits).toHaveLength(1);
      expect(limits[0]).toMatchObject({ classification: "not-measurable", origin: "observed" });
      expect(limits[0].rationale).toMatch(/never documented/);
      expect(result.unmeasurable).toContain("effective security requirements (not recorded in the input)");
      expect(ofRule(result, "effective-security-public")).toEqual([]);
      expect(ofRule(result, "effective-security-none-declared").every((o) => o.classification === "not-measurable")).toBe(true);
    });

    it("keeps each observation's origin label from the operation it rests on", () => {
      const result = analyzeSecurity(asObservedModel(sample));
      for (const observation of result.observations.filter((o) => o.operationKey !== undefined)) {
        expect(observation.origin).toBe("observed");
      }
    });

    it("does not raise the not-measurable observation for a specification that records its sources", () => {
      expect(ofRule(analysis, "observed-model-limits")).toEqual([]);
    });
  });

  it("assigns every observation a unique, stable id and counts them by classification", () => {
    const ids = analysis.observations.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^so-[0-9a-f]{16}(-\d+)?$/);
    const total = Object.values(analysis.counts).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(analysis.observations.length);
  });

  it("carries the specification revision the coverage module uses", async () => {
    const { specificationRevision } = await import("../../../src/apiCoverage/specRevision");
    expect(analysis.specificationRevision).toBe(specificationRevision(sample));
  });
});
