import { describe, expect, it } from "vitest";
import { dynamicValue } from "../../../../../src/performance/chain/debug/dynamicValues";
import { buildRequest, fill, preparePlan, type ResolveContext } from "../../../../../src/performance/chain/debug/resolveRequest";
import { chain, chainPlan, step } from "../../../../fixtures/chain/chainPlans";

/** AP-039 (specs/039-chain-debug-run tasks T010, T011; research R2). Parity with the runtime is in debugParity.test.ts. */

const NOW = Date.parse("2026-09-27T12:00:00.000Z");

function contextOf(plan: ReturnType<typeof chainPlan>, environment: Record<string, string>, columns: Record<string, string> = {}, vu = 1): ResolveContext {
  return {
    prepared: preparePlan(plan),
    values: { environment: (name) => (environment[name] === "" ? undefined : environment[name]), column: (name) => columns[name] },
    dynamic: { vu, iteration: 0, runTag: "", nowMs: () => NOW },
  };
}

describe("dynamic values", () => {
  const base = { vu: 1, iteration: 0, runTag: "ab12cd", nowMs: () => NOW };

  it("gives the same value for the same inputs and a different one for another occurrence or virtual user", () => {
    expect(dynamicValue("$randomEmail", 0, base)).toBe(dynamicValue("$randomEmail", 0, base));
    expect(dynamicValue("$randomEmail", 0, base)).not.toBe(dynamicValue("$randomEmail", 1, base));
    expect(dynamicValue("$guid", 0, base)).not.toBe(dynamicValue("$guid", 0, { ...base, vu: 0 }));
  });

  it("reads the injected clock and the run tag, and returns nothing for an unknown name", () => {
    expect(dynamicValue("$timestamp", 0, base)).toBe(String(Math.floor(NOW / 1000)));
    expect(dynamicValue("$isoTimestamp", 0, base)).toBe("2026-09-27T12:00:00.000Z");
    expect(dynamicValue("$guid", 0, base)).toContain("ab1");
    expect(dynamicValue("$guid", 0, { ...base, runTag: "" })).toContain("-4000-8000-");
    expect(dynamicValue("$notAThing", 0, base)).toBe("");
  });
});

describe("reference filling", () => {
  const plan = chainPlan({ chains: [chain("c1", "C", [step({ id: "s1", url: "{{baseUrl}}/a/{{id}}" })])] });

  it("encodes a value in a URL, but not baseUrl, and escapes it for a JSON body", () => {
    const context = contextOf(plan, { baseUrl: "http://h:1", id: "a b/c", note: 'say "hi"\n' });
    const scope = { vars: new Map<string, string>() };
    expect(fill("{{baseUrl}}/x/{{id}}", scope, context, "url")).toBe("http://h:1/x/a%20b%2Fc");
    expect(fill('{"n":"{{note}}"}', scope, context, "json")).toBe('{"n":"say \\"hi\\"\\n"}');
    expect(fill("{{id}}", scope, context, "raw")).toBe("a b/c");
  });

  it("looks a name up in extracted values, then dynamic values, then data columns, then the environment, then gives nothing", () => {
    const withDynamic = chainPlan({ chains: [chain("c1", "C", [step({ id: "s1", url: "{{baseUrl}}/{{$guid}}" })])] });
    const context = contextOf(withDynamic, { baseUrl: "http://h", name: "env", only_env: "e" }, { name: "column", only_col: "c" });
    const token = [...context.prepared.tokens.keys()][0];
    const scope = { vars: new Map([["name", "extracted"]]) };
    expect(fill("{{name}}", scope, context, "raw")).toBe("extracted");
    expect(fill("{{name}}", { vars: new Map() }, context, "raw")).toBe("column");
    expect(fill("{{only_env}}", scope, context, "raw")).toBe("e");
    expect(fill("{{missing}}", scope, context, "raw")).toBe("");
    expect(fill(`{{${token}}}`, scope, context, "raw")).toMatch(/^[0-9a-f]{8}-/);
  });

  it("treats an empty environment value as absent", () => {
    const context = contextOf(plan, { baseUrl: "http://h", id: "" }, {});
    expect(fill("[{{id}}]", { vars: new Map() }, context, "raw")).toBe("[]");
  });
});

describe("numbering of dynamic occurrences", () => {
  it("counts in the renderer's order: URL, query names and values, header values, body, then checks, over every step in plan order", () => {
    const plan = chainPlan({
      chains: [
        chain("c1", "C1", [
          step({
            id: "s1",
            url: "{{baseUrl}}/{{$guid}}",
            query: [{ name: "{{$randomInt}}", value: "{{$randomColor}}" }],
            headers: [{ name: "X", value: "{{$randomCity}}" }],
            method: "POST",
            body: { kind: "raw", contentType: "text/plain", text: "{{$randomMonth}}" },
            checks: [{ id: "k1", kind: "field-equals", path: "a", expected: { type: "text", value: "{{$randomWeekday}}" } }],
          }),
        ]),
        chain("c2", "C2", [step({ id: "s2", url: "{{baseUrl}}/{{$randomCountry}}" })]),
      ],
    });
    const { tokens } = preparePlan(plan);
    expect([...tokens.values()].map((entry) => entry.kind)).toEqual(["$guid", "$randomInt", "$randomColor", "$randomCity", "$randomMonth", "$randomWeekday", "$randomCountry"]);
    expect([...tokens.values()].map((entry) => entry.k)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("building a request", () => {
  it("encodes query pairs, joins form fields and sets the content type only when no header does", () => {
    const plan = chainPlan({
      chains: [
        chain("c1", "C", [
          step({ id: "s1", method: "POST", url: "{{baseUrl}}/a", query: [{ name: "q q", value: "a&b" }], body: { kind: "form", fields: [{ name: "n", value: "é" }] } }),
          step({ id: "s2", method: "POST", url: "{{baseUrl}}/b", headers: [{ name: "Content-Type", value: "text/plain" }], body: { kind: "raw", contentType: "application/json", text: "x" } }),
          step({ id: "s3", method: "POST", url: "{{baseUrl}}/c", body: { kind: "raw", contentType: "application/json", text: '{"v":"{{v}}"}' } }),
        ]),
      ],
    });
    const context = contextOf(plan, { baseUrl: "http://h", v: 'a"b' });
    const scope = { vars: new Map<string, string>() };
    const [s1, s2, s3] = ["s1", "s2", "s3"].map((id) => buildRequest(context.prepared.steps.get(id)!, scope, context));
    expect(s1).toEqual({ method: "POST", url: "http://h/a?q%20q=a%26b", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "n=%C3%A9" });
    expect(s2.headers).toEqual({ "Content-Type": "text/plain" });
    expect(s3.body).toBe('{"v":"a\\"b"}');
    expect(s3.headers).toEqual({ "Content-Type": "application/json" });
  });
});
