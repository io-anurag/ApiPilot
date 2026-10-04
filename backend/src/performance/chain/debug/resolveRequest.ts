import type { ChainPlan, ChainStep, StepCheck } from "@apipilot/shared-domain";
import { dynamicValue, type DynamicContext } from "./dynamicValues";

/**
 * Reference filling and request building for a Debug run (specs/039-chain-debug-run research R2).
 * A twin of `fill`, `resolve` and `build` in `CHAIN_RUNTIME`
 * (`backend/src/performance/k6/renderChainScript.ts`); `debugParity.test.ts` holds the two to the
 * same requests. Pure: values come in through `ValueSource` and `Scope`, nothing is read from the
 * environment, a store or the clock except through them.
 */

const REFERENCE = /\{\{([A-Za-z0-9_]+)\}\}/g;
const DYNAMIC_REFERENCE = /\{\{(\$[A-Za-z0-9]+)\}\}/g;
const DYNAMIC_PREFIX = "apipilot_dyn_";

function isJsonContentType(contentType: string): boolean {
  const type = contentType.split(";")[0].trim().toLowerCase();
  return type === "application/json" || type.endsWith("+json");
}

/** A step whose `{{$name}}` references are rewritten to numbered tokens, as the script renderer does. */
export interface PreparedStep {
  step: ChainStep;
  url: string;
  query: { name: string; value: string }[];
  headers: { name: string; value: string }[];
  body: { kind: "none" } | { kind: "raw"; contentType: string; fill: "json" | "raw"; text: string } | { kind: "form"; fields: { name: string; value: string }[] };
  /** The expected text of each `field-equals` text check, by check id, with dynamic references rewritten. */
  expectedText: Map<string, string>;
}

export interface PreparedPlan {
  steps: Map<string, PreparedStep>;
  /** Token name (`apipilot_dyn_<k>`) to the dynamic variable and its occurrence number. */
  tokens: Map<string, { kind: string; k: number }>;
}

/**
 * Numbers every `{{$name}}` occurrence in plan order, exactly as `DynamicRewriter` does: chains in
 * order, steps in order, and within a step the URL, query rows (name then value), header values, the
 * body, then the checks. The number is part of a dynamic value, so the order is part of the contract.
 */
export function preparePlan(plan: Pick<ChainPlan, "chains">): PreparedPlan {
  const tokens = new Map<string, { kind: string; k: number }>();
  const rewrite = (text: string): string =>
    text.replace(DYNAMIC_REFERENCE, (_match, name: string) => {
      const k = tokens.size;
      const token = `${DYNAMIC_PREFIX}${k}`;
      tokens.set(token, { kind: name, k });
      return `{{${token}}}`;
    });
  const steps = new Map<string, PreparedStep>();
  for (const chain of plan.chains) for (const step of chain.steps) steps.set(step.id, prepareStep(step, rewrite));
  return { steps, tokens };
}

function prepareStep(step: ChainStep, rewrite: (text: string) => string): PreparedStep {
  const url = rewrite(step.url);
  const query = step.query.map((row) => ({ name: rewrite(row.name), value: rewrite(row.value) }));
  const headers = step.headers.map((header) => ({ name: header.name, value: rewrite(header.value) }));
  const body: PreparedStep["body"] =
    step.body.kind === "raw"
      ? { kind: "raw", contentType: step.body.contentType, fill: isJsonContentType(step.body.contentType) ? "json" : "raw", text: rewrite(step.body.text) }
      : step.body.kind === "form"
        ? { kind: "form", fields: step.body.fields.map((field) => ({ name: rewrite(field.name), value: rewrite(field.value) })) }
        : { kind: "none" };
  const expectedText = new Map<string, string>();
  for (const check of step.checks) {
    if (check.kind === "field-equals" && check.expected.type === "text") expectedText.set(check.id, rewrite(check.expected.value));
  }
  return { step, url, query, headers, body, expectedText };
}

/** Where a plain `{{name}}` gets its value when the chain has not extracted it. */
export interface ValueSource {
  /** An environment value, `baseUrl` included; `undefined` when absent or empty. */
  environment(name: string): string | undefined;
  /** A data set column's value in the row used, or `undefined`. */
  column(name: string): string | undefined;
}

export interface Scope {
  /** Values extracted so far. They win over every other source. */
  vars: ReadonlyMap<string, string>;
}

export interface ResolveContext {
  prepared: PreparedPlan;
  values: ValueSource;
  dynamic: DynamicContext;
}

/** `scope.vars`, then a dynamic variable, then a data set column, then the environment, then "". */
function resolve(name: string, scope: Scope, context: ResolveContext): string {
  const extracted = scope.vars.get(name);
  if (extracted !== undefined) return extracted;
  const token = context.prepared.tokens.get(name);
  if (token) return dynamicValue(token.kind, token.k, context.dynamic);
  const column = context.values.column(name);
  if (column !== undefined) return column;
  return context.values.environment(name) ?? "";
}

export type FillMode = "url" | "json" | "raw";

export function fill(template: string, scope: Scope, context: ResolveContext, mode: FillMode): string {
  return template.replace(REFERENCE, (_match, name: string) => {
    const value = String(resolve(name, scope, context));
    if (mode === "url") return name === "baseUrl" ? value : encodeURIComponent(value);
    if (mode === "json") return JSON.stringify(value).slice(1, -1);
    return value;
  });
}

export interface BuiltRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

/** The request one step sends now. The raw body's content type applies only when no header sets one. */
export function buildRequest(prepared: PreparedStep, scope: Scope, context: ResolveContext): BuiltRequest {
  let url = fill(prepared.url, scope, context, "url");
  const query: string[] = [];
  for (const row of prepared.query) query.push(`${encodeURIComponent(fill(row.name, scope, context, "raw"))}=${encodeURIComponent(fill(row.value, scope, context, "raw"))}`);
  if (query.length > 0) url += `?${query.join("&")}`;
  const headers: Record<string, string> = {};
  let typed = false;
  for (const header of prepared.headers) {
    headers[header.name] = fill(header.value, scope, context, "raw");
    if (header.name.toLowerCase() === "content-type") typed = true;
  }
  let body: string | null = null;
  if (prepared.body.kind === "raw") {
    body = fill(prepared.body.text, scope, context, prepared.body.fill);
    if (!typed) headers["Content-Type"] = prepared.body.contentType;
  }
  if (prepared.body.kind === "form") {
    const pairs: string[] = [];
    for (const field of prepared.body.fields) pairs.push(`${encodeURIComponent(fill(field.name, scope, context, "raw"))}=${encodeURIComponent(fill(field.value, scope, context, "raw"))}`);
    body = pairs.join("&");
    if (!typed) headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  return { method: prepared.step.method, url, headers, body };
}

/** A check's expected text with its references filled, as the runtime's `fill(expected.value, scope, "raw")`. */
export function expectedTextOf(prepared: PreparedStep, check: StepCheck, scope: Scope, context: ResolveContext): string {
  const template = prepared.expectedText.get(check.id);
  return template === undefined ? "" : fill(template, scope, context, "raw");
}
