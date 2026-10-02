import type { BodyPathSegment, CaptureSource, FindingKind } from "@apipilot/shared-domain";
import { parse } from "acorn";
import { formatCapturePath } from "../plan/capturePath";
import { childEntries, children, isNode, type EsNode } from "../userScript/numericGuarantee";
import { isIdentifier, isPmPath, memberChain, readStatusAssertion } from "./statusAssertions";

/**
 * AP-036 (specs/036-collection-performance-test research R5, FR-005 to FR-007, FR-010, FR-011): a
 * collection test script read as text against a closed grammar. Acorn parses it; nothing is ever
 * evaluated, and no expression from it reaches a script except as the data below.
 *
 * Only statements at the top level of the script, or directly inside the callback of a top-level
 * `pm.test(<any>, <function>)`, are recognised, so a recognised statement is unconditional:
 *
 * ```text
 * statement := setter | alias | test | assertion | inert
 * setter    := SCOPE ".set(" STRING "," value ")"
 *            | "postman.setEnvironmentVariable(" STRING "," value ")" | "postman.setGlobalVariable(" STRING "," value ")"
 * SCOPE     := "pm.environment" | "pm.collectionVariables" | "pm.globals" | "pm.variables"
 * value     := body path+ | header
 * body      := "pm.response.json()" | "JSON.parse(responseBody)" | ALIAS
 * path      := "." IDENT | "[" STRING "]" | "[" NON_NEGATIVE_INT "]"
 * header    := "pm.response.headers.get(" STRING ")" | "postman.getResponseHeader(" STRING ")"
 * alias     := ("const" | "let" | "var") IDENT "=" body          ; one declarator, never assigned again
 * assertion := see statusAssertions.ts
 * inert     := "console." IDENT "(" ... ")"                    ; listed as having no effect
 * ```
 *
 * A statement after one that can return or throw runs only when that did not happen, so it is not
 * converted either. Everything else becomes a finding with its line. Pure: the same text always
 * gives the same result, in source order.
 */
export type CaptureScope = "environment" | "collectionVariables" | "globals" | "variables";

export interface RecognizedSetter {
  name: string;
  scope: CaptureScope;
  source: CaptureSource;
  line: number;
  excerpt: string;
}

export interface RecognizedAssertion {
  codes: string[];
  line: number;
}

export interface StatementFinding {
  kind: FindingKind;
  line: number | null;
  column: number | null;
  excerpt: string | null;
  /** A variable name, for `computed-value`. Never a value. */
  detail: string | null;
}

export interface ScriptRecognition {
  setters: RecognizedSetter[];
  assertions: RecognizedAssertion[];
  findings: StatementFinding[];
}

export const MAX_EXCERPT_LENGTH = 160;
export const MAX_CAPTURE_NAME_LENGTH = 200;
// eslint-disable-next-line no-control-regex -- control characters are exactly what a variable name may not hold
const INVALID_NAME = /[{}\u0000-\u001f\u007f-\u009f]/;
const SCOPES: Readonly<Record<string, CaptureScope>> = {
  environment: "environment",
  collectionVariables: "collectionVariables",
  globals: "globals",
  variables: "variables",
};
const LEGACY_SETTERS: Readonly<Record<string, CaptureScope>> = { setEnvironmentVariable: "environment", setGlobalVariable: "globals" };
const LEGACY_UNSETTERS: ReadonlySet<string> = new Set(["clearEnvironmentVariable", "clearGlobalVariable", "clearEnvironmentVariables", "clearGlobalVariables"]);
const FUNCTIONS: ReadonlySet<string> = new Set(["FunctionExpression", "ArrowFunctionExpression", "FunctionDeclaration"]);
const LOOPS: ReadonlySet<string> = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);

type Aliases = ReadonlySet<string>;

function lineOf(node: EsNode): number {
  return node.loc?.start.line ?? 1;
}

function excerptOf(text: string, node: EsNode): string {
  const collapsed = text.slice(node.start, node.end).replace(/\s+/g, " ").trim();
  return collapsed.length <= MAX_EXCERPT_LENGTH ? collapsed : `${collapsed.slice(0, MAX_EXCERPT_LENGTH - 1)}…`;
}

function stringLiteral(node: unknown): string | null {
  return isNode(node) && node.type === "Literal" && typeof node.value === "string" ? node.value : null;
}

/** `pm.response.json()` or `JSON.parse(responseBody)`. */
function isBodySource(node: EsNode): boolean {
  if (node.type !== "CallExpression") return false;
  const args = children(node, "arguments");
  const callee = node.callee as EsNode;
  if (isPmPath(callee, "response", "json")) return args.length === 0;
  const chain = memberChain(callee);
  return chain !== null && isIdentifier(chain.root, "JSON") && chain.names.length === 1 && chain.names[0] === "parse" && args.length === 1 && isIdentifier(args[0], "responseBody");
}

/** A `value` of the grammar: a body field path or a response header read by its literal name. */
function readValue(node: EsNode, aliases: Aliases): CaptureSource | null {
  if (node.type === "CallExpression") {
    const args = children(node, "arguments");
    const callee = node.callee as EsNode;
    const name = args.length === 1 ? stringLiteral(args[0]) : null;
    if (name === null) return null;
    if (isPmPath(callee, "response", "headers", "get")) return { kind: "header", name: name.toLowerCase() };
    const chain = memberChain(callee);
    if (chain && isIdentifier(chain.root, "postman") && chain.names.length === 1 && chain.names[0] === "getResponseHeader") return { kind: "header", name: name.toLowerCase() };
    return null;
  }
  const segments: BodyPathSegment[] = [];
  let current = node;
  while (current.type === "MemberExpression") {
    const property = current.property as EsNode;
    if (current.computed === true) {
      if (property.type !== "Literal") return null;
      if (typeof property.value === "string") segments.unshift({ field: property.value });
      else if (typeof property.value === "number" && Number.isInteger(property.value) && property.value >= 0) segments.unshift({ index: property.value });
      else return null;
    } else if (property.type === "Identifier") segments.unshift({ field: String(property.name) });
    else return null;
    current = current.object as EsNode;
  }
  if (segments.length === 0) return null;
  const rooted = isBodySource(current) || (current.type === "Identifier" && aliases.has(String(current.name)));
  return rooted ? { kind: "body", path: formatCapturePath(segments), segments } : null;
}

/** Whether `node` is the call `pm.test(<any>, <function>)`, and its callback. */
function testCallback(node: EsNode): EsNode | null {
  if (node.type !== "ExpressionStatement") return null;
  const call = node.expression as EsNode;
  if (call.type !== "CallExpression" || !isPmPath(call.callee as EsNode, "test")) return null;
  const args = children(call, "arguments");
  return args.length >= 2 && (args[1].type === "FunctionExpression" || args[1].type === "ArrowFunctionExpression") ? args[1] : null;
}

/** A callback's statements; an arrow function's expression body is one statement. */
function bodyStatements(fn: EsNode): EsNode[] {
  const body = fn.body as EsNode;
  if (body.type === "BlockStatement") return children(body, "body");
  return [{ type: "ExpressionStatement", expression: body, start: body.start, end: body.end, loc: body.loc }];
}

/** Every node below `node`, not entering nested functions unless `intoFunctions`. */
function* descendants(node: EsNode, intoFunctions: boolean): Generator<EsNode> {
  for (const entry of childEntries(node)) {
    yield entry.node;
    if (intoFunctions || !FUNCTIONS.has(entry.node.type)) yield* descendants(entry.node, intoFunctions);
  }
}

/** True when the statement can leave the script or callback early: a `return` or `throw` outside nested functions. */
function canExit(statement: EsNode): boolean {
  if (statement.type === "ReturnStatement" || statement.type === "ThrowStatement") return true;
  for (const node of descendants(statement, false)) if (node.type === "ReturnStatement" || node.type === "ThrowStatement") return true;
  return false;
}

/** Names assigned or updated anywhere in the script, so they cannot be aliases. */
function reassignedNames(program: EsNode): Set<string> {
  const names = new Set<string>();
  for (const node of descendants(program, true)) {
    const target = node.type === "AssignmentExpression" ? (node.left as EsNode) : node.type === "UpdateExpression" ? (node.argument as EsNode) : null;
    if (target?.type === "Identifier") names.add(String(target.name));
  }
  return names;
}

/** Direct child statements of a construct, for listing what it holds. */
function innerStatements(node: EsNode): EsNode[] {
  switch (node.type) {
    case "BlockStatement":
      return children(node, "body");
    case "IfStatement":
      return [node.consequent, node.alternate].filter(isNode).flatMap((part) => (part.type === "BlockStatement" ? children(part, "body") : [part]));
    case "SwitchStatement":
      return children(node, "cases").flatMap((switchCase) => children(switchCase, "consequent"));
    case "TryStatement": {
      const handler = node.handler as EsNode | null;
      return [node.block, handler?.body, node.finalizer].filter(isNode).flatMap((part) => children(part, "body"));
    }
    case "LabeledStatement":
      return [node.body as EsNode];
    case "FunctionDeclaration":
      return bodyStatements(node);
    default:
      if (LOOPS.has(node.type)) {
        const body = node.body as EsNode;
        return body.type === "BlockStatement" ? children(body, "body") : [body];
      }
      return [];
  }
}

/** Statements inside function expressions the statement passes along (callbacks), not entering deeper ones twice. */
function callbackStatements(statement: EsNode): EsNode[] {
  const found: EsNode[] = [];
  const visit = (node: EsNode) => {
    for (const entry of childEntries(node)) {
      if (entry.node.type === "FunctionExpression" || entry.node.type === "ArrowFunctionExpression") found.push(...bodyStatements(entry.node));
      else visit(entry.node);
    }
  };
  visit(statement);
  return found;
}

function constructKind(node: EsNode): FindingKind | null {
  if (node.type === "IfStatement" || node.type === "SwitchStatement") return "condition";
  if (LOOPS.has(node.type)) return "loop";
  if (node.type === "TryStatement") return "try";
  if (node.type === "FunctionDeclaration") return "function";
  if (node.type === "BlockStatement" || node.type === "LabeledStatement") return "unsupported-statement";
  return null;
}

class Recognizer {
  readonly result: ScriptRecognition = { setters: [], assertions: [], findings: [] };

  constructor(
    private readonly text: string,
    private readonly reassigned: ReadonlySet<string>,
  ) {}

  private find(kind: FindingKind, node: EsNode, detail: string | null = null): void {
    this.result.findings.push({ kind, line: lineOf(node), column: null, excerpt: excerptOf(this.text, node), detail });
  }

  /** Lists `statement` and everything it holds as `kind`: none of it is converted. */
  private listAll(statement: EsNode, kind: FindingKind): void {
    const inner = innerStatements(statement);
    if (inner.length === 0) {
      this.find(kind, statement);
      for (const nested of callbackStatements(statement)) this.listAll(nested, kind);
      return;
    }
    for (const nested of inner) this.listAll(nested, kind);
  }

  /** A sequence of statements at a recognised level: the script's top level, or a `pm.test` callback. */
  body(statements: readonly EsNode[], inherited: Aliases, topLevel: boolean): void {
    const aliases = new Set(inherited);
    let exited = false;
    for (const statement of statements) {
      if (statement.type === "EmptyStatement") continue;
      if (exited) {
        this.listAll(statement, "condition");
        continue;
      }
      const callback = topLevel ? testCallback(statement) : null;
      if (callback) {
        const shadowed = children(callback, "params").flatMap((param) => (param.type === "Identifier" ? [String(param.name)] : []));
        this.body(bodyStatements(callback), new Set([...aliases].filter((name) => !shadowed.includes(name))), false);
        continue;
      }
      this.statement(statement, aliases);
      if (canExit(statement)) exited = true;
    }
  }

  private statement(statement: EsNode, aliases: Set<string>): void {
    const kind = constructKind(statement);
    if (kind) return this.listAll(statement, kind);
    if (statement.type === "VariableDeclaration") return this.declaration(statement, aliases);
    if (statement.type !== "ExpressionStatement") return this.listAll(statement, "unsupported-statement");
    const expression = statement.expression as EsNode;
    if (this.usesIterationData(statement)) return this.listAll(statement, "iteration-data");
    if (expression.type === "AssignmentExpression" && this.isLegacyTests(expression.left as EsNode)) return this.find("assertion-not-converted", statement);
    if (expression.type === "CallExpression" && this.call(statement, expression, aliases)) return;
    const assertion = readStatusAssertion(expression);
    if (assertion?.kind === "status") {
      this.result.assertions.push({ codes: assertion.codes, line: lineOf(statement) });
      return;
    }
    if (assertion?.kind === "not-converted") return this.find("assertion-not-converted", statement);
    // A nested `pm.test` is itself inside a function; any other statement is unsupported. The
    // callbacks either one passes along hold statements inside a function.
    this.find(testCallback(statement) ? "function" : "unsupported-statement", statement);
    for (const nested of callbackStatements(statement)) this.listAll(nested, "function");
  }

  private declaration(statement: EsNode, aliases: Set<string>): void {
    const declarators = children(statement, "declarations");
    const declarator = declarators.length === 1 ? declarators[0] : null;
    const id = declarator?.id as EsNode | undefined;
    const init = declarator?.init as EsNode | null | undefined;
    if (id?.type === "Identifier" && init && isBodySource(init) && !this.reassigned.has(String(id.name))) {
      aliases.add(String(id.name));
      return;
    }
    if (this.usesIterationData(statement)) return this.listAll(statement, "iteration-data");
    this.listAll(statement, "unsupported-statement");
  }

  /** Recognises a call statement; returns false when it is none of the calls the grammar names. */
  private call(statement: EsNode, call: EsNode, aliases: Aliases): boolean {
    const chain = memberChain(call.callee as EsNode);
    if (!chain) return false;
    const args = children(call, "arguments");
    const { root, names } = chain;
    const last = names[names.length - 1];
    if (isIdentifier(root, "pm") && names.length === 2 && SCOPES[names[0]] && last === "set") {
      this.setter(statement, SCOPES[names[0]], args, aliases);
      return true;
    }
    if (isIdentifier(root, "postman") && names.length === 1 && LEGACY_SETTERS[last]) {
      this.setter(statement, LEGACY_SETTERS[last], args, aliases);
      return true;
    }
    const finding = this.callFinding(root, names);
    if (!finding) return false;
    this.find(finding, statement);
    for (const nested of callbackStatements(statement)) this.listAll(nested, "function");
    return true;
  }

  private callFinding(root: EsNode, names: readonly string[]): FindingKind | null {
    const last = names[names.length - 1];
    if (isIdentifier(root, "pm")) {
      if (names.length === 2 && SCOPES[names[0]] && (last === "unset" || last === "clear")) return "unset";
      if (names.length === 1 && last === "sendRequest") return "send-request";
      if ((names.length === 1 && last === "setNextRequest") || (names.length === 2 && names[0] === "execution" && last === "setNextRequest")) return "set-next-request";
      if (names.length === 2 && names[0] === "execution" && last === "skipRequest") return "skip-request";
      return null;
    }
    if (isIdentifier(root, "postman") && names.length === 1) {
      if (last === "setNextRequest") return "set-next-request";
      if (LEGACY_UNSETTERS.has(last)) return "unset";
      return null;
    }
    if (isIdentifier(root, "console") && names.length === 1) return "no-effect";
    return null;
  }

  private setter(statement: EsNode, scope: CaptureScope, args: readonly EsNode[], aliases: Aliases): void {
    const name = args.length === 2 ? stringLiteral(args[0]) : null;
    if (name === null || name.length === 0 || name.length > MAX_CAPTURE_NAME_LENGTH || INVALID_NAME.test(name)) return this.find("computed-name", statement);
    const source = readValue(args[1], aliases);
    if (!source) return this.find("computed-value", statement, name);
    this.result.setters.push({ name, scope, source, line: lineOf(statement), excerpt: excerptOf(this.text, statement) });
  }

  private isLegacyTests(left: EsNode): boolean {
    return left.type === "MemberExpression" && isIdentifier(left.object, "tests");
  }

  /** `pm.iterationData` or a `data.` read: iteration data, which the run panel never has. */
  private usesIterationData(statement: EsNode): boolean {
    for (const node of descendants(statement, true)) {
      if (node.type !== "MemberExpression") continue;
      if (isIdentifier(node.object, "data") || isPmPath(node, "iterationData")) return true;
    }
    return false;
  }
}

/** Recognises one test script (R5). A script that does not parse is one `unreadable-script` finding. */
export function recognizeScript(text: string): ScriptRecognition {
  if (text.trim().length === 0) return { setters: [], assertions: [], findings: [] };
  let program: EsNode;
  try {
    // Postman runs a script inside a function, so a top-level `return` is legal there.
    program = parse(text, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true, locations: true }) as unknown as EsNode;
  } catch (error) {
    const loc = (error as { loc?: { line: number; column: number } }).loc;
    return { setters: [], assertions: [], findings: [{ kind: "unreadable-script", line: loc?.line ?? null, column: loc ? loc.column + 1 : null, excerpt: null, detail: null }] };
  }
  const recognizer = new Recognizer(text, reassignedNames(program));
  recognizer.body(children(program, "body"), new Set(), true);
  return recognizer.result;
}
