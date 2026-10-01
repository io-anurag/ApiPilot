/**
 * Scope analysis for AP-034's script check (specs/034-run-user-k6-script research R3 rule 4).
 * Pure: it reads an ESTree and never evaluates anything. It answers three questions the check
 * needs about a computed property access `a[k]`:
 * - is `k` guaranteed to be a number, so it can only name an array index or `NaN`;
 * - is `a` an unshadowed `const` bound to an object or array literal (a lookup table);
 * - is a global such as `Math`, `Object` or `__ENV` shadowed at this point.
 */

/** The ESTree shape this module and the check read. Every other field is reached through `child()`. */
export interface EsNode {
  type: string;
  start: number;
  end: number;
  loc?: { start: { line: number; column: number } };
  [key: string]: unknown;
}

export function isNode(value: unknown): value is EsNode {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

export function child(node: EsNode, key: string): EsNode | null {
  const value = node[key];
  return isNode(value) ? value : null;
}

export function children(node: EsNode, key: string): EsNode[] {
  const value = node[key];
  return Array.isArray(value) ? value.filter(isNode) : [];
}

const SKIPPED_KEYS = new Set(["type", "start", "end", "loc", "range", "raw", "value", "regex", "bigint"]);

/** Every child node, with the key it sits under, in source order of keys. */
export function childEntries(node: EsNode): { key: string; node: EsNode }[] {
  const entries: { key: string; node: EsNode }[] = [];
  for (const key of Object.keys(node)) {
    if (SKIPPED_KEYS.has(key) && !(key === "value" && isNode(node.value))) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) entries.push({ key, node: item });
    } else if (isNode(value)) {
      entries.push({ key, node: value });
    }
  }
  return entries;
}

export type BindingKind = "var" | "let" | "const" | "param" | "function" | "class" | "import" | "catch";

interface ValueSource {
  expr: EsNode | null;
  scope: Scope;
}

export interface Binding {
  name: string;
  kind: BindingKind;
  /** Initializers and right sides of plain `=` assignments, each with the scope it is read in. */
  values: ValueSource[];
  /** `+=`, `-=` and the like, with their right sides. */
  compoundWrites: { operator: string; expr: EsNode; scope: Scope }[];
  /** Written through destructuring, a `for…in`/`for…of` target, or any form not tracked above. */
  untrackedWrite: boolean;
  /** The single initializer, when the binding is `const`. */
  constInit: EsNode | null;
}

export interface Scope {
  parent: Scope | null;
  isFunction: boolean;
  bindings: Map<string, Binding>;
}

const SCOPE_NODES = new Set([
  "Program",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "BlockStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "SwitchStatement",
  "CatchClause",
  "StaticBlock",
  "ClassDeclaration",
  "ClassExpression",
]);
const FUNCTION_SCOPE_NODES = new Set(["Program", "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "StaticBlock"]);

const ALWAYS_NUMERIC_BINARY = new Set(["-", "*", "/", "%", "**", "|", "&", "^", "<<", ">>", ">>>"]);
const ALWAYS_NUMERIC_COMPOUND = new Set(["-=", "*=", "/=", "%=", "**=", "|=", "&=", "^=", "<<=", ">>=", ">>>="]);
const RIGHT_DECIDES_COMPOUND = new Set(["+=", "&&=", "||=", "??="]);
/** k6 globals that are always numbers. */
const NUMERIC_GLOBALS = new Set(["__VU", "__ITER"]);

export interface ScopeAnalysis {
  /** The scope a node's own children are resolved in (its own scope if it creates one). */
  scopeInside(node: EsNode, enclosing: Scope): Scope;
  program: Scope;
  resolve(name: string, scope: Scope): Binding | undefined;
  isNumericGuaranteed(expr: EsNode, scope: Scope): boolean;
  /** True for an unshadowed `const` bound to an object or array literal. */
  isConstLiteralBinding(name: string, scope: Scope): boolean;
  /** For an unshadowed `const` object literal whose every value is a string literal: key → value. */
  stringTableOf(name: string, scope: Scope): Map<string, string> | null;
}

function collectPatternNames(pattern: EsNode | null, out: EsNode[]): void {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      out.push(pattern);
      return;
    case "ObjectPattern":
      for (const property of children(pattern, "properties")) {
        if (property.type === "RestElement") collectPatternNames(child(property, "argument"), out);
        else collectPatternNames(child(property, "value"), out);
      }
      return;
    case "ArrayPattern":
      for (const element of children(pattern, "elements")) collectPatternNames(element, out);
      return;
    case "RestElement":
      collectPatternNames(child(pattern, "argument"), out);
      return;
    case "AssignmentPattern":
      collectPatternNames(child(pattern, "left"), out);
      return;
    default:
      return;
  }
}

function literalKeyName(property: EsNode): string | null {
  if (property.computed === true) return null;
  const key = child(property, "key");
  if (!key) return null;
  if (key.type === "Identifier") return String(key.name);
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

export function analyzeScopes(program: EsNode): ScopeAnalysis {
  const scopes = new Map<EsNode, Scope>();
  const root: Scope = { parent: null, isFunction: true, bindings: new Map() };
  scopes.set(program, root);

  function scopeInside(node: EsNode, enclosing: Scope): Scope {
    if (!SCOPE_NODES.has(node.type)) return enclosing;
    let scope = scopes.get(node);
    if (!scope) {
      scope = { parent: enclosing, isFunction: FUNCTION_SCOPE_NODES.has(node.type), bindings: new Map() };
      scopes.set(node, scope);
    }
    return scope;
  }

  function functionScopeOf(scope: Scope): Scope {
    let current = scope;
    while (!current.isFunction && current.parent) current = current.parent;
    return current;
  }

  function declare(scope: Scope, name: string, kind: BindingKind): Binding {
    let binding = scope.bindings.get(name);
    if (!binding) {
      binding = { name, kind, values: [], compoundWrites: [], untrackedWrite: false, constInit: null };
      scope.bindings.set(name, binding);
    }
    return binding;
  }

  // Pass 1: declarations, so hoisted names are known before any reference is resolved.
  function declareIn(node: EsNode, scope: Scope): void {
    switch (node.type) {
      case "VariableDeclaration": {
        const kind = node.kind as "var" | "let" | "const";
        const target = kind === "var" ? functionScopeOf(scope) : scope;
        for (const declarator of children(node, "declarations")) {
          const id = child(declarator, "id");
          const init = child(declarator, "init");
          if (id?.type === "Identifier") {
            const binding = declare(target, String(id.name), kind);
            binding.values.push({ expr: init, scope });
            if (kind === "const") binding.constInit = init;
          } else {
            const names: EsNode[] = [];
            collectPatternNames(id, names);
            for (const name of names) declare(target, String(name.name), kind).untrackedWrite = true;
          }
        }
        break;
      }
      case "FunctionDeclaration": {
        const id = child(node, "id");
        if (id) declare(scope, String(id.name), "function").untrackedWrite = true;
        break;
      }
      case "ClassDeclaration": {
        const id = child(node, "id");
        if (id) declare(scope, String(id.name), "class").untrackedWrite = true;
        break;
      }
      case "ImportDeclaration":
        for (const specifier of children(node, "specifiers")) {
          const local = child(specifier, "local");
          if (local) declare(root, String(local.name), "import").untrackedWrite = true;
        }
        break;
      default:
        break;
    }
    if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
      const own = scopeInside(node, scope);
      if (node.type === "FunctionExpression") {
        const id = child(node, "id");
        if (id) declare(own, String(id.name), "function").untrackedWrite = true;
      }
      const names: EsNode[] = [];
      for (const param of children(node, "params")) collectPatternNames(param, names);
      for (const name of names) declare(own, String(name.name), "param").untrackedWrite = true;
    }
    if (node.type === "ClassExpression") {
      const id = child(node, "id");
      if (id) declare(scopeInside(node, scope), String(id.name), "class").untrackedWrite = true;
    }
    if (node.type === "CatchClause") {
      const names: EsNode[] = [];
      collectPatternNames(child(node, "param"), names);
      const own = scopeInside(node, scope);
      for (const name of names) declare(own, String(name.name), "catch").untrackedWrite = true;
    }
    const inner = scopeInside(node, scope);
    for (const entry of childEntries(node)) declareIn(entry.node, inner);
  }

  function resolve(name: string, scope: Scope): Binding | undefined {
    for (let current: Scope | null = scope; current; current = current.parent) {
      const binding = current.bindings.get(name);
      if (binding) return binding;
    }
    return undefined;
  }

  // Pass 2: writes to bindings, resolved where they happen.
  function recordWrites(node: EsNode, scope: Scope): void {
    if (node.type === "AssignmentExpression") {
      const left = child(node, "left");
      const right = child(node, "right")!;
      if (left?.type === "Identifier") {
        const binding = resolve(String(left.name), scope);
        if (binding) {
          if (node.operator === "=") binding.values.push({ expr: right, scope });
          else binding.compoundWrites.push({ operator: String(node.operator), expr: right, scope });
        }
      } else if (left && left.type !== "MemberExpression") {
        const names: EsNode[] = [];
        collectPatternNames(left, names);
        for (const name of names) {
          const binding = resolve(String(name.name), scope);
          if (binding) binding.untrackedWrite = true;
        }
      }
    }
    if ((node.type === "ForInStatement" || node.type === "ForOfStatement") && child(node, "left")?.type !== "VariableDeclaration") {
      const names: EsNode[] = [];
      collectPatternNames(child(node, "left"), names);
      for (const name of names) {
        const binding = resolve(String(name.name), scope);
        if (binding) binding.untrackedWrite = true;
      }
    }
    const inner = scopeInside(node, scope);
    for (const entry of childEntries(node)) recordWrites(entry.node, inner);
  }

  declareIn(program, root);
  recordWrites(program, root);

  function isUnshadowedGlobal(name: string, scope: Scope): boolean {
    return resolve(name, scope) === undefined;
  }

  const visiting = new Set<Binding>();

  function isNumericBinding(binding: Binding): boolean {
    if (binding.kind !== "let" && binding.kind !== "const" && binding.kind !== "var") return false;
    if (binding.untrackedWrite || binding.values.length === 0) return false;
    if (visiting.has(binding)) return false;
    visiting.add(binding);
    try {
      for (const value of binding.values) {
        if (!value.expr || !isNumericGuaranteed(value.expr, value.scope)) return false;
      }
      for (const write of binding.compoundWrites) {
        if (ALWAYS_NUMERIC_COMPOUND.has(write.operator)) continue;
        if (RIGHT_DECIDES_COMPOUND.has(write.operator) && isNumericGuaranteed(write.expr, write.scope)) continue;
        return false;
      }
      return true;
    } finally {
      visiting.delete(binding);
    }
  }

  function isNumericGuaranteed(expr: EsNode, scope: Scope): boolean {
    switch (expr.type) {
      case "Literal":
        return typeof expr.value === "number" || typeof expr.bigint === "string";
      case "UnaryExpression":
        return expr.operator === "-" || expr.operator === "+" || expr.operator === "~";
      case "UpdateExpression":
        return true;
      case "BinaryExpression": {
        const operator = String(expr.operator);
        if (ALWAYS_NUMERIC_BINARY.has(operator)) return true;
        if (operator === "+") return isNumericGuaranteed(child(expr, "left")!, scope) && isNumericGuaranteed(child(expr, "right")!, scope);
        return false;
      }
      case "ConditionalExpression":
        return isNumericGuaranteed(child(expr, "consequent")!, scope) && isNumericGuaranteed(child(expr, "alternate")!, scope);
      case "CallExpression": {
        const callee = child(expr, "callee");
        if (callee?.type !== "MemberExpression" || callee.computed === true || callee.optional === true) return false;
        const object = child(callee, "object");
        return object?.type === "Identifier" && object.name === "Math" && isUnshadowedGlobal("Math", scope);
      }
      case "Identifier": {
        const name = String(expr.name);
        if (NUMERIC_GLOBALS.has(name) && isUnshadowedGlobal(name, scope)) return true;
        const binding = resolve(name, scope);
        return binding ? isNumericBinding(binding) : false;
      }
      default:
        return false;
    }
  }

  function constLiteralInit(name: string, scope: Scope): EsNode | null {
    const binding = resolve(name, scope);
    if (!binding || binding.kind !== "const" || binding.values.length !== 1) return null;
    const init = binding.constInit;
    return init && (init.type === "ObjectExpression" || init.type === "ArrayExpression") ? init : null;
  }

  function stringTableOf(name: string, scope: Scope): Map<string, string> | null {
    const init = constLiteralInit(name, scope);
    if (!init || init.type !== "ObjectExpression") return null;
    const table = new Map<string, string>();
    for (const property of children(init, "properties")) {
      if (property.type !== "Property" || property.kind !== "init") return null;
      const key = literalKeyName(property);
      const value = child(property, "value");
      if (key === null || value?.type !== "Literal" || typeof value.value !== "string") return null;
      table.set(key, value.value);
    }
    return table.size > 0 ? table : null;
  }

  return {
    scopeInside,
    program: root,
    resolve,
    isNumericGuaranteed,
    isConstLiteralBinding: (name, scope) => constLiteralInit(name, scope) !== null,
    stringTableOf,
  };
}
