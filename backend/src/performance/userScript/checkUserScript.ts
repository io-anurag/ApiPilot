import { parse } from "acorn";
import type { ScriptCheckResult, ScriptEnvName, ScriptProblem, ScriptRuleId, UserScriptValueSource } from "@apipilot/shared-domain";
import { USER_SCRIPT_MAX_BYTES } from "@apipilot/shared-domain";
import { compareCodeUnits } from "../../postman/ordering";
import { validateMappingName } from "./mappingNames";
import { analyzeScopes, child, childEntries, children, type EsNode, type Scope, type ScopeAnalysis } from "./numericGuarantee";

/**
 * AP-034's script check (specs/034-run-user-k6-script FR-004 to FR-009; research R1 to R5). It
 * parses the script and walks the tree; it never evaluates, runs or previews anything. A script is
 * accepted only when it imports allowlisted k6 built-ins and stays inside a subset of JavaScript in
 * which `open()`, `require()`, the global object and the function constructor cannot be reached,
 * directly or indirectly (constitution XVII, 2026-09-30). The same bytes always give the same
 * result, problems and lists (FR-008).
 */

/** FR-005. */
export const ALLOWED_MODULES: ReadonlySet<string> = new Set([
  "k6",
  "k6/http",
  "k6/metrics",
  "k6/execution",
  "k6/encoding",
  "k6/crypto",
  "k6/data",
  "k6/html",
  "k6/timers",
]);
const FORBIDDEN_BUILTINS: ReadonlySet<string> = new Set(["k6/browser", "k6/net/grpc", "k6/ws", "k6/websockets", "k6/secrets"]);

/** Research R3 rule 2. */
const FORBIDDEN_IDENTIFIERS: ReadonlySet<string> = new Set(["open", "require", "eval", "Function", "globalThis", "global", "self", "window", "Reflect"]);

/** Research R3 rule 3. */
const FORBIDDEN_PROPERTIES: ReadonlySet<string> = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "getPrototypeOf",
  "setPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "caller",
  "callee",
]);

const TIMERS: ReadonlySet<string> = new Set(["setTimeout", "setInterval"]);
const BASE_URL_KEYS: ReadonlySet<string> = new Set(["baseUrl", "BASE_URL"]);

const IMPORT_MESSAGES: Record<string, string> = {
  "import-remote": "Imports a module from a URL. Remote code is not allowed; copy what you need from it into this script.",
  "import-file": "Imports another file. A script must be a single file; copy what you need from it into this script.",
  "import-extension": "Imports a k6 extension module (k6/x/…). Extensions are not allowed.",
  "import-experimental": "Imports an experimental k6 module (k6/experimental/…). Experimental modules are not allowed.",
  "import-forbidden-builtin": "Imports a k6 module that is not allowed (browser, gRPC, WebSocket or secrets modules).",
  "import-not-allowed": "Imports a module that is not one of the allowed k6 modules: k6, k6/http, k6/metrics, k6/execution, k6/encoding, k6/crypto, k6/data, k6/html and k6/timers.",
};

function identifierMessage(name: string): string {
  switch (name) {
    case "open":
      return "Uses `open`, which reads local files. Put the data in the script or pass it in an environment value.";
    case "require":
      return "Uses `require`. Use `import` from an allowed k6 module instead.";
    case "eval":
    case "Function":
      return `Uses \`${name}\`, which runs code built from text. That code cannot be checked, so it is not allowed.`;
    case "Reflect":
      return "Uses `Reflect`, which can reach properties the check cannot see. Read the property by name instead.";
    default:
      return `Uses \`${name}\`, the global object, which can reach functions the check cannot see.`;
  }
}

function propertyMessage(name: string): string {
  if (name === "prototype") {
    return "Reads `prototype`. Only the exact form `Object.prototype.hasOwnProperty.call(object, key)` is allowed; `Object.hasOwn(object, key)` also works.";
  }
  if (name === "__proto__") return "Uses `__proto__`, which reads or changes an object's prototype.";
  return `Reads \`${name}\`, which can reach the function constructor.`;
}

const COMPUTED_MESSAGE =
  "Reads a property by a key built at run time. Use a Map (`map.get(key)`), a `const` lookup table written as an object or array literal, or a numeric index such as `data[i]` or `data[i | 0]`.";

function importRule(specifier: string): ScriptRuleId | null {
  if (ALLOWED_MODULES.has(specifier)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(specifier) && !/^file:/i.test(specifier)) return "import-remote";
  if (specifier.startsWith("//")) return "import-remote";
  if (/^(\.{1,2}[\\/]|[\\/]|file:|[a-z]:[\\/])/i.test(specifier)) return "import-file";
  if (specifier.startsWith("k6/x/")) return "import-extension";
  if (specifier === "k6/experimental" || specifier.startsWith("k6/experimental/")) return "import-experimental";
  if (FORBIDDEN_BUILTINS.has(specifier)) return "import-forbidden-builtin";
  return "import-not-allowed";
}

/** A static property name: dotted, a string literal, or an expression-free template. */
function staticPropertyName(member: EsNode): string | null {
  const property = child(member, "property");
  if (!property) return null;
  if (member.computed !== true) return property.type === "Identifier" ? String(property.name) : null;
  return staticKey(property);
}

function staticKey(key: EsNode): string | null {
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  if (key.type === "TemplateLiteral" && children(key, "expressions").length === 0) {
    const quasi = children(key, "quasis")[0];
    const cooked = (quasi?.value as { cooked?: string } | undefined)?.cooked;
    return typeof cooked === "string" ? cooked : null;
  }
  return null;
}

function isNumberLiteral(key: EsNode): boolean {
  return key.type === "Literal" && typeof key.value === "number";
}

interface Ancestor {
  node: EsNode;
  key: string;
}

function isReference(node: EsNode, parent: EsNode | undefined, key: string): boolean {
  if (!parent) return true;
  switch (parent.type) {
    case "MemberExpression":
      return !(key === "property" && parent.computed !== true);
    case "Property":
    case "MethodDefinition":
    case "PropertyDefinition":
      return !(key === "key" && parent.computed !== true);
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return key !== "label";
    case "ExportSpecifier":
      return key !== "exported";
    case "ImportSpecifier":
      return key !== "imported";
    case "MetaProperty":
      return false;
    default:
      return true;
  }
}

/** Research R4: every absolute URL written anywhere in the text, as `scheme://host:port`. */
export function hostsInText(text: string): string[] {
  const defaults: Record<string, string> = { "http:": "80", "https:": "443", "ws:": "80", "wss:": "443" };
  const hosts = new Set<string>();
  for (const match of text.matchAll(/\b(https?|wss?):\/\/([^\s'"`<>()\\{}|^]+)/gi)) {
    let url: URL;
    try {
      url = new URL(`${match[1]}://${match[2]}`);
    } catch {
      continue;
    }
    if (url.hostname === "" || url.hostname.includes("$")) continue;
    hosts.add(`${url.protocol}//${url.hostname}:${url.port || defaults[url.protocol]}`);
  }
  return [...hosts].sort(compareCodeUnits);
}

function decode(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return text.includes("\u0000") ? null : text;
  } catch {
    return null;
  }
}

function sortProblems(problems: ScriptProblem[]): ScriptProblem[] {
  const unique = new Map<string, ScriptProblem>();
  for (const problem of problems) unique.set(`${problem.line}:${problem.column}:${problem.rule}`, problem);
  return [...unique.values()].sort((a, b) => a.line - b.line || a.column - b.column || compareCodeUnits(a.rule, b.rule));
}

export function checkUserScript(bytes: Uint8Array): ScriptCheckResult {
  if (bytes.length > USER_SCRIPT_MAX_BYTES) {
    return { accepted: false, problems: [{ rule: "too-large", line: 1, column: 1, message: `The script is larger than ${USER_SCRIPT_MAX_BYTES} bytes (1 MiB).` }] };
  }
  const text = decode(bytes);
  if (text === null) {
    return { accepted: false, problems: [{ rule: "not-utf8-text", line: 1, column: 1, message: "The file is not UTF-8 text. A script must be one UTF-8 text file." }] };
  }
  let program: EsNode;
  try {
    program = parse(text, { ecmaVersion: "latest", sourceType: "module", locations: true, allowHashBang: true }) as unknown as EsNode;
  } catch (error) {
    const loc = (error as { loc?: { line: number; column: number } }).loc;
    const message = (error as Error).message.replace(/\s*\(\d+:\d+\)$/, "");
    return { accepted: false, problems: [{ rule: "parse-error", line: loc?.line ?? 1, column: (loc?.column ?? 0) + 1, message: `The script could not be read: ${message}.` }] };
  }

  const analysis = analyzeScopes(program);
  const problems: ScriptProblem[] = [];
  const envNames = new Map<string, ScriptEnvName>();
  let hasDefaultFunction = false;

  const report = (node: EsNode, rule: ScriptRuleId, message: string) => {
    const start = node.loc?.start ?? { line: 1, column: 0 };
    problems.push({ rule, line: start.line, column: start.column + 1, message });
  };
  const addEnvName = (name: string, suggestedSource?: UserScriptValueSource) => {
    const existing = envNames.get(name);
    if (existing && (existing.suggestedSource || !suggestedSource)) return;
    const reason = validateMappingName(name);
    envNames.set(name, { name, mappable: reason === null, ...(reason ? { reason } : {}), ...(suggestedSource ? { suggestedSource } : {}) });
  };

  const walk = (node: EsNode, scope: Scope, ancestors: Ancestor[]) => {
    const parentEntry = ancestors[ancestors.length - 1];
    checkNode(node, scope, parentEntry?.node, parentEntry?.key ?? "", ancestors);
    const inner = analysis.scopeInside(node, scope);
    for (const entry of childEntries(node)) {
      ancestors.push({ node, key: entry.key });
      walk(entry.node, inner, ancestors);
      ancestors.pop();
    }
  };

  function checkNode(node: EsNode, scope: Scope, parent: EsNode | undefined, key: string, ancestors: Ancestor[]): void {
    switch (node.type) {
      case "ImportDeclaration":
      case "ExportAllDeclaration":
      case "ExportNamedDeclaration": {
        const source = child(node, "source");
        if (source && typeof source.value === "string") {
          const rule = importRule(source.value);
          if (rule) report(source, rule, IMPORT_MESSAGES[rule]);
        }
        if (node.type === "ExportNamedDeclaration") checkExports(node);
        return;
      }
      case "ExportDefaultDeclaration":
        hasDefaultFunction = true;
        return;
      case "ImportExpression":
        report(node, "dynamic-import", "Uses dynamic `import()`, which loads code the check cannot see.");
        return;
      case "MetaProperty":
        if (child(node, "meta")?.name === "import") report(node, "import-meta", "Uses `import.meta`, which can locate files on the machine.");
        return;
      case "Identifier":
        if (FORBIDDEN_IDENTIFIERS.has(String(node.name)) && isReference(node, parent, key)) report(node, "forbidden-identifier", identifierMessage(String(node.name)));
        return;
      case "MemberExpression":
        checkMember(node, scope, parent, key, ancestors);
        return;
      case "ObjectExpression":
        for (const property of children(node, "properties")) {
          if (property.type === "Property" && property.computed !== true && literalKey(property) === "__proto__") report(property, "forbidden-property", propertyMessage("__proto__"));
        }
        return;
      case "ObjectPattern":
        checkPattern(node, scope, parent, key);
        return;
      case "CallExpression": {
        const callee = child(node, "callee");
        const first = children(node, "arguments")[0];
        if (callee?.type === "Identifier" && TIMERS.has(String(callee.name)) && first && (first.type === "TemplateLiteral" || (first.type === "Literal" && typeof first.value === "string"))) {
          report(first, "timer-string-code", `Passes text to \`${String(callee.name)}\`. Pass a function instead.`);
        }
        return;
      }
      default:
        return;
    }
  }

  function literalKey(property: EsNode): string | null {
    const keyNode = child(property, "key");
    if (!keyNode) return null;
    if (keyNode.type === "Identifier") return String(keyNode.name);
    return staticKey(keyNode);
  }

  function checkExports(node: EsNode): void {
    const declaration = child(node, "declaration");
    const names: EsNode[] = [];
    if (declaration?.type === "FunctionDeclaration" || declaration?.type === "ClassDeclaration") {
      const id = child(declaration, "id");
      if (id) names.push(id);
    }
    if (declaration?.type === "VariableDeclaration") {
      for (const declarator of children(declaration, "declarations")) {
        const id = child(declarator, "id");
        if (id?.type === "Identifier") names.push(id);
      }
    }
    for (const specifier of children(node, "specifiers")) {
      const exported = child(specifier, "exported");
      if (exported) names.push(exported);
    }
    for (const name of names) {
      const exportedName = name.type === "Identifier" ? String(name.name) : typeof name.value === "string" ? name.value : "";
      if (exportedName === "handleSummary") report(name, "handle-summary", "Exports `handleSummary`, which k6 uses to write files. ApiPilot produces the run's report instead.");
      if (exportedName === "default") hasDefaultFunction = true;
    }
  }

  function isHasOwnPropertyChain(member: EsNode, ancestors: Ancestor[], scope: Scope): boolean {
    const object = child(member, "object");
    if (object?.type !== "Identifier" || object.name !== "Object" || analysis.resolve("Object", scope)) return false;
    const [outer, outerKey, call, callKey, invocation, invocationKey] = [
      ancestors[ancestors.length - 1]?.node,
      ancestors[ancestors.length - 1]?.key,
      ancestors[ancestors.length - 2]?.node,
      ancestors[ancestors.length - 2]?.key,
      ancestors[ancestors.length - 3]?.node,
      ancestors[ancestors.length - 3]?.key,
    ];
    return (
      outer?.type === "MemberExpression" &&
      outerKey === "object" &&
      outer.computed !== true &&
      child(outer, "property")?.name === "hasOwnProperty" &&
      call?.type === "MemberExpression" &&
      callKey === "object" &&
      call.computed !== true &&
      child(call, "property")?.name === "call" &&
      invocation?.type === "CallExpression" &&
      invocationKey === "callee"
    );
  }

  function checkMember(node: EsNode, scope: Scope, parent: EsNode | undefined, key: string, ancestors: Ancestor[]): void {
    const object = child(node, "object");
    const property = child(node, "property");
    if (!object || !property || property.type === "PrivateIdentifier") return;
    const isPlainWrite = parent?.type === "AssignmentExpression" && key === "left" && parent.operator === "=";
    const name = staticPropertyName(node);

    collectEnvName(node, object, property, scope);

    if (name !== null && FORBIDDEN_PROPERTIES.has(name)) {
      if (isPlainWrite && name !== "__proto__") return;
      if (name === "prototype" && node.computed !== true && isHasOwnPropertyChain(node, ancestors, scope)) return;
      report(property, "forbidden-property", propertyMessage(name));
      return;
    }
    if (node.computed !== true || name !== null || isNumberLiteral(property) || isPlainWrite) return;
    if (object.type === "Identifier") {
      const baseName = String(object.name);
      if (baseName === "__ENV" && !analysis.resolve("__ENV", scope)) return;
      if (analysis.isConstLiteralBinding(baseName, scope)) return;
    }
    if (analysis.isNumericGuaranteed(property, scope)) return;
    report(property, "computed-access", COMPUTED_MESSAGE);
  }

  function collectEnvName(node: EsNode, object: EsNode, property: EsNode, scope: Scope): void {
    if (object.type !== "Identifier" || object.name !== "__ENV" || analysis.resolve("__ENV", scope)) return;
    const name = staticPropertyName(node);
    if (name !== null) {
      addEnvName(name);
      return;
    }
    // `__ENV[T[k]]` or `__ENV[T.key]` with T a const table of string literals (research R5).
    if (property.type !== "MemberExpression") return;
    const table = child(property, "object");
    if (table?.type !== "Identifier") return;
    const entries = analysis.stringTableOf(String(table.name), scope);
    if (!entries) return;
    const keyName = staticPropertyName(property);
    for (const [entryKey, value] of entries) {
      if (keyName !== null && keyName !== entryKey) continue;
      addEnvName(value, BASE_URL_KEYS.has(entryKey) ? { kind: "base-url" } : { kind: "environment-value", valueName: entryKey });
    }
  }

  function patternSource(pattern: EsNode, parent: EsNode | undefined, key: string): EsNode | null {
    if (parent?.type === "VariableDeclarator" && key === "id") return child(parent, "init");
    if (parent?.type === "AssignmentExpression" && key === "left") return child(parent, "right");
    return null;
  }

  function checkPattern(pattern: EsNode, scope: Scope, parent: EsNode | undefined, key: string): void {
    const source = patternSource(pattern, parent, key);
    const fromEnv = source?.type === "Identifier" && source.name === "__ENV" && !analysis.resolve("__ENV", scope);
    const fromTable = source?.type === "Identifier" && analysis.isConstLiteralBinding(String(source.name), scope);
    for (const property of children(pattern, "properties")) {
      if (property.type !== "Property") continue;
      const keyNode = child(property, "key")!;
      if (property.computed === true) {
        const name = staticKey(keyNode);
        if (name !== null) {
          if (FORBIDDEN_PROPERTIES.has(name)) report(keyNode, "forbidden-property", propertyMessage(name));
          else if (fromEnv) addEnvName(name);
          continue;
        }
        if (isNumberLiteral(keyNode) || fromEnv || fromTable || analysis.isNumericGuaranteed(keyNode, scope)) continue;
        report(keyNode, "computed-access", COMPUTED_MESSAGE);
        continue;
      }
      const name = literalKey(property);
      if (name === null) continue;
      if (FORBIDDEN_PROPERTIES.has(name)) report(keyNode, "forbidden-property", propertyMessage(name));
      else if (fromEnv) addEnvName(name);
    }
  }

  walk(program, analysis.program, []);

  if (problems.length > 0) return { accepted: false, problems: sortProblems(problems) };
  return {
    accepted: true,
    hosts: hostsInText(text),
    envNames: [...envNames.values()].sort((a, b) => compareCodeUnits(a.name, b.name)),
    hasDefaultFunction,
  };
}

export type { ScopeAnalysis };
