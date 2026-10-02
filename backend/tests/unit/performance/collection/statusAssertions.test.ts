import { parse } from "acorn";
import { describe, expect, it } from "vitest";
import { intersectStatuses, readStatusAssertion } from "../../../../src/performance/collection/statusAssertions";
import type { EsNode } from "../../../../src/performance/userScript/numericGuarantee";

/** AP-036 research R7, FR-011, FR-012 (tasks T023). */

function read(expression: string) {
  const program = parse(expression, { ecmaVersion: "latest", sourceType: "script" }) as unknown as { body: { expression: EsNode }[] };
  return readStatusAssertion(program.body[0].expression);
}

describe("readStatusAssertion", () => {
  it.each([
    ["pm.response.to.have.status(201)", ["201"]],
    ["pm.response.to.be.status(204)", ["204"]],
    ["pm.response.to.be.ok", ["200"]],
    ["pm.response.to.have.ok", ["200"]],
    ["pm.response.to.be.accepted", ["202"]],
    ["pm.response.to.be.withoutContent", ["204"]],
    ["pm.response.to.be.badRequest", ["400"]],
    ["pm.response.to.be.unauthorised", ["401"]],
    ["pm.response.to.be.unauthorized", ["401"]],
    ["pm.response.to.be.forbidden", ["403"]],
    ["pm.response.to.be.notFound", ["404"]],
    ["pm.response.to.be.notAcceptable", ["406"]],
    ["pm.response.to.be.rateLimited", ["429"]],
    ["pm.response.to.be.info", ["1XX"]],
    ["pm.response.to.be.success", ["2XX"]],
    ["pm.response.to.be.redirection", ["3XX"]],
    ["pm.response.to.be.clientError", ["4XX"]],
    ["pm.response.to.be.serverError", ["5XX"]],
    ["pm.expect(pm.response.code).to.eql(200)", ["200"]],
    ["pm.expect(pm.response.code).to.equal(201)", ["201"]],
    ["pm.expect(pm.response.code).to.equals(202)", ["202"]],
    ["pm.expect(pm.response.code).to.eq(204)", ["204"]],
    ["pm.expect(pm.response.code).to.be.eql(200)", ["200"]],
    ["pm.expect(pm.response.code).to.be.oneOf([201, 200, 201])", ["200", "201"]],
  ])("reads %s as %j", (expression, codes) => {
    expect(read(expression)).toEqual({ kind: "status", codes });
  });

  it.each([
    "pm.response.to.not.have.status(200)",
    "pm.expect(pm.response.code).to.not.eql(200)",
    "pm.expect(pm.response.code).not.to.eql(200)",
    'pm.response.to.have.status("OK")',
    "pm.response.to.have.status(999)",
    "pm.response.to.have.jsonBody('id')",
    "pm.expect(pm.response.json().id).to.eql(1)",
    "pm.expect(pm.response.code).to.be.above(199)",
    "pm.expect(pm.response.code).to.be.oneOf([200, code])",
    "pm.response.to.be.json",
  ])("lists %s as an assertion that is not converted", (expression) => {
    expect(read(expression)).toEqual({ kind: "not-converted" });
  });

  it("is not an assertion for any other expression", () => {
    expect(read("pm.environment.set('a', 1)")).toBeNull();
    expect(read("console.log(pm.response.code)")).toBeNull();
  });
});

describe("intersectStatuses", () => {
  it("intersects exact codes and classes: an exact code is inside a class when it shares the first digit", () => {
    expect(intersectStatuses([])).toEqual([]);
    expect(intersectStatuses([["201"]])).toEqual(["201"]);
    expect(intersectStatuses([["2XX"], ["201"]])).toEqual(["201"]);
    expect(intersectStatuses([["201"], ["2XX"]])).toEqual(["201"]);
    expect(intersectStatuses([["2XX"], ["2XX"]])).toEqual(["2XX"]);
    expect(intersectStatuses([["200", "201"], ["201", "204"]])).toEqual(["201"]);
    expect(intersectStatuses([["2XX"], ["4XX"]])).toEqual([]);
    expect(intersectStatuses([["200"], ["201"]])).toEqual([]);
  });
});
