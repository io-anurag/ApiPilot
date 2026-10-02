import { compareCodeUnits } from "../../postman/ordering";
import { children, isNode, type EsNode } from "../userScript/numericGuarantee";

/**
 * AP-036 (specs/036-collection-performance-test research R7, FR-011, FR-012): a collection test's
 * status assertions, matched against the closed table chai-postman defines, and nothing else. Read
 * from an acorn AST; never evaluated. Pure.
 *
 * | Form | Codes |
 * |---|---|
 * | `pm.response.to.have.status(<int>)`, `pm.response.to.be.status(<int>)` | that code |
 * | `pm.response.to.be.ok`, `pm.response.to.have.ok` | 200 |
 * | `pm.response.to.be.<named>` | chai-postman's code |
 * | `pm.response.to.be.<class>` | `1XX` to `5XX` |
 * | `pm.expect(pm.response.code).to[.be].<eql\|equal\|equals\|eq>(<int>)` | that code |
 * | `pm.expect(pm.response.code).to.be.oneOf([<int>, ...])` | those codes |
 *
 * `.not`, `status("<reason>")` and every other `pm.expect` or `pm.response.to` chain are
 * assertions that are not converted.
 */
export type AssertionReading = { kind: "status"; codes: string[] } | { kind: "not-converted" } | null;

const NAMED: Readonly<Record<string, string>> = {
  accepted: "202",
  withoutContent: "204",
  badRequest: "400",
  unauthorised: "401",
  unauthorized: "401",
  forbidden: "403",
  notFound: "404",
  notAcceptable: "406",
  rateLimited: "429",
};

const CLASSES: Readonly<Record<string, string>> = { info: "1XX", success: "2XX", redirection: "3XX", clientError: "4XX", serverError: "5XX" };
const EQUALITY: ReadonlySet<string> = new Set(["eql", "equal", "equals", "eq"]);

/** A dotted chain of plain property names from a root node: `pm.response.to.be.ok` is `pm` and `[response, to, be, ok]`. */
export function memberChain(node: EsNode): { root: EsNode; names: string[] } | null {
  const names: string[] = [];
  let current = node;
  while (current.type === "MemberExpression") {
    const property = current.property;
    if (current.computed === true || !isNode(property) || property.type !== "Identifier") return null;
    names.unshift(String(property.name));
    current = current.object as EsNode;
  }
  return { root: current, names };
}

export function isIdentifier(node: unknown, name: string): boolean {
  return isNode(node) && node.type === "Identifier" && node.name === name;
}

/** `pm.<names...>`, exactly. */
export function isPmPath(node: EsNode, ...names: string[]): boolean {
  const chain = memberChain(node);
  return chain !== null && isIdentifier(chain.root, "pm") && chain.names.length === names.length && chain.names.every((name, index) => name === names[index]);
}

function statusCode(node: unknown): string | null {
  if (!isNode(node) || node.type !== "Literal" || typeof node.value !== "number") return null;
  const value = node.value;
  return Number.isInteger(value) && value >= 100 && value <= 599 ? String(value) : null;
}

/** The chain's root `pm.expect(<arg>)` call, if it is one. */
function expectArgument(root: EsNode): EsNode | null | undefined {
  if (root.type !== "CallExpression" || !isPmPath(root.callee as EsNode, "expect")) return undefined;
  const args = children(root, "arguments");
  return args.length === 1 ? args[0] : null;
}

function readCall(call: EsNode): AssertionReading {
  const chain = memberChain(call.callee as EsNode);
  if (!chain) return null;
  const args = children(call, "arguments");
  if (isIdentifier(chain.root, "pm") && chain.names[0] === "response" && chain.names[1] === "to") {
    const rest = chain.names.slice(2);
    if (rest.length === 2 && (rest[0] === "have" || rest[0] === "be") && rest[1] === "status" && args.length === 1) {
      const code = statusCode(args[0]);
      return code ? { kind: "status", codes: [code] } : { kind: "not-converted" };
    }
    return { kind: "not-converted" };
  }
  const argument = expectArgument(chain.root);
  if (argument === undefined) return null;
  if (argument === null || !isPmPath(argument, "response", "code") || chain.names.includes("not")) return { kind: "not-converted" };
  const words = chain.names;
  const last = words[words.length - 1];
  const lead = words.slice(0, -1);
  const leadOk = (lead.length === 1 && lead[0] === "to") || (lead.length === 2 && lead[0] === "to" && lead[1] === "be");
  if (leadOk && EQUALITY.has(last) && args.length === 1) {
    const code = statusCode(args[0]);
    return code ? { kind: "status", codes: [code] } : { kind: "not-converted" };
  }
  if (lead.length === 2 && lead[0] === "to" && lead[1] === "be" && last === "oneOf" && args.length === 1 && args[0].type === "ArrayExpression") {
    const elements = (args[0].elements as unknown[]) ?? [];
    const codes = elements.map(statusCode);
    if (codes.length > 0 && codes.every((code): code is string => code !== null)) return { kind: "status", codes: [...new Set(codes)].sort(compareCodeUnits) };
  }
  return { kind: "not-converted" };
}

function readMember(member: EsNode): AssertionReading {
  const chain = memberChain(member);
  if (!chain) return null;
  if (expectArgument(chain.root) !== undefined) return { kind: "not-converted" };
  if (!isIdentifier(chain.root, "pm") || chain.names[0] !== "response" || chain.names[1] !== "to") return null;
  const rest = chain.names.slice(2);
  if (rest.length !== 2) return { kind: "not-converted" };
  const [verb, word] = rest;
  if (word === "ok" && (verb === "be" || verb === "have")) return { kind: "status", codes: ["200"] };
  if (verb === "be" && NAMED[word]) return { kind: "status", codes: [NAMED[word]] };
  if (verb === "be" && CLASSES[word]) return { kind: "status", codes: [CLASSES[word]] };
  return { kind: "not-converted" };
}

/**
 * What one expression asserts about the status: its codes, an assertion that is not converted, or
 * `null` when it is not an assertion at all.
 */
export function readStatusAssertion(expression: EsNode): AssertionReading {
  if (expression.type === "CallExpression") return readCall(expression);
  if (expression.type === "MemberExpression") return readMember(expression);
  return null;
}

const RANGE = /^[1-5]XX$/;

function intersectTwo(a: readonly string[], b: readonly string[]): string[] {
  const result = new Set<string>();
  for (const left of a) {
    for (const right of b) {
      if (left === right) result.add(left);
      else if (RANGE.test(right) && !RANGE.test(left) && left[0] === right[0]) result.add(left);
      else if (RANGE.test(left) && !RANGE.test(right) && left[0] === right[0]) result.add(right);
    }
  }
  return [...result].sort(compareCodeUnits);
}

/**
 * Every recognised assertion must pass in Postman, so a step's expected set is their intersection
 * (R7). An exact code is inside a class when it shares the first digit. No assertion gives `[]`.
 */
export function intersectStatuses(sets: readonly (readonly string[])[]): string[] {
  if (sets.length === 0) return [];
  return sets.slice(1).reduce<string[]>((current, next) => intersectTwo(current, next), [...new Set(sets[0])].sort(compareCodeUnits));
}
