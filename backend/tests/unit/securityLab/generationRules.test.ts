import { beforeAll, describe, expect, it } from "vitest";
import type { ApiModel, GeneratableCategoryId, SecurityScenarioContent } from "@apipilot/shared-domain";
import { loadSecurityLabLimits } from "../../../src/securityLab/config";
import { generateSecurityScenarios, type GenerationResult } from "../../../src/securityLab/scenarios/generateSecurityScenarios";
import { evaluatePrerequisites } from "../../../src/securityLab/scenarios/prerequisites";
import { OK_RESPONSES, asObservedModel, loadSecurityFixtureModel, modelFromDocument } from "../../fixtures/securityLab/loadModel";
import { makeProfile } from "../../fixtures/securityLab/builders";

const limits = loadSecurityLabLimits({});

function generate(model: ApiModel, extra: Partial<Parameters<typeof generateSecurityScenarios>[0]> = {}): GenerationResult {
  return generateSecurityScenarios({ apiModel: model, scope: "all", limits, ...extra });
}

function of(result: GenerationResult, categoryId: GeneratableCategoryId): SecurityScenarioContent[] {
  return result.scenarios.map((s) => s.content).filter((c) => c.categoryId === categoryId);
}

function titles(contents: SecurityScenarioContent[]): string[] {
  return contents.map((c) => c.title);
}

const BEARER = { components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } }, security: [{ bearerAuth: [] }] };

let sample: ApiModel;
let result: GenerationResult;
beforeAll(async () => {
  sample = await loadSecurityFixtureModel("sample-api.yaml");
  result = generate(sample);
});

describe("generation overall", () => {
  it("rejects nothing for the sample specification: every generated scenario passes validation", () => {
    expect(result.rejected).toEqual([]);
    expect(result.scenarios.length).toBeGreaterThan(40);
  });

  it("gives every scenario the full set of required content (FR-019)", () => {
    for (const { content } of result.scenarios) {
      for (const field of ["operationKey", "operationMethod", "operationPath", "categoryId", "taxonomy", "title", "objective", "rationale", "impact", "suggestedSeverity", "plannedRequestCount"] as const) {
        expect(content[field], `${content.title}: ${field}`).toBeTruthy();
      }
      expect(content.expected.statement.length).toBeGreaterThan(10);
      expect(content.conditions.length).toBeGreaterThan(0);
      expect(Array.isArray(content.prerequisites)).toBe(true);
      expect(Array.isArray(content.requiredIdentities)).toBe(true);
      expect(Array.isArray(content.limitations)).toBe(true);
      expect(Array.isArray(content.manualInputs)).toBe(true);
      expect(typeof content.destructive.flag).toBe("boolean");
      expect(content.provenance.operationKey).toBe(content.operationKey);
      expect(content.provenance.specElementPointer.startsWith("/")).toBe(true);
    }
  });

  it("never states an invented status as documented: documented expectations cite codes the operation has", () => {
    for (const { content } of result.scenarios) {
      const operation = sample.operations.find((o) => `${o.method} ${o.path}` === content.operationKey);
      if (content.expected.basis === "documented" && content.expected.documentedStatusCodes) {
        for (const code of content.expected.documentedStatusCodes) {
          expect(operation?.responses.map((r) => Number(r.statusCode)), content.title).toContain(code);
        }
      }
      if (content.expected.basis === "product-rule") expect(content.expected.ruleId, content.title).toMatch(/^SL-/);
    }
  });

  it("flags every scenario on a state-changing operation as destructive, except a TRACE probe", () => {
    for (const { content } of result.scenarios) {
      const writes = ["POST", "PUT", "PATCH", "DELETE"].includes(content.operationMethod);
      const probe = content.mutations.some((m) => m.kind === "method.probe");
      expect(content.destructive.flag, content.title).toBe(writes && !probe);
      if (content.destructive.flag) expect(content.destructive.reasons.length).toBeGreaterThan(0);
    }
  });

  it("keeps the placeholder, never a credential, in any base request", () => {
    const text = JSON.stringify(result.scenarios.map((s) => s.content.baseRequest));
    expect(text).not.toMatch(/hunter2|Bearer |eyJ/);
  });
});

describe("authentication (FR-025)", () => {
  it("generates a missing, an invalid, a malformed and an expired credential scenario per protected operation", () => {
    const forOrders = of(result, "authentication").filter((c) => c.operationKey === "GET /orders");
    expect(forOrders.map((c) => c.mutations[0].kind).sort()).toEqual(["auth.expired", "auth.invalid-token", "auth.malformed", "auth.omit"]);
  });

  it("generates nothing for an operation that declares itself public", () => {
    expect(of(result, "authentication").some((c) => c.operationKey === "GET /public/status")).toBe(false);
  });

  it("generates nothing for an operation with no requirement declared anywhere", async () => {
    for (const file of ["no-security.yaml", "root-empty.yaml"]) {
      const model = await loadSecurityFixtureModel(file);
      const noRequirement = of(generate(model), "authentication").filter((c) => c.operationKey === "GET /items");
      expect(noRequirement, file).toEqual([]);
    }
    const root = await loadSecurityFixtureModel("root-empty.yaml");
    expect(of(generate(root), "authentication").every((c) => c.operationKey === "GET /secure-items")).toBe(true);
  });

  it("generates nothing for an operation whose requirement allows an anonymous call", () => {
    const model = modelFromDocument({ ...BEARER, security: [{ bearerAuth: [] }, {}], paths: { "/x": { get: { responses: OK_RESPONSES } } } });
    expect(of(generate(model), "authentication")).toEqual([]);
  });

  it("cites the documented 401 or 403 when the operation has one, and the named rule when it has none", () => {
    const documented = of(result, "authentication").find((c) => c.operationKey === "GET /orders" && c.mutations[0].kind === "auth.omit");
    expect(documented?.expected).toMatchObject({ basis: "documented", documentedStatusCodes: [401] });
    expect(documented?.conditions).toEqual([{ kind: "status.in-set", codes: [401] }]);
    const undocumented = of(result, "authentication").find((c) => c.operationKey === "GET /v1/export" && c.mutations[0].kind === "auth.omit");
    expect(undocumented?.expected).toMatchObject({ basis: "product-rule", ruleId: "SL-REJECT-NOT-SUCCESS" });
    expect(undocumented?.conditions).toEqual([{ kind: "status.not-success" }]);
  });

  it("needs a supplied expired credential for the expired scenario, and nothing for the others", () => {
    const scenarios = of(result, "authentication").filter((c) => c.operationKey === "GET /orders");
    const expired = scenarios.find((c) => c.mutations[0].kind === "auth.expired");
    expect(expired?.prerequisites.map((p) => p.id)).toEqual(["expired-credential:bearerAuth"]);
    expect(expired?.manualInputs[0]).toMatch(/known-expired credential/);
    for (const other of scenarios.filter((c) => c !== expired)) expect(other.prerequisites).toEqual([]);
  });

  it("uses the operation's own scheme, not the root's, where it overrides", () => {
    const expired = of(result, "authentication").find((c) => c.operationKey === "GET /admin/reports" && c.mutations[0].kind === "auth.expired");
    expect(expired?.prerequisites[0].id).toBe("expired-credential:apiKeyAuth");
  });

  it("sends an OAuth2 scheme as a supplied bearer token, and says an unsupported scheme was skipped", () => {
    const oauth = modelFromDocument({
      components: { securitySchemes: { oauth: { type: "oauth2", flows: { clientCredentials: { tokenUrl: "https://idp.example/token", scopes: {} } } } } },
      security: [{ oauth: [] }],
      paths: { "/x": { get: { responses: OK_RESPONSES } } },
    });
    expect(of(generate(oauth), "authentication")).toHaveLength(4);
    const digest = modelFromDocument({
      components: { securitySchemes: { d: { type: "http", scheme: "digest" } } },
      security: [{ d: [] }],
      paths: { "/x": { get: { responses: OK_RESPONSES } } },
    });
    const skipped = generate(digest);
    expect(of(skipped, "authentication")).toEqual([]);
    expect(skipped.notes.some((n) => n.categoryId === "authentication" && /cannot express|can express/.test(n.reason) && n.operationKey === "GET /x")).toBe(true);
  });

  it("suggests higher severity for a write operation than for a read", () => {
    const write = of(result, "authentication").find((c) => c.operationKey === "POST /orders" && c.mutations[0].kind === "auth.omit");
    const read = of(result, "authentication").find((c) => c.operationKey === "GET /orders" && c.mutations[0].kind === "auth.omit");
    expect(write?.suggestedSeverity).toBe("critical");
    expect(read?.suggestedSeverity).toBe("high");
  });
});

describe("authorization (FR-025)", () => {
  it("generates only where the effective requirement states scopes, and invents no policy otherwise", () => {
    expect(of(result, "authorization")).toEqual([]);
    const scoped = modelFromDocument({
      components: { securitySchemes: { oauth: { type: "oauth2", flows: { clientCredentials: { tokenUrl: "https://idp.example/token", scopes: { "orders:write": "w" } } } } } },
      paths: { "/orders": { post: { security: [{ oauth: ["orders:write"] }], responses: { ...OK_RESPONSES, "403": { description: "no" } } } } },
    });
    const [scenario] = of(generate(scoped), "authorization");
    expect(scenario.mutations).toEqual([{ kind: "identity.swap", from: "privileged", to: "restricted" }]);
    expect(scenario.rationale).toContain('"orders:write"');
    expect(scenario.expected).toMatchObject({ basis: "product-rule", ruleId: "SL-REJECT-INSUFFICIENT-PERMISSION" });
    expect(scenario.requiredIdentities.map((i) => i.role)).toEqual(["privileged", "restricted"]);
    expect(scenario.prerequisites.map((p) => p.id)).toEqual(["identity:privileged:oauth", "identity:restricted:oauth"]);
    expect(scenario.destructive.flag).toBe(true);
  });
});

describe("broken object level authorization (FR-025)", () => {
  it("generates one cross-identity scenario for each read, update and delete on a resource identifier, and none for a create", () => {
    const keys = of(result, "broken-object-level-authorization").map((c) => c.operationKey).sort();
    expect(keys).toEqual(["DELETE /orders/{orderId}", "GET /orders/{orderId}", "PUT /orders/{orderId}"]);
  });

  it("states the identities and the ownership data it needs, so an incomplete profile shows exactly what is missing", () => {
    const get = of(result, "broken-object-level-authorization").find((c) => c.operationKey === "GET /orders/{orderId}")!;
    expect(get.mutations).toEqual([
      { kind: "path-id.substitute", parameter: "orderId", ownerIdentity: "owner" },
      { kind: "identity.swap", from: "owner", to: "other-user" },
    ]);
    expect(get.requiredIdentities.map((i) => i.role)).toEqual(["owner", "other-user"]);
    expect(get.expected).toMatchObject({ basis: "product-rule", ruleId: "SL-REJECT-CROSS-IDENTITY" });

    const none = evaluatePrerequisites(get.prerequisites, { hasCredential: () => false });
    expect(none.every((p) => p.state === "missing")).toBe(true);
    expect(none.map((p) => p.detail).join(" ")).toMatch(/No profile is selected/);

    const noSecond = makeProfile({ identities: [{ name: "alice", role: "owner", credentialSchemes: ["bearerAuth"] }], testData: [] });
    const partial = evaluatePrerequisites(get.prerequisites, { profile: noSecond, hasCredential: () => true });
    expect(partial.map((p) => [p.id.split(":")[0], p.state])).toEqual([["identity", "met"], ["identity", "missing"], ["ownership", "missing"]]);

    const complete = makeProfile({
      identities: [
        { name: "alice", role: "owner", credentialSchemes: ["bearerAuth"] },
        { name: "bob", role: "other-user", credentialSchemes: ["bearerAuth"] },
      ],
      testData: [{ ownerIdentity: "alice", parameter: "orderId", value: "42" }],
    });
    expect(evaluatePrerequisites(get.prerequisites, { profile: complete, hasCredential: () => true }).every((p) => p.state === "met")).toBe(true);
  });

  it("does not treat two roles with the same credential as two identities that differ in a way a test could show: the credential must be set for each", () => {
    const get = of(result, "broken-object-level-authorization").find((c) => c.operationKey === "GET /orders/{orderId}")!;
    const profile = makeProfile({
      identities: [
        { name: "alice", role: "owner", credentialSchemes: ["bearerAuth"] },
        { name: "bob", role: "other-user", credentialSchemes: ["bearerAuth"] },
      ],
      testData: [{ ownerIdentity: "alice", parameter: "orderId", value: "42" }],
    });
    const onlyAlice = evaluatePrerequisites(get.prerequisites, { profile, hasCredential: (identity) => identity === "alice" });
    expect(onlyAlice.find((p) => p.id.startsWith("identity:other-user"))?.state).toBe("missing");
  });

  it("generates nothing for an operation that does not need credentials", () => {
    const model = modelFromDocument({ paths: { "/items/{itemId}": { get: { parameters: [{ name: "itemId", in: "path", required: true, schema: { type: "string" } }], responses: OK_RESPONSES } } } });
    expect(of(generate(model), "broken-object-level-authorization")).toEqual([]);
  });

  it("notes when only the first of several identifier parameters is substituted", () => {
    const model = modelFromDocument({
      ...BEARER,
      paths: {
        "/shops/{shopId}/orders/{orderId}": {
          get: {
            parameters: [
              { name: "shopId", in: "path", required: true, schema: { type: "string" } },
              { name: "orderId", in: "path", required: true, schema: { type: "string" } },
            ],
            responses: OK_RESPONSES,
          },
        },
      },
    });
    const [scenario] = of(generate(model), "broken-object-level-authorization");
    expect(scenario.limitations.join(" ")).toMatch(/Only the first identifier parameter, "shopId"/);
  });
});

describe("object-property authorization and mass assignment (FR-025)", () => {
  it("probes each readOnly request property on a write operation, as a candidate, with the limit stated", () => {
    const scenarios = of(result, "object-property-authorization");
    expect(scenarios.map((c) => c.operationKey).sort()).toEqual(["POST /orders", "PUT /orders/{orderId}"]);
    const [first] = scenarios;
    expect(first.mutations).toEqual([{ kind: "body.add-property", path: "", name: "id", valueKind: "protected-example" }]);
    expect(first.conditions).toEqual([{ kind: "persisted.field-unchanged", path: "id" }]);
    expect(first.expected).toMatchObject({ kind: "persisted-unchanged", ruleId: "SL-REJECT-PROTECTED-PROPERTY" });
    expect(first.limitations.join(" ")).toMatch(/Persisted state is not read back in V1/);
    expect(first.destructive.flag).toBe(true);
  });

  it("probes only properties the model declares protected, never a guessed one", async () => {
    const model = modelFromDocument({
      paths: { "/p": { post: { requestBody: { content: { "application/json": { schema: { type: "object", properties: { role: { type: "string" }, isAdmin: { type: "boolean" } } } } } }, responses: OK_RESPONSES } } },
    });
    expect(of(generate(model), "object-property-authorization")).toEqual([]);
  });

  it("types the probe value by the property: a number for a numeric readOnly, a boolean for a boolean one", () => {
    const model = modelFromDocument({
      paths: {
        "/p": {
          post: {
            requestBody: { content: { "application/json": { schema: { type: "object", properties: { score: { type: "integer", readOnly: true }, locked: { type: "boolean", readOnly: true }, nested: { type: "object", properties: { rank: { type: "number", readOnly: true } } } } } } } },
            responses: OK_RESPONSES,
          },
        },
      },
    });
    const kinds = of(generate(model), "object-property-authorization").map((c) => c.mutations[0]);
    expect(kinds).toContainEqual({ kind: "body.add-property", path: "", name: "score", valueKind: "number" });
    expect(kinds).toContainEqual({ kind: "body.add-property", path: "", name: "locked", valueKind: "boolean" });
    expect(kinds).toContainEqual({ kind: "body.add-property", path: "nested", name: "rank", valueKind: "number" });
  });

  it("probes at most three properties per operation", () => {
    const properties = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`p${i}`, { type: "string", readOnly: true }]));
    const model = modelFromDocument({ paths: { "/p": { post: { requestBody: { content: { "application/json": { schema: { type: "object", properties } } } }, responses: OK_RESPONSES } } } });
    expect(of(generate(model), "object-property-authorization")).toHaveLength(3);
  });

  it("does not apply to a read operation", () => {
    expect(of(result, "object-property-authorization").some((c) => c.operationMethod === "GET")).toBe(false);
  });
});

describe("input validation (FR-025, FR-027)", () => {
  it("violates one declared constraint per scenario, only where the specification declares it", () => {
    const post = of(result, "input-validation").filter((c) => c.operationKey === "POST /orders");
    const kinds = post.map((c) => (c.mutations[0] as { path: string; constraint: string }).constraint + ":" + (c.mutations[0] as { path: string }).path);
    expect(kinds).toContain("required:body:status");
    expect(kinds).toContain("enum:body:status");
    expect(kinds).toContain("minimum:body:total");
    expect(kinds).toContain("type:body:total");
    expect(kinds).not.toContain("maximum:body:total");
    expect(kinds.some((k) => k.startsWith("minLength"))).toBe(false);
  });

  it("never mutates a credential field", () => {
    for (const content of of(result, "input-validation")) {
      expect(JSON.stringify(content.mutations)).not.toMatch(/password/i);
    }
  });

  it("does not report a type violation for a string path or query parameter, because everything in a URL is text", () => {
    const model = modelFromDocument({ paths: { "/x": { get: { parameters: [{ name: "q", in: "query", schema: { type: "string" } }, { name: "n", in: "query", schema: { type: "integer" } }], responses: OK_RESPONSES } } } });
    const targets = of(generate(model), "input-validation").map((c) => (c.mutations[0] as { path: string }).path);
    expect(targets).toEqual(["query:n"]);
  });

  it("cites the documented 400 or 422, and uses the named rule when there is none", () => {
    const documented = of(result, "input-validation").find((c) => c.operationKey === "POST /orders")!;
    expect(documented.expected).toMatchObject({ basis: "documented", documentedStatusCodes: [400] });
    const undocumented = modelFromDocument({ paths: { "/x": { get: { parameters: [{ name: "n", in: "query", schema: { type: "integer", minimum: 1 } }], responses: OK_RESPONSES } } } });
    expect(of(generate(undocumented), "input-validation")[0].expected).toMatchObject({ basis: "product-rule", ruleId: "SL-REJECT-CONSTRAINT-VIOLATION" });
  });

  it("generates injection probes only for a safe method, only from the fixed set, and only when the profile permits the category", () => {
    const model = modelFromDocument({
      paths: {
        "/search": { get: { parameters: [{ name: "q", in: "query", schema: { type: "string" } }], responses: OK_RESPONSES } },
        "/things": { post: { parameters: [{ name: "q", in: "query", schema: { type: "string" } }], responses: OK_RESPONSES } },
      },
    });
    expect(generate(model).scenarios.some((s) => s.content.mutations.some((m) => m.kind === "input.injection-probe"))).toBe(false);
    expect(generate(model).notes.some((n) => /Injection probes are generated only when a selected profile permits/.test(n.reason))).toBe(true);
    const notPermitted = makeProfile({ permittedCategories: ["authentication"] });
    expect(generate(model, { profile: notPermitted }).scenarios.some((s) => s.content.mutations.some((m) => m.kind === "input.injection-probe"))).toBe(false);

    const permitted = makeProfile({ permittedCategories: ["input-validation"] });
    const probes = generate(model, { profile: permitted }).scenarios.map((s) => s.content).filter((c) => c.mutations.some((m) => m.kind === "input.injection-probe"));
    expect(probes.map((c) => c.operationKey)).toEqual(["GET /search", "GET /search"]);
    expect(probes.map((c) => (c.mutations[0] as { probeId: string }).probeId).sort()).toEqual(["sql-quote", "xss-angle"]);
    expect(probes[0].expected).toMatchObject({ kind: "no-leak", ruleId: "SL-NO-LEAK-PATTERN" });
    expect(probes[0].limitations.join(" ")).toMatch(/not that the input is safe/);
  });
});

describe("resource consumption (FR-026)", () => {
  const rateLimited = modelFromDocument({ paths: { "/feed": { get: { responses: { ...OK_RESPONSES, "429": { description: "slow down" } } } } } });

  it("generates nothing unless the specification documents a 429, and nothing for a write", () => {
    expect(of(result, "resource-consumption")).toEqual([]);
    const write = modelFromDocument({ paths: { "/feed": { post: { responses: { ...OK_RESPONSES, "429": { description: "x" } } } } } });
    expect(of(generate(write), "resource-consumption")).toEqual([]);
  });

  it("uses the minimum count and is incomplete when no threshold is configured", () => {
    const [scenario] = of(generate(rateLimited), "resource-consumption");
    expect(scenario.mutations).toEqual([{ kind: "request.repeat", count: 5 }]);
    expect(scenario.plannedRequestCount).toBe(5);
    expect(scenario.expected).toMatchObject({ kind: "limited", basis: "documented", documentedStatusCodes: [429] });
    expect(scenario.conditions).toEqual([{ kind: "repeat.limit-engaged", withinRequests: 5 }]);
    expect(scenario.limitations.join(" ")).toMatch(/only a minimum/);
    expect(scenario.prerequisites.map((p) => p.id)).toEqual(["threshold:GET /feed"]);
  });

  it("derives the count from the configured threshold plus a stated margin", () => {
    const profile = makeProfile({ testData: [{ ownerIdentity: "alice", operationKey: "GET /feed", parameter: "rate-limit-threshold", value: "10" }] });
    const [scenario] = of(generate(rateLimited, { profile }), "resource-consumption");
    expect(scenario.plannedRequestCount).toBe(13);
    expect(scenario.limitations).toEqual([]);
    expect(evaluatePrerequisites(scenario.prerequisites, { profile, hasCredential: () => true })[0].state).toBe("met");
  });

  it("never exceeds the repeat ceiling, and says the threshold cannot be reached", () => {
    const profile = makeProfile({ testData: [{ ownerIdentity: "alice", parameter: "rate-limit-threshold", value: "1000" }] });
    const [scenario] = of(generate(rateLimited, { profile }), "resource-consumption");
    expect(scenario.plannedRequestCount).toBe(50);
    expect(scenario.limitations.join(" ")).toMatch(/above the repeat ceiling \(50\)/);
    const tight = generateSecurityScenarios({ apiModel: rateLimited, scope: "all", limits: loadSecurityLabLimits({ SECURITY_LAB_MAX_REPEAT_CEILING: "8" }), profile });
    expect(of(tight, "resource-consumption")[0].plannedRequestCount).toBe(8);
  });

  it("never generates an unbounded count, whatever the threshold", () => {
    for (const value of ["1", "50", "49", "100000"]) {
      const profile = makeProfile({ testData: [{ ownerIdentity: "a", parameter: "rate-limit-threshold", value }] });
      const [scenario] = of(generate(rateLimited, { profile }), "resource-consumption");
      expect(scenario.plannedRequestCount, value).toBeGreaterThanOrEqual(2);
      expect(scenario.plannedRequestCount, value).toBeLessThanOrEqual(50);
    }
  });

  it("ignores a threshold that is not a positive integer", () => {
    for (const value of ["0", "-3", "abc", "1.5", ""]) {
      const profile = makeProfile({ testData: [{ ownerIdentity: "a", parameter: "rate-limit-threshold", value }] });
      expect(of(generate(rateLimited, { profile }), "resource-consumption")[0].plannedRequestCount, value).toBe(5);
    }
  });
});

describe("sensitive data exposure (FR-009, FR-025)", () => {
  it("checks a response property with a declared basis, and cites it as documented", () => {
    const scenarios = of(result, "sensitive-data-exposure");
    expect(scenarios.map((c) => c.operationKey).sort()).toEqual(["GET /orders", "GET /orders/{orderId}"]);
    for (const scenario of scenarios) {
      expect(scenario.mutations).toEqual([]);
      expect(scenario.expected.basis).toBe("documented");
      expect(scenario.conditions.every((c) => c.kind === "body.field-absent")).toBe(true);
    }
    expect(scenarios.find((c) => c.operationKey === "GET /orders/{orderId}")?.conditions).toEqual([{ kind: "body.field-absent", path: "apiToken" }]);
  });

  it("produces nothing for a property flagged only by its name", () => {
    const model = modelFromDocument({ paths: { "/p": { get: { responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { ssn: { type: "string" } } } } } } } } } } });
    expect(of(generate(model), "sensitive-data-exposure")).toEqual([]);
  });

  it("uses the named rule, not the specification, for a field the user configured", () => {
    const model = modelFromDocument({ paths: { "/p": { get: { responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { nickname: { type: "string" } } } } } } } } } } });
    const [scenario] = of(generate(model, { configuredSensitiveFields: ["nickname"] }), "sensitive-data-exposure");
    expect(scenario.expected).toMatchObject({ basis: "product-rule", ruleId: "SL-NO-SENSITIVE-FIELD" });
  });

  it("is limited to safe methods", () => {
    const model = modelFromDocument({ paths: { "/p": { post: { responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { secret: { type: "string", writeOnly: true } } } } } } } } } } });
    expect(of(generate(model), "sensitive-data-exposure")).toEqual([]);
  });
});

describe("security misconfiguration (FR-025)", () => {
  it("probes TRACE once per path, on the path's first operation, and never as a destructive scenario", () => {
    const probes = of(result, "security-misconfiguration").filter((c) => c.mutations[0]?.kind === "method.probe");
    const paths = probes.map((c) => c.operationPath);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("/orders");
    const orders = probes.find((c) => c.operationPath === "/orders")!;
    expect(orders.operationMethod).toBe("GET");
    expect(orders.mutations).toEqual([{ kind: "method.probe", method: "TRACE" }]);
    expect(orders.expected).toMatchObject({ ruleId: "SL-REJECT-UNDOCUMENTED-METHOD" });
    expect(probes.every((c) => !c.destructive.flag)).toBe(true);
  });

  it("is not destructive even when the path's first operation is a POST", () => {
    const model = modelFromDocument({ ...BEARER, paths: { "/only-post": { post: { responses: OK_RESPONSES } } } });
    const probe = of(generate(model), "security-misconfiguration").find((c) => c.mutations[0]?.kind === "method.probe")!;
    expect(probe.operationMethod).toBe("POST");
    expect(probe.destructive.flag).toBe(false);
  });

  it("skips a path whose specification documents TRACE", () => {
    const model = modelFromDocument({ paths: { "/t": { get: { responses: OK_RESPONSES }, trace: { responses: OK_RESPONSES } } } });
    expect(of(generate(model), "security-misconfiguration").filter((c) => c.mutations[0]?.kind === "method.probe")).toEqual([]);
  });

  it("checks that a malformed request does not leak internals, on a write operation with a typed body field", () => {
    const leak = of(result, "security-misconfiguration").filter((c) => c.mutations[0]?.kind === "field.violate-constraint");
    expect(leak.map((c) => c.operationKey).sort()).toEqual(["POST /orders", "PUT /orders/{orderId}"]);
    expect(leak[0].expected).toMatchObject({ kind: "no-leak", ruleId: "SL-NO-LEAK-PATTERN" });
    expect(leak[0].conditions.map((c) => (c as { patternId: string }).patternId)).toEqual(["stack-trace", "internal-path", "sql-error", "server-banner"]);
    expect(leak[0].limitations.join(" ")).toMatch(/Response-header checks are not generated/);
  });
});

describe("limited and analysis-only categories", () => {
  it("generates nothing for SSRF, inventory or business flows, and says why for business flows", () => {
    for (const category of ["sensitive-business-flows"] as const) expect(of(result, category)).toEqual([]);
    expect(result.notes.some((n) => n.categoryId === "sensitive-business-flows" && /user-defined policy/.test(n.reason))).toBe(true);
    const categories = new Set(result.scenarios.map((s) => s.content.categoryId));
    expect(categories.has("ssrf-unsafe-consumption" as never)).toBe(false);
    expect(categories.has("api-inventory" as never)).toBe(false);
  });
});

describe("captured and declared input (FR-011)", () => {
  it("generates no authentication, authorization or object-level scenario, because security is not recorded", () => {
    const observed = generate(asObservedModel(sample));
    for (const category of ["authentication", "authorization", "broken-object-level-authorization"] as const) {
      expect(of(observed, category), category).toEqual([]);
    }
  });

  it("carries the model's origin on the scenarios it does generate", () => {
    const observed = generate(asObservedModel(sample));
    const some = observed.scenarios.find((s) => s.content.categoryId === "input-validation");
    expect(some?.content.evidenceOrigin).toBe("observed");
    expect(some?.content.observationCount).toBe(3);
  });
});

describe("dedupe and caps (FR-024, constitution XII)", () => {
  it("keeps one scenario per distinct test, with unique ids", () => {
    const ids = result.scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("caps constraint violations per operation and says exactly what it left out", () => {
    const fields = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, { type: "integer", minimum: 1 }]));
    const model = modelFromDocument({ paths: { "/big": { post: { requestBody: { content: { "application/json": { schema: { type: "object", properties: fields } } } }, responses: OK_RESPONSES } } } });
    const generated = generate(model);
    expect(of(generated, "input-validation")).toHaveLength(10);
    expect(generated.omittedByCap).toEqual([{ operationKey: "POST /big", categoryId: "input-validation", omitted: 14 }]);
  });

  it("names the titles it generated in a stable order: operation, then category, then id", () => {
    const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const tuples = result.scenarios.map((s) => [s.content.operationKey, s.content.categoryId, s.id] as const);
    const sorted = [...tuples].sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1]) || compare(a[2], b[2]));
    expect(tuples).toEqual(sorted);
    expect(titles(of(result, "authentication")).length).toBeGreaterThan(0);
  });
});

describe("category filter and scope", () => {
  it("generates only the requested categories", () => {
    const only = generate(sample, { categories: ["authentication"] });
    expect(new Set(only.scenarios.map((s) => s.content.categoryId))).toEqual(new Set(["authentication"]));
  });

  it("generates only for operations in scope", () => {
    const scoped = generate(sample, { scope: new Set(["GET /orders"]) });
    expect(new Set(scoped.scenarios.map((s) => s.content.operationKey))).toEqual(new Set(["GET /orders"]));
  });

  it("generates nothing for an empty scope", () => {
    expect(generate(sample, { scope: new Set() }).scenarios).toEqual([]);
  });
});

