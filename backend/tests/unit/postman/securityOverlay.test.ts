import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { EvaluationCondition, PostmanRequestItem, SecurityMutation } from "@apipilot/shared-domain";
import { securityAssertions, securityConditionLines } from "../../../src/postman/securityAssertionScripts";
import { INVALID_CREDENTIAL_VARIABLE, MALFORMED_CREDENTIAL_VARIABLE, applyAuthOverlay, identityLabel, identityVariableName, ownedResourceVariableName } from "../../../src/postman/securityOverlay";

function item(): PostmanRequestItem {
  return {
    id: "item-1",
    name: "GET /orders",
    request: {
      method: "GET",
      url: {
        raw: "{{baseUrl}}/orders?api_key={{apiKey}}&limit=5",
        host: ["{{baseUrl}}"],
        path: ["orders"],
        query: [{ key: "api_key", value: "{{apiKey}}" }, { key: "limit", value: "5" }],
        variable: [],
      },
      header: [{ key: "X-Session", value: "{{token}}" }, { key: "X-Trace", value: "t-1" }, { key: "X-Other", value: "{{notACredential}}" }],
      auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] },
    },
  };
}

const CREDENTIALS = new Set(["token", "apiKey"]);
const overlay = (mutations: SecurityMutation[]) => applyAuthOverlay(item(), mutations, CREDENTIALS);

describe("auth.omit", () => {
  it("removes the auth block and every credential header and query value, and nothing else", () => {
    const { item: result, variables } = overlay([{ kind: "auth.omit" }]);
    expect(result.request.auth).toBeUndefined();
    expect(result.request.header).toEqual([{ key: "X-Trace", value: "t-1" }, { key: "X-Other", value: "{{notACredential}}" }]);
    expect(result.request.url.query).toEqual([{ key: "limit", value: "5" }]);
    expect(result.request.url.raw).toBe("{{baseUrl}}/orders?limit=5");
    expect(variables).toEqual([]);
  });

  it("drops the query string entirely when a credential was its only member", () => {
    const base = item();
    base.request.url = { ...base.request.url, raw: "{{baseUrl}}/orders?api_key={{apiKey}}", query: [{ key: "api_key", value: "{{apiKey}}" }] };
    expect(applyAuthOverlay(base, [{ kind: "auth.omit" }], CREDENTIALS).item.request.url.raw).toBe("{{baseUrl}}/orders");
  });
});

describe("auth.invalid-token and auth.malformed", () => {
  it.each([
    ["auth.invalid-token", INVALID_CREDENTIAL_VARIABLE, "sl-invalid-credential"],
    ["auth.malformed", MALFORMED_CREDENTIAL_VARIABLE, "%%malformed%%"],
  ] as const)("%s points every credential at {{%s}}, a fixed non-secret example", (kind, variable, value) => {
    const { item: result, variables } = overlay([{ kind } as SecurityMutation]);
    expect(result.request.auth).toEqual({ type: "bearer", bearer: [{ key: "token", value: `{{${variable}}}`, type: "string" }] });
    expect(result.request.header[0]).toEqual({ key: "X-Session", value: `{{${variable}}}` });
    expect(result.request.url.query[0]).toEqual({ key: "api_key", value: `{{${variable}}}` });
    expect(result.request.url.raw).toBe(`{{baseUrl}}/orders?api_key={{${variable}}}&limit=5`);
    expect(variables).toEqual([expect.objectContaining({ name: variable, secret: false, value })]);
  });

  it("leaves a variable that is not a credential alone", () => {
    expect(overlay([{ kind: "auth.invalid-token" }]).item.request.header[2].value).toBe("{{notACredential}}");
  });
});

describe("auth.expired and identity.swap", () => {
  it("points each credential at the identity's expired variable, secret and empty", () => {
    const { item: result, variables } = overlay([{ kind: "auth.expired", identity: "any" }]);
    expect(result.request.auth).toEqual({ type: "bearer", bearer: [{ key: "token", value: "{{any_token_expired}}", type: "string" }] });
    expect(result.request.header[0].value).toBe("{{any_token_expired}}");
    expect(variables.map((variable) => [variable.name, variable.secret, variable.value])).toEqual([["any_apiKey_expired", true, ""], ["any_token_expired", true, ""]]);
  });

  it("switches each credential to the identity swapped to, secret and empty", () => {
    const { item: result, variables } = overlay([{ kind: "identity.swap", from: "owner", to: "other-user" }]);
    expect(result.request.auth).toEqual({ type: "bearer", bearer: [{ key: "token", value: "{{other_user_token}}", type: "string" }] });
    expect(result.request.url.query[0].value).toBe("{{other_user_apiKey}}");
    expect(variables.every((variable) => variable.secret && variable.value === "")).toBe(true);
    expect(variables.map((variable) => variable.name)).toEqual(["other_user_apiKey", "other_user_token"]);
  });

  it("never carries a value for a credential it introduces", () => {
    const { variables } = overlay([{ kind: "auth.expired", identity: "owner" }, { kind: "identity.swap", from: "owner", to: "restricted" }]);
    for (const variable of variables) expect(variable.value).toBe("");
  });
});

describe("the rest", () => {
  it("does not touch the item for a value-changing mutation, which was applied before it was built", () => {
    const mutations: SecurityMutation[] = [{ kind: "method.probe", method: "TRACE" }, { kind: "request.repeat", count: 3 }, { kind: "body.add-property", path: "", name: "x", valueKind: "string" }];
    expect(overlay(mutations)).toEqual({ item: item(), variables: [] });
  });

  it("does not modify the item it was given, and is deterministic", () => {
    const original = item();
    const before = JSON.stringify(original);
    const first = applyAuthOverlay(original, [{ kind: "identity.swap", from: "a", to: "b" }], CREDENTIALS);
    expect(JSON.stringify(original)).toBe(before);
    expect(applyAuthOverlay(item(), [{ kind: "identity.swap", from: "a", to: "b" }], CREDENTIALS)).toEqual(first);
  });

  it("makes variable names from role labels safely", () => {
    expect(identityLabel("Other-User")).toBe("other_user");
    expect(identityLabel("  --  ")).toBe("identity");
    expect(identityVariableName("other-user", "token")).toBe("other_user_token");
    expect(ownedResourceVariableName("owner", "order-id")).toBe("owner_order_id");
  });
});

// A minimal stand-in for Postman's `pm`, enough to run the generated scripts for real.
function runScript(lines: string[], response: { code: number; headers?: Record<string, string>; body?: unknown }): Array<{ name: string; passed: boolean }> {
  const results: Array<{ name: string; passed: boolean }> = [];
  const expectation = (actual: unknown) => {
    const make = (negate: boolean) => {
      const assert = (ok: boolean, message: string) => {
        if (ok === negate) throw new Error(message);
      };
      const chain = {
        equal: (expected: unknown) => assert(actual === expected, "equal"),
        include: (expected: unknown) => assert(Array.isArray(actual) && actual.includes(expected), "include"),
        be: { within: (low: number, high: number) => assert(typeof actual === "number" && actual >= low && actual <= high, "within") },
      };
      return chain;
    };
    return { to: { ...make(false), not: make(true) } };
  };
  const pm = {
    response: {
      code: response.code,
      headers: { has: (name: string) => Object.keys(response.headers ?? {}).some((key) => key.toLowerCase() === name.toLowerCase()) },
      json: () => {
        if (response.body === undefined) throw new Error("not json");
        return response.body;
      },
    },
    test: (name: string, body: () => void) => {
      try {
        body();
        results.push({ name, passed: true });
      } catch {
        results.push({ name, passed: false });
      }
    },
    expect: expectation,
  };
  runInNewContext(lines.join("\n"), { pm });
  return results;
}

const script = (condition: EvaluationCondition) => securityConditionLines(condition) as string[];

describe("assertion templates behave as their conditions say", () => {
  it.each([
    [200, false],
    [204, false],
    [401, true],
    [500, true],
  ])("status.not-success on %i passes: %s", (code, passes) => {
    expect(runScript(script({ kind: "status.not-success" }), { code })[0].passed).toBe(passes);
  });

  it("checks status sets, equality and inequality", () => {
    expect(runScript(script({ kind: "status.in-set", codes: [401, 403] }), { code: 403 })[0].passed).toBe(true);
    expect(runScript(script({ kind: "status.in-set", codes: [401, 403] }), { code: 404 })[0].passed).toBe(false);
    expect(runScript(script({ kind: "status.equals", code: 429 }), { code: 429 })[0].passed).toBe(true);
    expect(runScript(script({ kind: "status.not-equals", code: 500 }), { code: 500 })[0].passed).toBe(false);
    expect(runScript(script({ kind: "status.not-equals", code: 500 }), { code: 400 })[0].passed).toBe(true);
  });

  it("checks header presence case-insensitively", () => {
    expect(runScript(script({ kind: "header.present", name: "Strict-Transport-Security" }), { code: 200, headers: { "strict-transport-security": "x" } })[0].passed).toBe(true);
    expect(runScript(script({ kind: "header.absent", name: "X-Powered-By" }), { code: 200, headers: { "x-powered-by": "x" } })[0].passed).toBe(false);
    expect(runScript(script({ kind: "header.absent", name: "X-Powered-By" }), { code: 200, headers: {} })[0].passed).toBe(true);
  });

  it("checks a nested body field, and fails when the body is not JSON", () => {
    const body = { profile: { ssn: "x" }, id: 1 };
    expect(runScript(script({ kind: "body.field-present", path: "profile.ssn" }), { code: 200, body })[0].passed).toBe(true);
    expect(runScript(script({ kind: "body.field-absent", path: "profile.ssn" }), { code: 200, body })[0].passed).toBe(false);
    expect(runScript(script({ kind: "body.field-absent", path: "password" }), { code: 200, body })[0].passed).toBe(true);
    expect(runScript(script({ kind: "body.field-present", path: "id" }), { code: 200 })[0].passed).toBe(false);
  });
});

describe("assertion templates insert only validated values", () => {
  it.each([
    [{ kind: "status.equals", code: 99999 }],
    [{ kind: "status.equals", code: 20.5 }],
    [{ kind: "status.in-set", codes: [401, 99] }],
    [{ kind: "status.in-set", codes: [] }],
    [{ kind: "status.in-set", codes: Array.from({ length: 21 }, () => 401) }],
    [{ kind: "header.present", name: 'X"); alert(1); ("' }],
    [{ kind: "header.absent", name: "has space" }],
    [{ kind: "body.field-present", path: 'a"]; alert(1); //' }],
    [{ kind: "body.field-absent", path: "items[0].id" }],
    [{ kind: "body.field-absent", path: "" }],
    [{ kind: "body.field-absent", path: Array.from({ length: 11 }, () => "a").join(".") }],
  ] as Array<[EvaluationCondition]>)("refuses %j rather than writing it into a script", (condition) => {
    expect(securityConditionLines(condition)).toBeUndefined();
  });

  it("writes strings as JSON literals, so what is inserted cannot end the string", () => {
    const lines = script({ kind: "header.present", name: "X-Request-Id" }).join("\n");
    expect(lines).toContain('"X-Request-Id"');
    const path = script({ kind: "body.field-present", path: "$.a.b-c" }).join("\n");
    expect(path).toContain('["a","b-c"]');
  });

  it("has no template for the conditions it cannot express", () => {
    for (const condition of [
      { kind: "header.value-not-contains", name: "Server", token: "nginx" },
      { kind: "body.not-match-leak-pattern", patternId: "stack-trace" },
      { kind: "repeat.limit-engaged", withinRequests: 5 },
      { kind: "persisted.field-unchanged", path: "role" },
    ] as EvaluationCondition[]) {
      expect(securityConditionLines(condition)).toBeUndefined();
    }
  });

  it("builds one test event, and reports exactly what it could not express", () => {
    const result = securityAssertions([{ kind: "status.not-success" }, { kind: "body.not-match-leak-pattern", patternId: "sql-error" }, { kind: "header.absent", name: "Server" }]);
    expect(result.event?.listen).toBe("test");
    expect(result.event?.script.type).toBe("text/javascript");
    expect(result.expressed.map((condition) => condition.kind)).toEqual(["status.not-success", "header.absent"]);
    expect(result.notExpressed.map((condition) => condition.kind)).toEqual(["body.not-match-leak-pattern"]);
    expect(securityAssertions([{ kind: "repeat.limit-engaged", withinRequests: 3 }]).event).toBeUndefined();
  });

  it("runs end to end: the generated script is valid JavaScript for every template", () => {
    const all = securityAssertions([
      { kind: "status.not-success" },
      { kind: "status.in-set", codes: [401] },
      { kind: "status.equals", code: 401 },
      { kind: "status.not-equals", code: 200 },
      { kind: "header.present", name: "WWW-Authenticate" },
      { kind: "header.absent", name: "X-Powered-By" },
      { kind: "body.field-absent", path: "token" },
      { kind: "body.field-present", path: "error.message" },
    ]);
    const results = runScript(all.event?.script.exec ?? [], { code: 401, headers: { "www-authenticate": "Bearer" }, body: { error: { message: "no" } } });
    expect(results).toHaveLength(8);
    expect(results.every((result) => result.passed)).toBe(true);
  });
});
