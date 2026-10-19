import { describe, expect, it } from "vitest";
import type { ConditionResult, EvaluationCondition, SecurityMutation, SecurityScenarioContent } from "@apipilot/shared-domain";
import { evaluateCondition, evaluateConditions } from "../../../src/securityLab/evaluation/evaluateConditions";
import { evaluateScenario } from "../../../src/securityLab/evaluation/evaluateScenario";
import { matchesLeakPattern } from "../../../src/securityLab/evaluation/leakPatterns";
import { buildObservedSummary } from "../../../src/securityLab/evaluation/observedSummary";
import { describeCondition, outcomeOf, reasonFor } from "../../../src/securityLab/evaluation/scenarioOutcome";
import type { ExecutedResponse } from "../../../src/securityLab/evaluation/types";
import { makeContent } from "../../fixtures/securityLab/builders";
import { SECRET_BEARER_TOKEN, SECRET_SHAPED_RESPONSE_FIELD, assertNoSecrets } from "../../fixtures/securityLab/secretCorpus";

function res(status: number, body = "", headers: Record<string, string> = {}, truncated = false): ExecutedResponse {
  return { index: 0, method: "GET", status, headers, bodyText: body, truncated, durationMs: 1 };
}

function content(overrides: Partial<SecurityScenarioContent> = {}): SecurityScenarioContent {
  return makeContent(overrides);
}

const state = (condition: EvaluationCondition, responses: ExecutedResponse[], overrides: Partial<SecurityScenarioContent> = {}) =>
  evaluateCondition(condition, { content: content(overrides), responses });

describe("status conditions", () => {
  it.each([
    [401, "satisfied"],
    [403, "satisfied"],
    [302, "satisfied"],
    [500, "satisfied"],
    [200, "violated"],
    [204, "violated"],
    [299, "violated"],
  ])("status.not-success on %i is %s", (status, expected) => {
    expect(state({ kind: "status.not-success" }, [res(status)])).toBe(expected);
  });

  it("judges only the last response of a single-request scenario, and says nothing without a response", () => {
    expect(state({ kind: "status.not-success" }, [res(200), res(401)])).toBe("satisfied");
    expect(state({ kind: "status.not-success" }, [])).toBe("indeterminate");
  });

  it("judges every response of a repeat scenario", () => {
    const repeat: SecurityMutation[] = [{ kind: "request.repeat", count: 3 }];
    expect(state({ kind: "status.not-success" }, [res(401), res(200), res(401)], { mutations: repeat })).toBe("violated");
    expect(state({ kind: "status.not-success" }, [res(401), res(403), res(401)], { mutations: repeat })).toBe("satisfied");
  });

  it.each([
    [{ kind: "status.in-set", codes: [401, 403] } as const, 403, "satisfied"],
    [{ kind: "status.in-set", codes: [401, 403] } as const, 404, "violated"],
    [{ kind: "status.in-set", codes: [401, 403] } as const, 200, "violated"],
    [{ kind: "status.equals", code: 429 } as const, 429, "satisfied"],
    [{ kind: "status.equals", code: 429 } as const, 200, "violated"],
    [{ kind: "status.not-equals", code: 500 } as const, 500, "violated"],
    [{ kind: "status.not-equals", code: 500 } as const, 400, "satisfied"],
  ])("%j on %i is %s", (condition, status, expected) => {
    expect(state(condition, [res(status)])).toBe(expected);
  });

  it("is indeterminate for every status condition when no response arrived", () => {
    for (const condition of [{ kind: "status.in-set", codes: [401] }, { kind: "status.equals", code: 401 }, { kind: "status.not-equals", code: 401 }] as const) {
      expect(state(condition, [])).toBe("indeterminate");
    }
  });
});

describe("header conditions", () => {
  it("judges presence and absence by case-insensitive name", () => {
    const headers = { "strict-transport-security": "max-age=1" };
    expect(state({ kind: "header.present", name: "Strict-Transport-Security" }, [res(200, "", headers)])).toBe("satisfied");
    expect(state({ kind: "header.present", name: "X-Frame-Options" }, [res(200, "", headers)])).toBe("violated");
    expect(state({ kind: "header.absent", name: "X-Powered-By" }, [res(200, "", headers)])).toBe("satisfied");
    expect(state({ kind: "header.absent", name: "strict-transport-security" }, [res(200, "", headers)])).toBe("violated");
  });

  it("judges a header value token ignoring case, and is indeterminate when the header is missing", () => {
    expect(state({ kind: "header.value-not-contains", name: "Server", token: "nginx" }, [res(200, "", { server: "NGINX/1.18" })])).toBe("violated");
    expect(state({ kind: "header.value-not-contains", name: "Server", token: "nginx" }, [res(200, "", { server: "custom" })])).toBe("satisfied");
    expect(state({ kind: "header.value-not-contains", name: "Server", token: "nginx" }, [res(200)])).toBe("indeterminate");
    expect(state({ kind: "header.present", name: "x" }, [])).toBe("indeterminate");
  });
});

describe("body field conditions", () => {
  const body = JSON.stringify({ id: 1, profile: { ssn: "x", tags: [{ name: "a" }] }, items: [{ sku: "s" }] });

  it("finds a nested field and a field inside an array", () => {
    expect(state({ kind: "body.field-present", path: "profile.ssn" }, [res(200, body)])).toBe("satisfied");
    expect(state({ kind: "body.field-present", path: "$.profile.tags.name" }, [res(200, body)])).toBe("satisfied");
    expect(state({ kind: "body.field-present", path: "items[].sku" }, [res(200, body)])).toBe("satisfied");
    expect(state({ kind: "body.field-present", path: "profile.card" }, [res(200, body)])).toBe("violated");
  });

  it("is violated when a field that must be absent is there, and satisfied when it is not", () => {
    expect(state({ kind: "body.field-absent", path: "profile.ssn" }, [res(200, body)])).toBe("violated");
    expect(state({ kind: "body.field-absent", path: "password" }, [res(200, body)])).toBe("satisfied");
  });

  it.each([
    ["an empty body", ""],
    ["a body that is not JSON", "<html>error</html>"],
    ["a body cut off before it could be read", '{"id":1,"profile":{"ssn'],
  ])("is indeterminate for %s, because it cannot show a field is absent or present", (_name, text) => {
    expect(state({ kind: "body.field-absent", path: "password" }, [res(200, text)])).toBe("indeterminate");
    expect(state({ kind: "body.field-present", path: "id" }, [res(200, text)])).toBe("indeterminate");
  });
});

describe("leak pattern conditions", () => {
  const cases: Array<[Parameters<typeof matchesLeakPattern>[0], string, string]> = [
    ["stack-trace", "Error\n    at Object.handler (/srv/app/server.js:42:13)", "plain text"],
    ["stack-trace", "Traceback (most recent call last):\n  File", "plain text"],
    ["stack-trace", "at com.example.Service.run(Service.java:88)", "plain text"],
    ["sql-error", "SQLSTATE[42000]: Syntax error", "a syntax problem in your request"],
    ["sql-error", "You have an error in your SQL syntax near 'x'", "invalid input"],
    ["sql-error", "ORA-00933: SQL command not properly ended", "invalid input"],
    ["internal-path", "failed in /home/app/src/db.js", "see https://example.test/docs"],
    ["internal-path", "C:\\inetpub\\wwwroot\\api\\web.config", "see the manual"],
    ["server-banner", "Apache/2.4.41 (Ubuntu) Server at", "a generic error"],
    ["server-banner", "powered by Express/4.17.1", "a generic error"],
    ["secret-shaped-value", `token ${SECRET_SHAPED_RESPONSE_FIELD}`, "token abc"],
    ["secret-shaped-value", "-----BEGIN RSA PRIVATE KEY-----", "-----BEGIN CERTIFICATE-----"],
  ];

  it.each(cases)("%s is found in a body that has it and not in one that does not", (patternId, leaky, clean) => {
    expect(matchesLeakPattern(patternId, leaky)).toBe(true);
    expect(matchesLeakPattern(patternId, clean)).toBe(false);
    expect(state({ kind: "body.not-match-leak-pattern", patternId }, [res(500, leaky)])).toBe("violated");
    expect(state({ kind: "body.not-match-leak-pattern", patternId }, [res(400, clean)])).toBe("satisfied");
  });

  it("is indeterminate when the clean-looking body was cut off or is binary, because absence proves nothing about unread text", () => {
    const condition = { kind: "body.not-match-leak-pattern", patternId: "stack-trace" } as const;
    expect(state(condition, [res(500, "short", {}, true)])).toBe("indeterminate");
    expect(state(condition, [res(500, "bin\u0000ary")])).toBe("indeterminate");
    expect(state(condition, [res(500, "bin\uFFFDary")])).toBe("indeterminate");
    // A match is still a violation, even when the body was cut off.
    expect(state(condition, [res(500, "at Object.x (/a/b.js:1:2)", {}, true)])).toBe("violated");
  });

  it("stays fast on a large hostile body (the patterns are linear)", () => {
    const started = Date.now();
    for (const patternId of ["stack-trace", "sql-error", "internal-path", "server-banner", "secret-shaped-value"] as const) {
      matchesLeakPattern(patternId, `${"a ".repeat(100_000)}${"at ".repeat(50_000)}${"/".repeat(50_000)}`);
    }
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("repeat.limit-engaged", () => {
  const repeat = (count: number): Partial<SecurityScenarioContent> => ({ mutations: [{ kind: "request.repeat", count }], plannedRequestCount: count });
  const condition = (n: number) => ({ kind: "repeat.limit-engaged", withinRequests: n }) as const;

  it("is satisfied when a 429 appears within N requests", () => {
    expect(state(condition(5), [res(200), res(200), res(429), res(200), res(200)], repeat(5))).toBe("satisfied");
    expect(state(condition(5), [res(200), res(429)], repeat(5))).toBe("satisfied");
  });

  it("counts a status the specification documents for the limit", () => {
    expect(state(condition(3), [res(200), res(503), res(503)], { ...repeat(3), expected: { kind: "limited", statement: "s", basis: "documented", documentedStatusCodes: [503] } })).toBe("satisfied");
  });

  it("is violated when N requests were all answered and none was limited", () => {
    expect(state(condition(3), [res(200), res(200), res(200)], repeat(3))).toBe("violated");
  });

  it("is indeterminate when fewer than N were answered, because the limit might engage later", () => {
    expect(state(condition(5), [res(200), res(200)], repeat(5))).toBe("indeterminate");
  });

  it("only looks at the first N responses", () => {
    expect(state(condition(2), [res(200), res(200), res(429)], repeat(3))).toBe("violated");
  });
});

describe("persisted.field-unchanged", () => {
  const add: Partial<SecurityScenarioContent> = { mutations: [{ kind: "body.add-property", path: "", name: "role", valueKind: "protected-example" }] };
  const condition = { kind: "persisted.field-unchanged", path: "role" } as const;

  it("is satisfied when the request was refused, because nothing was persisted", () => {
    expect(state(condition, [res(400)], add)).toBe("satisfied");
    expect(state(condition, [res(403, "{}")], add)).toBe("satisfied");
  });

  it("is violated when the accepted request's response echoes the value that was sent", () => {
    expect(state(condition, [res(200, '{"role":"sl-protected-example"}')], add)).toBe("violated");
    expect(state(condition, [res(201, '{"user":{"role":"sl-protected-example"}}')], { mutations: [{ kind: "body.add-property", path: "user", name: "role", valueKind: "protected-example" }] })).toBe("indeterminate");
  });

  it("is indeterminate when the request was accepted and the response does not show the value, or cannot be read", () => {
    expect(state(condition, [res(200, '{"role":"user"}')], add)).toBe("indeterminate");
    expect(state(condition, [res(200, "")], add)).toBe("indeterminate");
    expect(state(condition, [res(200, "not json")], add)).toBe("indeterminate");
    expect(state(condition, [res(200, '{"role":"x"}')], { mutations: [] })).toBe("indeterminate");
  });
});

describe("scenario outcome precedence", () => {
  const results = (...states: ConditionResult["state"][]): ConditionResult[] => states.map((s) => ({ condition: { kind: "status.not-success" }, state: s }));

  it.each([
    [["satisfied", "satisfied"], "passed"],
    [["satisfied", "violated"], "failed"],
    [["indeterminate", "violated"], "failed"],
    [["satisfied", "indeterminate"], "inconclusive"],
    [["indeterminate"], "inconclusive"],
    [[], "inconclusive"],
  ] as const)("%j gives %s", (states, expected) => {
    expect(outcomeOf(results(...states))).toBe(expected);
  });

  it("never reports passed for a scenario with nothing to judge", () => {
    expect(outcomeOf([])).not.toBe("passed");
    expect(reasonFor("inconclusive", [])).toMatch(/no condition/);
  });

  it("words each reason from the conditions that decided it", () => {
    const failed = reasonFor("failed", [{ condition: { kind: "status.in-set", codes: [401, 403] }, state: "violated" }]);
    expect(failed).toBe("Expected the status is one of 401, 403, but that did not hold.");
    expect(reasonFor("inconclusive", [{ condition: { kind: "body.field-absent", path: "ssn" }, state: "indeterminate" }])).toBe("Could not judge whether the body has no ssn field.");
    expect(reasonFor("passed", [])).toBe("Every condition was satisfied.");
  });

  it("describes every condition kind with fixed words and no code", () => {
    const all: EvaluationCondition[] = [
      { kind: "status.not-success" },
      { kind: "status.in-set", codes: [401] },
      { kind: "status.equals", code: 200 },
      { kind: "status.not-equals", code: 500 },
      { kind: "header.present", name: "X" },
      { kind: "header.absent", name: "X" },
      { kind: "header.value-not-contains", name: "Server", token: "nginx" },
      { kind: "body.field-absent", path: "a" },
      { kind: "body.field-present", path: "a" },
      { kind: "body.not-match-leak-pattern", patternId: "stack-trace" },
      { kind: "repeat.limit-engaged", withinRequests: 5 },
      { kind: "persisted.field-unchanged", path: "a" },
    ];
    for (const condition of all) expect(describeCondition(condition).length).toBeGreaterThan(8);
  });
});

describe("the observed summary never holds a body excerpt (R14)", () => {
  it("describes a secret-shaped value by its path and never quotes it", () => {
    const body = JSON.stringify({ ok: true, profile: { note: SECRET_SHAPED_RESPONSE_FIELD, password: "hunter2-seed" }, token: SECRET_BEARER_TOKEN });
    const scenario = content({ mutations: [{ kind: "auth.omit" }], conditions: [{ kind: "status.not-success" }] });
    const results = evaluateConditions({ content: scenario, responses: [res(200, body)] });
    const observed = buildObservedSummary(scenario, [res(200, body)], results, [SECRET_BEARER_TOKEN]);
    expect(observed.statement).toBe("Status 200 for a request without credentials. Violated: the response is not a success (2xx). Secret-like value present at $.profile.note, $.profile.password, $.token.");
    assertNoSecrets("observed summary", JSON.stringify(observed), [SECRET_SHAPED_RESPONSE_FIELD, SECRET_BEARER_TOKEN, "hunter2-seed"]);
    expect(JSON.stringify(observed)).not.toContain('"ok"');
  });

  it("keeps a fixed set of response header names, redacts their values and bounds the statement", () => {
    const scenario = content({ conditions: [{ kind: "body.field-absent", path: "x".repeat(600) }] });
    const response = res(200, JSON.stringify({ [`${"x".repeat(600)}`]: 1 }), { "set-cookie": "sid=abc", server: "nginx", "www-authenticate": `Bearer ${SECRET_BEARER_TOKEN}` });
    const observed = buildObservedSummary(scenario, [response], evaluateConditions({ content: scenario, responses: [response] }), [SECRET_BEARER_TOKEN]);
    expect(Object.keys(observed.responseHeadersSelected).sort()).toEqual(["server", "www-authenticate"]);
    expect(observed.statement.length).toBeLessThanOrEqual(400);
    expect(JSON.stringify(observed)).not.toContain(SECRET_BEARER_TOKEN);
  });

  it("states a short, plain observation when nothing is wrong", () => {
    const scenario = content({ mutations: [{ kind: "auth.invalid-token" }], conditions: [{ kind: "status.not-success" }] });
    const observed = buildObservedSummary(scenario, [res(401)], [{ condition: { kind: "status.not-success" }, state: "satisfied" }], []);
    expect(observed).toEqual({ responseStatus: 401, responseHeadersSelected: {}, statement: "Status 401 for a request with an invalid token.", truncated: false });
  });
});

describe("the evaluator", () => {
  const scenario = content({ mutations: [{ kind: "auth.omit" }], conditions: [{ kind: "status.not-success" }] });

  it("fails a scenario whose condition is violated, with confidence and a reason", () => {
    const evaluation = evaluateScenario({ content: scenario, responses: [res(200, "{}")], plannedRequests: 1, secrets: [] });
    expect(evaluation).toMatchObject({ outcome: "failed", reason: "Expected the response is not a success (2xx), but that did not hold." });
    expect(evaluation.confidence?.level).toBeDefined();
  });

  it("passes only when every condition is satisfied, and gives no confidence for anything but a failure", () => {
    const passed = evaluateScenario({ content: scenario, responses: [res(401)], plannedRequests: 1, secrets: [] });
    expect(passed.outcome).toBe("passed");
    expect(passed.confidence).toBeUndefined();
    const inconclusive = evaluateScenario({ content: content({ conditions: [{ kind: "body.field-absent", path: "a" }] }), responses: [res(200, "text")], plannedRequests: 1, secrets: [] });
    expect(inconclusive.outcome).toBe("inconclusive");
    expect(inconclusive.confidence).toBeUndefined();
  });

  it("is deterministic: the same evidence gives an equal evaluation", () => {
    const input = { content: scenario, responses: [res(200, '{"a":1}', { server: "s" })], plannedRequests: 1, secrets: [] };
    expect(evaluateScenario(input)).toEqual(evaluateScenario(structuredClone(input)));
  });

  it("does not modify the evidence or the scenario", () => {
    const input = { content: structuredClone(scenario), responses: [res(200, '{"a":1}')], plannedRequests: 1, secrets: [] };
    const before = JSON.stringify(input);
    evaluateScenario(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
