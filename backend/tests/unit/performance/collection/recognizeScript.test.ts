import { describe, expect, it } from "vitest";
import { MAX_EXCERPT_LENGTH, recognizeScript } from "../../../../src/performance/collection/recognizeScript";

/** AP-036 research R5, FR-005 to FR-007, FR-010 (tasks T022). */

function kinds(text: string): string[] {
  return recognizeScript(text).findings.map((finding) => finding.kind);
}

describe("recognizeScript setters", () => {
  it.each([
    ['pm.environment.set("t", pm.response.json().access_token);', "environment"],
    ['pm.collectionVariables.set("t", pm.response.json().access_token);', "collectionVariables"],
    ['pm.globals.set("t", pm.response.json().access_token);', "globals"],
    ['pm.variables.set("t", pm.response.json().access_token);', "variables"],
    ['postman.setEnvironmentVariable("t", JSON.parse(responseBody).access_token);', "environment"],
    ['postman.setGlobalVariable("t", JSON.parse(responseBody).access_token);', "globals"],
  ])("recognises %s with its scope", (text, scope) => {
    const { setters, findings } = recognizeScript(text);
    expect(findings).toEqual([]);
    expect(setters).toEqual([{ name: "t", scope, source: { kind: "body", path: "access_token", segments: [{ field: "access_token" }] }, line: 1, excerpt: text }]);
  });

  it("reads body paths by property names and literal indices, and headers by their literal name, lowercased", () => {
    const { setters } = recognizeScript(
      [
        'pm.environment.set("a", pm.response.json().data.items[0]["the id"]);',
        'pm.environment.set("b", pm.response.headers.get("ETag"));',
        'pm.environment.set("c", postman.getResponseHeader("X-Request-Id"));',
      ].join("\n"),
    );
    expect(setters.map((setter) => [setter.name, setter.source, setter.line])).toEqual([
      ["a", { kind: "body", path: "data.items[0].the id", segments: [{ field: "data" }, { field: "items" }, { index: 0 }, { field: "the id" }] }, 1],
      ["b", { kind: "header", name: "etag" }, 2],
      ["c", { kind: "header", name: "x-request-id" }, 3],
    ]);
  });

  it("follows a local name assigned once from the body, with const, let or var, and not one assigned again", () => {
    for (const keyword of ["const", "let", "var"]) {
      const { setters, findings } = recognizeScript(`${keyword} body = pm.response.json();\npm.collectionVariables.set("customer_id", body.id);`);
      expect(findings).toEqual([]);
      expect(setters.map((setter) => [setter.name, setter.source])).toEqual([["customer_id", { kind: "body", path: "id", segments: [{ field: "id" }] }]]);
    }
    const reassigned = recognizeScript('let body = pm.response.json();\nbody = {};\npm.environment.set("id", body.id);');
    expect(reassigned.setters).toEqual([]);
    expect(reassigned.findings.map((finding) => [finding.kind, finding.line])).toEqual([
      ["unsupported-statement", 1],
      ["unsupported-statement", 2],
      ["computed-value", 3],
    ]);
    const parsed = recognizeScript('var json = JSON.parse(responseBody);\npostman.setEnvironmentVariable("token", json.token);');
    expect(parsed.setters.map((setter) => setter.name)).toEqual(["token"]);
  });

  it("recognises statements directly inside a top-level pm.test callback, function or arrow", () => {
    const { setters, assertions, findings } = recognizeScript(
      [
        'pm.test("created", function () {',
        "  pm.response.to.have.status(201);",
        '  const body = pm.response.json();',
        '  pm.environment.set("id", body.id);',
        "});",
        'pm.test("ok", () => pm.response.to.be.success);',
        'pm.test("arrow", () => { pm.environment.set("name", pm.response.json().name); });',
      ].join("\n"),
    );
    expect(findings).toEqual([]);
    expect(setters.map((setter) => [setter.name, setter.line])).toEqual([
      ["id", 4],
      ["name", 7],
    ]);
    expect(assertions).toEqual([
      { codes: ["201"], line: 2 },
      { codes: ["2XX"], line: 6 },
    ]);
  });

  it("parses a top-level return, which Postman allows", () => {
    expect(recognizeScript('pm.environment.set("a", pm.response.json().a);\nreturn;').setters.map((setter) => setter.name)).toEqual(["a"]);
  });
});

describe("recognizeScript findings", () => {
  it.each([
    ['if (pm.response.code === 200) { pm.environment.set("etag", pm.response.headers.get("ETag")); }', ["condition"]],
    ['switch (x) { case 1: pm.environment.set("a", pm.response.json().a); }', ["condition"]],
    ['for (const item of pm.response.json().items) { pm.environment.set("a", item.id); }', ["loop"]],
    ['while (false) pm.environment.set("a", pm.response.json().a);', ["loop"]],
    ['function f() { pm.environment.set("a", pm.response.json().a); }', ["function"]],
    ['try { pm.environment.set("a", pm.response.json().a); } catch (e) { console.log(e); }', ["try", "try"]],
    ['pm.environment.set(name, pm.response.json().a);', ["computed-name"]],
    ['pm.environment.set("a{b}", pm.response.json().a);', ["computed-name"]],
    ['pm.environment.set("a", "literal");', ["computed-value"]],
    ['pm.environment.set("a", pm.response.json());', ["computed-value"]],
    ['pm.environment.set("a", String(pm.response.json().a));', ["computed-value"]],
    ['pm.environment.set("a", pm.response.json()?.a);', ["computed-value"]],
    ['pm.sendRequest("http://x", function (err, res) { pm.environment.set("t", res.json().t); });', ["send-request", "function"]],
    ['pm.setNextRequest("Login");', ["set-next-request"]],
    ['postman.setNextRequest(null);', ["set-next-request"]],
    ['pm.execution.setNextRequest("Login");', ["set-next-request"]],
    ["pm.execution.skipRequest();", ["skip-request"]],
    ['pm.environment.set("a", pm.iterationData.get("a"));', ["iteration-data"]],
    ['pm.environment.set("a", data.a);', ["iteration-data"]],
    ['pm.environment.unset("a");', ["unset"]],
    ["pm.collectionVariables.clear();", ["unset"]],
    ['postman.clearEnvironmentVariable("a");', ["unset"]],
    ['pm.expect(pm.response.json().name).to.eql("Ada");', ["assertion-not-converted"]],
    ['tests["ok"] = responseCode.code === 200;', ["assertion-not-converted"]],
    ['console.log("done");', ["no-effect"]],
    ["const x = 5;", ["unsupported-statement"]],
    ['setTimeout(() => { pm.environment.set("a", pm.response.json().a); }, 10);', ["unsupported-statement", "function"]],
    ["setTimeout(() => {}, 10);", ["unsupported-statement"]],
    ['{ pm.environment.set("a", pm.response.json().a); }', ["unsupported-statement"]],
  ])("lists %s as %j", (text, expected) => {
    const result = recognizeScript(text);
    expect(result.setters).toEqual([]);
    expect(result.findings.map((finding) => finding.kind)).toEqual(expected);
  });

  it("names the variable of a computed value, never a value", () => {
    expect(recognizeScript('pm.environment.set("token", "s3cret");').findings).toEqual([
      { kind: "computed-value", line: 1, column: null, excerpt: 'pm.environment.set("token", "s3cret");', detail: "token" },
    ]);
  });

  it("does not convert a statement after one that can return or throw", () => {
    const result = recognizeScript('if (pm.response.code !== 200) return;\npm.environment.set("a", pm.response.json().a);');
    expect(result.setters).toEqual([]);
    expect(result.findings.map((finding) => [finding.kind, finding.line])).toEqual([
      ["condition", 1],
      ["condition", 2],
    ]);
  });

  it("lists statements of a nested pm.test as inside a function, and lists them on their own lines", () => {
    expect(kinds('pm.test("outer", () => { pm.test("inner", () => { pm.environment.set("a", pm.response.json().a); }); });')).toEqual(["function", "function"]);
  });

  it("reports an unreadable script once, with acorn's line and column, and converts nothing", () => {
    const result = recognizeScript('pm.environment.set("a", pm.response.json().a);\npm.test("x", () => {');
    expect(result.setters).toEqual([]);
    expect(result.findings).toEqual([{ kind: "unreadable-script", line: 2, column: 21, excerpt: null, detail: null }]);
  });

  it("keeps excerpts to at most 160 characters, and is a pure function of the text in source order", () => {
    const long = `console.log("${"x".repeat(300)}");`;
    const excerpt = recognizeScript(long).findings[0].excerpt!;
    expect(excerpt.length).toBe(MAX_EXCERPT_LENGTH);
    expect(excerpt.endsWith("…")).toBe(true);
    const text = 'console.log(1);\npm.environment.set("a", pm.response.json().a);\npm.setNextRequest(null);\npm.response.to.have.status(200);';
    expect(recognizeScript(text)).toEqual(recognizeScript(text));
    expect(recognizeScript(text).findings.map((finding) => finding.line)).toEqual([1, 3]);
  });

  it("recognises nothing in an empty script", () => {
    expect(recognizeScript("  \n ")).toEqual({ setters: [], assertions: [], findings: [] });
  });
});
