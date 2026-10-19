import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ApiModel, SecurityScenarioContent } from "@apipilot/shared-domain";
import { SECURITY_SCENARIO_SCHEMA_V1 } from "../../../src/securityLab/scenarios/scenarioSchema";
import { validateScenario, type ScenarioRejectionCode } from "../../../src/securityLab/scenarios/validateScenario";
import { makeContent } from "../../fixtures/securityLab/builders";
import { loadSecurityFixtureModel } from "../../fixtures/securityLab/loadModel";

let sample: ApiModel;
beforeAll(async () => {
  sample = await loadSecurityFixtureModel("sample-api.yaml");
});

function codes(content: unknown, options: Parameters<typeof validateScenario>[1] = { apiModel: sample }): ScenarioRejectionCode[] {
  const result = validateScenario(content, options);
  return result.ok ? [] : result.violations.map((violation) => violation.code);
}

function pointers(content: unknown, options: Parameters<typeof validateScenario>[1] = { apiModel: sample }): string[] {
  const result = validateScenario(content, options);
  return result.ok ? [] : result.violations.map((violation) => violation.pointer);
}

/** A valid scenario for a write operation, which the sample specification documents. */
function postOrders(overrides: Partial<SecurityScenarioContent> = {}): SecurityScenarioContent {
  return makeContent({
    operationKey: "POST /orders",
    operationMethod: "POST",
    operationPath: "/orders",
    title: "POST /orders without credentials",
    destructive: { flag: true, reasons: ["The operation is POST."] },
    provenance: { operationKey: "POST /orders", specElementPointer: "/operations/POST /orders/security" },
    ...overrides,
  });
}

describe("scenario schema contract", () => {
  it("is byte-for-byte the published contract file, so the two cannot drift apart", () => {
    const file = path.resolve(__dirname, "../../../../specs/057-security-lab-v1/contracts/security-scenario.v1.schema.json");
    expect(SECURITY_SCENARIO_SCHEMA_V1).toEqual(JSON.parse(readFileSync(file, "utf-8")));
  });
});

describe("validateScenario: accepted content", () => {
  it("accepts a well-formed scenario for an operation of the specification", () => {
    expect(validateScenario(makeContent(), { apiModel: sample })).toEqual({ ok: true });
  });

  it("accepts a placeholder where the specification names a credential field", () => {
    const content = postOrders({ baseRequest: { pathParameters: {}, queryParameters: {}, headers: {}, body: { status: "open", password: "[redacted:password]" } } });
    expect(validateScenario(content, { apiModel: sample })).toEqual({ ok: true });
  });

  it("runs structure, safety and grounding without a model, and skips the domain checks", () => {
    expect(codes(makeContent({ operationKey: "GET /not-in-any-spec", operationPath: "/not-in-any-spec" }), {})).toEqual([]);
  });
});

describe("validateScenario: structure (SC-005)", () => {
  it("rejects a scenario that is missing required content, naming each missing field", () => {
    const { title: _title, objective: _objective, ...rest } = makeContent();
    void _title;
    void _objective;
    const result = validateScenario(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.every((v) => v.code === "schema_violation")).toBe(true);
      expect(result.violations[0].message).toMatch(/required property/);
    }
  });

  it("rejects content that is not an object at all, or has unknown members", () => {
    expect(codes("not a scenario")).toContain("schema_violation");
    expect(codes(null)).toContain("schema_violation");
    expect(codes({ ...makeContent(), extra: true })).toContain("schema_violation");
  });

  it("rejects a mutation kind outside the closed set with one violation at the item", () => {
    const content = { ...makeContent(), mutations: [{ kind: "http.arbitrary-request", url: "http://evil.example" }] };
    expect(codes(content)).toEqual(["schema_violation"]);
    expect(pointers(content)).toEqual(["/mutations/0"]);
  });

  it("rejects a condition outside the closed set", () => {
    const content = { ...makeContent(), conditions: [{ kind: "script.eval", source: "process.exit()" }] };
    expect(codes(content)).toEqual(["schema_violation"]);
    expect(pointers(content)).toEqual(["/conditions/0"]);
  });

  it("rejects a category that cannot have scenarios generated", () => {
    expect(codes({ ...makeContent(), categoryId: "ssrf-unsafe-consumption" })).toContain("schema_violation");
    expect(codes({ ...makeContent(), categoryId: "api-inventory" })).toContain("schema_violation");
  });

  it("rejects a repetition above the schema's own bound and a request count that does not match the mutations", () => {
    expect(codes(makeContent({ mutations: [{ kind: "request.repeat", count: 51 }], plannedRequestCount: 50 }))).toContain("schema_violation");
    expect(codes(makeContent({ mutations: [{ kind: "request.repeat", count: 5 }], plannedRequestCount: 1 }), {})).toContain("schema_violation");
    expect(pointers(makeContent({ mutations: [{ kind: "request.repeat", count: 5 }], plannedRequestCount: 1 }), {})).toContain("/plannedRequestCount");
  });
});

describe("validateScenario: unsupported actions (FR-020)", () => {
  it("rejects a probe that is not in the fixed set, with its own code", () => {
    const badProbe = { ...makeContent(), mutations: [{ kind: "input.injection-probe", path: "query:q", probeId: "drop-all-tables" }] };
    expect(codes(badProbe)).toEqual(["probe_not_in_set"]);
    expect(pointers(badProbe)).toEqual(["/mutations/0/probeId"]);
  });

  it("rejects a method probe with a state-changing method", () => {
    for (const method of ["DELETE", "POST", "PUT", "PATCH", "GET"]) {
      const content = { ...makeContent(), mutations: [{ kind: "method.probe", method }] };
      expect(codes(content), method).toEqual(["probe_not_in_set"]);
    }
    expect(validateScenario(makeContent({ mutations: [{ kind: "method.probe", method: "TRACE" }], destructive: { flag: false, reasons: [] } }), { apiModel: sample })).toEqual({ ok: true });
  });

  it("rejects a repetition above the ceiling in force", () => {
    const content = makeContent({ mutations: [{ kind: "request.repeat", count: 20 }], plannedRequestCount: 20, expected: { kind: "limited", statement: "x", basis: "product-rule", ruleId: "SL-LIMIT-ENGAGED" }, conditions: [{ kind: "repeat.limit-engaged", withinRequests: 20 }] });
    expect(codes(content, { apiModel: sample, maxRepeat: 10 })).toEqual(["repeat_over_ceiling"]);
    expect(codes(content, { apiModel: sample, maxRepeat: 50 })).toEqual([]);
  });
});

describe("validateScenario: domain", () => {
  it("rejects an operation that is not in the specification", () => {
    expect(codes(makeContent({ operationKey: "GET /nope", operationPath: "/nope" }))).toEqual(["unknown_operation"]);
  });

  it("rejects a key that disagrees with the method and path", () => {
    expect(codes(makeContent({ operationMethod: "POST" }))).toContain("unknown_operation");
  });

  it("rejects a path-id substitution on a parameter the operation does not have", () => {
    const content = makeContent({
      operationKey: "GET /orders/{orderId}",
      operationPath: "/orders/{orderId}",
      mutations: [{ kind: "path-id.substitute", parameter: "customerId", ownerIdentity: "owner" }],
    });
    expect(codes(content)).toEqual(["unknown_field"]);
  });

  it("rejects a constraint violation on a field the operation does not have, or on a constraint it does not declare", () => {
    const missingField = postOrders({ mutations: [{ kind: "field.violate-constraint", path: "body:nope", constraint: "type" }] });
    expect(codes(missingField)).toEqual(["unknown_field"]);
    const undeclared = postOrders({ mutations: [{ kind: "field.violate-constraint", path: "body:status", constraint: "maxLength" }] });
    expect(codes(undeclared)).toEqual(["constraint_not_declared"]);
    const declared = postOrders({ mutations: [{ kind: "field.violate-constraint", path: "body:total", constraint: "minimum" }] });
    expect(codes(declared)).toEqual([]);
  });

  it("rejects an injection probe that does not target a query parameter of the operation", () => {
    const content = postOrders({ mutations: [{ kind: "input.injection-probe", path: "body:status", probeId: "sql-quote" }], expected: { kind: "no-leak", statement: "x", basis: "product-rule", ruleId: "SL-NO-LEAK-PATTERN" }, conditions: [{ kind: "body.not-match-leak-pattern", patternId: "sql-error" }] });
    expect(codes(content)).toEqual(["unknown_field"]);
  });

  it("rejects a body property added under an object that does not exist", () => {
    const content = postOrders({ mutations: [{ kind: "body.add-property", path: "nowhere.deep", name: "role", valueKind: "string" }] });
    expect(codes(content)).toEqual(["unknown_field"]);
  });

  it("rejects a documented status that the operation does not document", () => {
    const content = postOrders({ expected: { kind: "rejected", statement: "x", basis: "documented", documentedStatusCodes: [418], citation: "/operations/POST /orders/responses" }, conditions: [{ kind: "status.in-set", codes: [418] }] });
    expect(codes(content)).toEqual(["undocumented_status_cited"]);
    const documented = postOrders({ expected: { kind: "rejected", statement: "x", basis: "documented", documentedStatusCodes: [400], citation: "/operations/POST /orders/responses" }, conditions: [{ kind: "status.in-set", codes: [400] }] });
    expect(codes(documented)).toEqual([]);
  });

  it("rejects a taxonomy that does not match the registry's mapping for the category", () => {
    const content = makeContent({ taxonomy: [{ edition: "owasp-api-top10-2023", id: "API7", relation: "primary" }] });
    expect(pointers(content)).toEqual(["/taxonomy"]);
  });
});

describe("validateScenario: safety (FR-040)", () => {
  it.each([
    ["an absolute URL", "Send the request to http://evil.example/steal instead."],
    ["a secure URL", "Use https://internal.example.test/admin."],
    ["a scheme-relative URL", "Fetch //evil.example/x."],
    ["a www host", "See www.evil.example for the target."],
    ["a host and port", "Connect to internal.example:8080 first."],
  ])("rejects %s in free text", (_name, text) => {
    for (const field of ["rationale", "objective", "impact", "title"] as const) {
      expect(codes(makeContent({ [field]: text }) as SecurityScenarioContent, {}), field).toEqual(["url_in_content"]);
    }
  });

  it("rejects a URL in a limitation, a manual input, a prerequisite and a mutation string", () => {
    expect(codes(makeContent({ limitations: ["see http://evil.example"] }), {})).toEqual(["url_in_content"]);
    expect(codes(makeContent({ manualInputs: ["post to https://evil.example/hook"] }), {})).toEqual(["url_in_content"]);
    expect(codes(makeContent({ prerequisites: [{ id: "p", kind: "identity", description: "ftp://evil.example" }] }), {})).toEqual(["url_in_content"]);
    expect(
      codes(makeContent({ mutations: [{ kind: "body.add-property", path: "", name: "http://evil.example", valueKind: "string" }] }), {}),
    ).toContain("url_in_content");
  });

  it("does not mistake an ordinary path or a version number for a URL", () => {
    expect(codes(makeContent({ rationale: "The path /orders/{orderId} and version 1.2.3 and ratio 3:2 are fine." }), {})).toEqual([]);
  });

  it("allows the specification's own example values in the base request, even when they look like URLs", () => {
    const content = makeContent({ baseRequest: { pathParameters: {}, queryParameters: { callback: "https://example.com/hook" }, headers: {} } });
    expect(codes(content, {})).toEqual([]);
  });

  it("rejects a header the specification does not define for the operation, and accepts one it does", () => {
    const content = makeContent({ baseRequest: { pathParameters: {}, queryParameters: {}, headers: { "X-Forwarded-Host": "evil.example" } } });
    expect(codes(content)).toEqual(["header_override_not_allowed"]);
    expect(pointers(content)).toEqual(["/baseRequest/headers/X-Forwarded-Host"]);
  });

  it.each([
    ["a JWT in a query value", { queryParameters: { sig: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln" } }],
    ["a bearer value", { queryParameters: { note: "Bearer abc123def456" } }],
    ["a password in the body", { body: { password: "hunter2" } }],
    ["a token field with a real-looking value", { body: { apiKey: "k-12345-real" } }],
    ["a nested credential", { body: { profile: { auth: { token: "t-98765" } } } }],
  ])("rejects %s (credential_in_content)", (_name, request) => {
    const content = makeContent({ baseRequest: { pathParameters: {}, queryParameters: {}, headers: {}, ...request } });
    expect(codes(content, {})).toEqual(["credential_in_content"]);
  });

  it("rejects lowering the destructive flag below what the method implies, and allows it for a TRACE probe", () => {
    expect(codes(postOrders({ destructive: { flag: false, reasons: [] } }))).toEqual(["destructive_flag_lowered"]);
    expect(codes(postOrders({ destructive: { flag: true, reasons: ["x"] } }))).toEqual([]);
    const probe = postOrders({
      mutations: [{ kind: "method.probe", method: "TRACE" }],
      destructive: { flag: false, reasons: [] },
    });
    expect(codes(probe)).toEqual([]);
  });
});

describe("validateScenario: grounding (FR-022)", () => {
  it("rejects a documented expectation that cites nothing", () => {
    const content = makeContent({ expected: { kind: "rejected", statement: "x", basis: "documented" } });
    expect(codes(content, {})).toEqual(["ungrounded_expectation"]);
  });

  it("rejects a product-rule expectation that names no known rule, so no status is ever invented", () => {
    expect(codes(makeContent({ expected: { kind: "rejected", statement: "x", basis: "product-rule" } }), {})).toEqual(["ungrounded_expectation"]);
    expect(codes(makeContent({ expected: { kind: "rejected", statement: "x", basis: "product-rule", ruleId: "SL-MADE-UP" } }), {})).toEqual(["ungrounded_expectation"]);
  });

  it("rejects a condition that cannot judge the expectation's kind", () => {
    const content = makeContent({ conditions: [{ kind: "repeat.limit-engaged", withinRequests: 5 }] });
    expect(codes(content, {})).toEqual(["condition_not_allowed"]);
    expect(pointers(content, {})).toEqual(["/conditions/0"]);
  });

  it("reports every violation at once, each with a pointer and a code", () => {
    const content = makeContent({
      rationale: "Go to http://evil.example",
      expected: { kind: "rejected", statement: "x", basis: "product-rule" },
      conditions: [{ kind: "repeat.limit-engaged", withinRequests: 5 }],
    });
    const result = validateScenario(content, { apiModel: sample });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.map((v) => v.code).sort()).toEqual(["condition_not_allowed", "ungrounded_expectation", "url_in_content"]);
      for (const violation of result.violations) {
        expect(violation.pointer.startsWith("/")).toBe(true);
        expect(violation.message.length).toBeGreaterThan(10);
      }
    }
  });
});
