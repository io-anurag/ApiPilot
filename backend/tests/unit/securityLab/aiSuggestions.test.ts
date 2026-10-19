import { beforeEach, describe, expect, it } from "vitest";
import type { ApiModel } from "@apipilot/shared-domain";
import { AIProviderError } from "../../../src/ai/errors";
import { parseSuggestionResponse, MAX_SUGGESTIONS, type SuggestionCandidate } from "../../../src/securityLab/ai/parseSuggestionResponse";
import {
  MAX_PROMPT_OPERATIONS,
  SECURITY_SUGGESTION_MAX_OUTPUT_TOKENS,
  SECURITY_SUGGESTION_RESPONSE_VERSION,
  SECURITY_SUGGESTION_SYSTEM_PROMPT,
  buildSuggestionPrompt,
  buildSuggestionRequest,
  digestOperation,
} from "../../../src/securityLab/ai/suggestionPrompt";
import { validateSuggestion } from "../../../src/securityLab/ai/validateSuggestion";
import { loadSecurityLabLimits } from "../../../src/securityLab/config";
import { operationKeyOf, resolveEffectiveSecurity } from "../../../src/securityLab/analysis/effectiveSecurity";
import { sampleModel } from "../../fixtures/securityLab/runFixtures";

let model: ApiModel;
beforeEach(async () => {
  model = await sampleModel();
});

const limits = loadSecurityLabLimits({});
const context = () => ({ apiModel: model, limits, model: { id: "stub-model" } });

function candidate(overrides: Partial<SuggestionCandidate> = {}): SuggestionCandidate {
  return {
    operationKey: "GET /orders",
    categoryId: "security-misconfiguration",
    title: "TRACE is not accepted on /orders",
    objective: "Check that TRACE is refused.",
    rationale: "The specification documents GET and POST only, so other methods should be refused.",
    impact: "An undocumented method can expose behavior nobody reviewed.",
    mutations: [{ kind: "method.probe", method: "TRACE" }],
    expected: { kind: "rejected", ruleId: "SL-REJECT-UNDOCUMENTED-METHOD" },
    conditions: [{ kind: "status.not-success" }],
    confidence: 0.7,
    assumptions: ["The service is reachable without credentials for TRACE."],
    ...overrides,
  };
}

const reasonCodes = (c: SuggestionCandidate): string[] => {
  const result = validateSuggestion(c, context());
  return result.ok ? [] : result.violations.map((violation) => violation.code);
};

describe("a valid suggestion becomes a scenario with everything derived by the system", () => {
  it("is accepted, with the model, confidence and assumptions recorded as provenance", () => {
    const result = validateSuggestion(candidate(), context());
    if (!result.ok) throw new Error(JSON.stringify(result.violations));
    expect(result.content.provenance).toMatchObject({ operationKey: "GET /orders", ruleId: "ai.suggestion", aiModel: "stub-model", aiConfidence: 0.7, aiAssumptions: ["The service is reachable without credentials for TRACE."] });
    expect(result.content).toMatchObject({ operationMethod: "GET", operationPath: "/orders", categoryId: "security-misconfiguration", plannedRequestCount: 1 });
  });

  it("derives what a model must never choose: taxonomy, severity, destructive flag, grounding statement and base request", () => {
    const result = validateSuggestion(candidate({ expected: { kind: "rejected", ruleId: "SL-REJECT-UNDOCUMENTED-METHOD" } }), context());
    if (!result.ok) throw new Error("expected acceptance");
    expect(result.content.taxonomy.length).toBeGreaterThan(0);
    expect(result.content.suggestedSeverity).toBe("low");
    expect(result.content.destructive.flag).toBe(false);
    expect(result.content.expected).toMatchObject({ basis: "product-rule", ruleId: "SL-REJECT-UNDOCUMENTED-METHOD" });
    expect(result.content.expected.statement).toMatch(/not documented|does not document|must not be processed/);
    expect(result.content.baseRequest).toBeDefined();
    expect(result.content.limitations[0]).toMatch(/Review it before approving/);
  });

  it("derives prerequisites and required identities from the mutations, not from what the model says", () => {
    const result = validateSuggestion(
      candidate({
        operationKey: "GET /orders/{orderId}",
        categoryId: "broken-object-level-authorization",
        mutations: [{ kind: "path-id.substitute", parameter: "orderId", ownerIdentity: "owner" }, { kind: "identity.swap", from: "owner", to: "other-user" }],
        expected: { kind: "rejected", ruleId: "SL-REJECT-CROSS-IDENTITY" },
      }),
      context(),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.violations));
    expect(result.content.prerequisites.map((p) => p.kind).sort()).toEqual(["identity", "identity", "ownership"]);
    expect(result.content.requiredIdentities.map((r) => r.role).sort()).toEqual(["other-user", "owner"]);
  });

  it("grounds an expectation in status codes the operation documents, and cites the responses", () => {
    const result = validateSuggestion(candidate({ operationKey: "GET /orders/{orderId}", categoryId: "authorization", mutations: [{ kind: "auth.omit" }], expected: { kind: "rejected", documentedStatusCodes: [403] }, conditions: [{ kind: "status.in-set", codes: [403] }] }), context());
    if (!result.ok) throw new Error(JSON.stringify(result.violations));
    expect(result.content.expected).toMatchObject({ basis: "documented", documentedStatusCodes: [403], citation: "/operations/GET /orders/{orderId}/responses" });
  });

  it("is deterministic and does not modify the candidate", () => {
    const input = candidate();
    const before = JSON.stringify(input);
    expect(validateSuggestion(input, context())).toEqual(validateSuggestion(candidate(), context()));
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("each kind of unsafe or invalid suggestion is refused with a stable code (FR-064)", () => {
  it.each([
    ["an unknown operation", candidate({ operationKey: "GET /nowhere" }), "unknown_operation"],
    ["an analysis-only category", candidate({ categoryId: "api-inventory" }), "category_not_generatable"],
    ["an unknown category", candidate({ categoryId: "made-up" }), "category_not_generatable"],
    ["a URL in the rationale", candidate({ rationale: "Send the request to http://evil.example/steal instead." }), "url_in_content"],
    ["a scheme-relative URL in the title", candidate({ title: "Call //evil.example/x" }), "url_in_content"],
    ["a host and port in the objective", candidate({ objective: "Check evil.example:8080 for leaks." }), "url_in_content"],
    ["an unsupported action", candidate({ mutations: [{ kind: "shell.exec", command: "rm -rf /" }] }), "schema_violation"],
    ["a mutation that is not an object", candidate({ mutations: ["auth.omit"] }), "schema_violation"],
    ["no mutations", candidate({ mutations: [] }), "schema_violation"],
    ["no conditions", candidate({ conditions: [] }), "schema_violation"],
    ["a repeat over the ceiling", candidate({ categoryId: "resource-consumption", mutations: [{ kind: "request.repeat", count: 5000 }], expected: { kind: "limited", ruleId: "SL-LIMIT-ENGAGED" }, conditions: [{ kind: "repeat.limit-engaged", withinRequests: 5000 }] }), "schema_violation"],
    ["an unknown expected kind", candidate({ expected: { kind: "obliterated", ruleId: "SL-REJECT-NOT-SUCCESS" } }), "schema_violation"],
    ["an expectation grounded in nothing", candidate({ expected: { kind: "rejected" } }), "ungrounded_expectation"],
    ["an unknown rule id and no codes", candidate({ expected: { kind: "rejected", ruleId: "SL-MY-OWN-RULE" } }), "ungrounded_expectation"],
    ["a status code the operation does not document", candidate({ expected: { kind: "rejected", documentedStatusCodes: [418] }, conditions: [{ kind: "status.in-set", codes: [418] }] }), "undocumented_status_cited"],
    ["a header the specification does not declare, chosen by the model", candidate({ mutations: [{ kind: "field.violate-constraint", path: "header:Host", constraint: "type" }] }), "unknown_field"],
    ["a condition outside the vocabulary", candidate({ conditions: [{ kind: "script.eval", code: "1" }] }), "schema_violation"],
  ] as Array<[string, SuggestionCandidate, string]>)("%s is refused as %s", (_name, input, code) => {
    expect(reasonCodes(input)).toContain(code);
  });

  it("refuses a credential-shaped value in a text field", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2VlZHNlZWRzZWVk";
    expect(reasonCodes(candidate({ rationale: jwt }))).toContain("credential_in_content");
  });

  it("reports every violation of one suggestion, not only the first", () => {
    const result = validateSuggestion(candidate({ operationKey: "GET /orders", rationale: "See http://evil.example", mutations: [{ kind: "request.repeat", count: 5000 }] }), context());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations.length).toBeGreaterThan(1);
  });

  it("never lets one bad suggestion affect another", () => {
    const results = [candidate({ operationKey: "GET /nowhere" }), candidate(), candidate({ rationale: "http://x.test/a" })].map((c) => validateSuggestion(c, context()).ok);
    expect(results).toEqual([false, true, false]);
  });
});

describe("parsing the model's answer", () => {
  const answer = (suggestions: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ responseVersion: SECURITY_SUGGESTION_RESPONSE_VERSION, suggestions, ...extra });
  const good = () => ({ operationKey: "GET /orders", categoryId: "security-misconfiguration", title: "t", objective: "o", rationale: "r", impact: "i", mutations: [{ kind: "method.probe", method: "TRACE" }], expected: { kind: "rejected", ruleId: "SL-REJECT-UNDOCUMENTED-METHOD" }, conditions: [{ kind: "status.not-success" }], confidence: 0.5, assumptions: [] });

  it("accepts a well-formed answer, with or without a code fence and surrounding prose", () => {
    for (const text of [answer([good()]), "```json\n" + answer([good()]) + "\n```", `Here you go: ${answer([good()])} Thanks.`]) {
      const parsed = parseSuggestionResponse(text);
      expect(parsed.suggestions).toHaveLength(1);
      expect(parsed.suggestions[0].ok).toBe(true);
    }
  });

  it("rejects a malformed suggestion on its own and keeps the valid one beside it", () => {
    const parsed = parseSuggestionResponse(answer([{ operationKey: "GET /orders" }, good(), "not an object", { ...good(), confidence: 7 }]));
    expect(parsed.suggestions.map((s) => s.ok)).toEqual([false, true, false, false]);
    for (const s of parsed.suggestions) if (!s.ok) expect(s.reason.length).toBeGreaterThan(10);
  });

  it("ignores fields it does not know, so a model cannot smuggle one into a scenario", () => {
    const parsed = parseSuggestionResponse(answer([{ ...good(), baseRequest: { headers: { Host: "evil.test" } }, destructive: { flag: false }, suggestedSeverity: "critical", url: "http://x.test" }]));
    const first = parsed.suggestions[0];
    expect(first.ok && Object.keys(first.candidate).sort()).toEqual(["assumptions", "categoryId", "conditions", "confidence", "expected", "impact", "mutations", "objective", "operationKey", "rationale", "title"]);
  });

  it("caps how many it looks at, and says how many it ignored", () => {
    const parsed = parseSuggestionResponse(answer(Array.from({ length: MAX_SUGGESTIONS + 5 }, good)));
    expect(parsed.suggestions).toHaveLength(MAX_SUGGESTIONS);
    expect(parsed.ignored).toBe(5);
  });

  it.each([
    ["text that is not JSON", "I cannot help with that."],
    ["JSON that is not an object", "[1,2,3]"],
    ["the wrong version", JSON.stringify({ responseVersion: 99, suggestions: [] })],
    ["no suggestions list", JSON.stringify({ responseVersion: 1 })],
    ["a suggestions list that is not an array", JSON.stringify({ responseVersion: 1, suggestions: "many" })],
  ])("rejects %s as an invalid response, with a fixed message that never echoes the answer", (_name, text) => {
    let caught: unknown;
    try {
      parseSuggestionResponse(text);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AIProviderError);
    expect((caught as AIProviderError).category).toBe("INVALID_RESPONSE");
    expect((caught as Error).message).not.toContain(text.slice(0, 8));
  });

  it("accepts an empty list: nothing useful to suggest is an answer", () => {
    expect(parseSuggestionResponse(answer([])).suggestions).toEqual([]);
  });
});

describe("the prompt (constitution XXIII)", () => {
  const digests = () => {
    const effective = new Map(resolveEffectiveSecurity(model).map((entry) => [entry.operationKey, entry]));
    return model.operations.filter((operation) => ["GET /orders", "POST /orders"].includes(operationKeyOf(operation))).map((operation) => digestOperation(operation, effective.get(operationKeyOf(operation))));
  };

  it("is pinned: any change to its text, vocabulary or answer format must bump SECURITY_SUGGESTION_RESPONSE_VERSION", () => {
    expect(SECURITY_SUGGESTION_RESPONSE_VERSION).toBe(1);
    expect(SECURITY_SUGGESTION_SYSTEM_PROMPT).toMatchSnapshot();
    expect(JSON.parse(buildSuggestionPrompt({ operations: digests(), categories: ["authentication", "input-validation"] }))).toMatchSnapshot();
  });

  it("describes operations by their shape only: no example value, response body or credential", () => {
    const text = buildSuggestionPrompt({ operations: digests(), categories: ["authentication"] });
    expect(text).toContain('"operationKey":"GET /orders"');
    expect(text).toContain("requires bearerAuth");
    expect(text).not.toMatch(/https?:\/\/|Bearer |password":"|"example"/);
  });

  it("builds a JSON inference request with its own system prompt and a bounded answer", () => {
    const request = buildSuggestionRequest("req-1", { operations: digests(), categories: ["authentication"] });
    expect(request).toMatchObject({ contractVersion: 1, requestId: "req-1", expectedOutputFormat: "json", maxOutputTokens: SECURITY_SUGGESTION_MAX_OUTPUT_TOKENS, systemPrompt: SECURITY_SUGGESTION_SYSTEM_PROMPT });
  });

  it("describes at most the documented number of operations", () => {
    const many = Array.from({ length: MAX_PROMPT_OPERATIONS + 5 }, (_, index) => ({ operationKey: `GET /o${index}`, security: "none", parameters: [], bodyFields: [], documentedResponses: [200] }));
    expect(JSON.parse(buildSuggestionPrompt({ operations: many, categories: [] })).operations).toHaveLength(MAX_PROMPT_OPERATIONS);
  });

  it("is deterministic", () => {
    expect(buildSuggestionPrompt({ operations: digests(), categories: ["authentication"] })).toBe(buildSuggestionPrompt({ operations: digests(), categories: ["authentication"] }));
  });
});
