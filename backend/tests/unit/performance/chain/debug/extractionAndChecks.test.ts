import { describe, expect, it } from "vitest";
import type { Extractor, StepCheck } from "@apipilot/shared-domain";
import { evaluateCheck, responseForChecks } from "../../../../../src/performance/chain/debug/checks";
import { extractValue, parseJsonBody, scalarText, statusOk, walkBody, type ExtractionResponse } from "../../../../../src/performance/chain/debug/extraction";

/** AP-039 (specs/039-chain-debug-run tasks T011; FR-005, FR-006, research R3). */

function response(bodyText: string, headers: Record<string, string> = {}, contentType: string | null = "application/json"): ExtractionResponse {
  return { status: 200, header: (name) => headers[name], contentType, bodyText };
}

const body = (id: string, path: string): Extractor => ({ id, name: `v_${id}`, source: { kind: "body", path } });
const header = (id: string, name: string): Extractor => ({ id, name: `v_${id}`, source: { kind: "header", name } });

function run(extractor: Extractor, res: ExtractionResponse, expected = true) {
  return extractValue(extractor, res, parseJsonBody(res.bodyText), expected);
}

describe("extractors: every failure has its own reason", () => {
  it("extracts a string, a number and a boolean", () => {
    const res = response('{"a":"x","b":{"c":[10,{"d":true}]}}');
    expect(run(body("x1", "a"), res)).toEqual({ ok: true, value: "x" });
    expect(run(body("x2", "b.c[0]"), res)).toEqual({ ok: true, value: "10" });
    expect(run(body("x3", "b.c[1].d"), res)).toEqual({ ok: true, value: "true" });
  });

  it("says extraction was not attempted when the status was not expected", () => {
    expect(run(body("x1", "a"), response('{"a":"x"}'), false)).toEqual({ ok: false, reason: { code: "not-extracted-status" } });
    expect(run(header("x2", "Location"), response("", { location: "/x" }), false)).toEqual({ ok: false, reason: { code: "not-extracted-status" } });
  });

  it("says the body is not JSON, with the content type for context", () => {
    expect(run(body("x1", "a"), response("<html>nope</html>", {}, "text/html"))).toEqual({ ok: false, reason: { code: "body-not-json", contentType: "text/html" } });
    expect(run(body("x1", "a"), response("", {}, null))).toEqual({ ok: false, reason: { code: "body-not-json", contentType: null } });
  });

  it("says the path was not found, with the path", () => {
    const res = response('{"access_token":"t"}');
    expect(run(body("x1", "token"), res)).toEqual({ ok: false, reason: { code: "path-not-found", path: "token" } });
    expect(run(body("x2", "access_token.deeper"), res)).toEqual({ ok: false, reason: { code: "path-not-found", path: "access_token.deeper" } });
    expect(run(body("x3", "[0]"), res).ok).toBe(false);
  });

  it("says the value is not a single text, number or boolean", () => {
    const res = response('{"o":{"a":1},"l":[1],"n":null,"e":""}');
    expect(run(body("x1", "o"), res)).toEqual({ ok: false, reason: { code: "value-not-scalar", found: "object" } });
    expect(run(body("x2", "l"), res)).toEqual({ ok: false, reason: { code: "value-not-scalar", found: "array" } });
    expect(run(body("x3", "n"), res)).toEqual({ ok: false, reason: { code: "value-not-scalar", found: "null" } });
    expect(run(body("x4", "e"), res)).toEqual({ ok: false, reason: { code: "value-not-scalar", found: "empty-text" } });
  });

  it("says a header is missing, with its name, and finds one regardless of case", () => {
    expect(run(header("x1", "Location"), response("{}"))).toEqual({ ok: false, reason: { code: "header-missing", header: "Location" } });
    expect(run(header("x2", "Location"), response("{}", { location: "/x/1" }))).toEqual({ ok: true, value: "/x/1" });
    expect(run(header("x3", "X-Empty"), response("{}", { "x-empty": "" }))).toEqual({ ok: false, reason: { code: "value-not-scalar", found: "empty-text" } });
  });
});

describe("the path walk is the runtime's own", () => {
  it("reads own entries only, and a numeric part needs an array", () => {
    expect(walkBody({ a: [1, 2] }, [{ field: "a" }, { index: 1 }])).toEqual({ found: true, value: 2 });
    expect(walkBody({ a: { 0: "x" } }, [{ field: "a" }, { index: 0 }])).toEqual({ found: false });
    expect(walkBody({ a: [1] }, [{ field: "a" }, { index: 5 }])).toEqual({ found: false });
    expect(walkBody({}, [{ field: "toString" }])).toEqual({ found: false });
    expect(walkBody("text", [{ field: "a" }])).toEqual({ found: false });
  });

  it("scalar text and status matching", () => {
    expect(scalarText("a")).toBe("a");
    expect(scalarText("")).toBeUndefined();
    expect(scalarText(0)).toBe("0");
    expect(scalarText(false)).toBe("false");
    expect(scalarText(null)).toBeUndefined();
    expect(statusOk(204, ["200", "2XX"])).toBe(true);
    expect(statusOk(404, ["2XX", "201"])).toBe(false);
    expect(statusOk(200, [])).toBe(false);
    expect(statusOk(0, ["2XX"])).toBe(false);
  });
});

describe("checks", () => {
  const res = responseForChecks(120, '{"a":{"b":3},"name":"Ada","on":true}');
  const check = (value: StepCheck) => evaluateCheck(value, res, "Ada");

  it("evaluates each kind and says what was compared", () => {
    expect(check({ id: "k1", kind: "field-exists", path: "a.b" })).toMatchObject({ passed: true, detail: "Field a.b is present." });
    expect(check({ id: "k2", kind: "field-exists", path: "a.z" })).toMatchObject({ passed: false, detail: "Field a.z is not present." });
    expect(check({ id: "k3", kind: "field-equals", path: "a.b", expected: { type: "number", value: 3 } }).passed).toBe(true);
    expect(check({ id: "k4", kind: "field-equals", path: "a.b", expected: { type: "number", value: 4 } }).passed).toBe(false);
    expect(check({ id: "k5", kind: "field-equals", path: "name", expected: { type: "text", value: "{{n}}" } }).passed).toBe(true);
    expect(evaluateCheck({ id: "k6", kind: "field-equals", path: "name", expected: { type: "text", value: "x" } }, res, "Bob").passed).toBe(false);
    expect(check({ id: "k7", kind: "field-equals", path: "on", expected: { type: "boolean", value: true } }).passed).toBe(true);
    expect(check({ id: "k8", kind: "body-contains", text: "Ada" }).passed).toBe(true);
    expect(check({ id: "k9", kind: "body-contains", text: "Zed" }).passed).toBe(false);
    expect(check({ id: "k10", kind: "time-at-most", maxMs: 200 })).toMatchObject({ passed: true, detail: "The response took 120 ms; the limit is 200 ms." });
    expect(check({ id: "k11", kind: "time-at-most", maxMs: 100 }).passed).toBe(false);
  });

  it("says when the body is not JSON, and never repeats a body value or expected text", () => {
    const notJson = responseForChecks(1, "<html>");
    const outcome = evaluateCheck({ id: "k1", kind: "field-exists", path: "a" }, notJson, "");
    expect(outcome).toMatchObject({ passed: false, detail: "Field a is not present (the body is not JSON)." });
    const equals = evaluateCheck({ id: "k2", kind: "field-equals", path: "name", expected: { type: "text", value: "{{secret}}" } }, res, "top-secret-expected");
    expect(JSON.stringify(equals)).not.toContain("top-secret-expected");
    expect(JSON.stringify(equals)).not.toContain("{{secret}}");
    expect(JSON.stringify(equals)).not.toContain("Ada");
  });
});
