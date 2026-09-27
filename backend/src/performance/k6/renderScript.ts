import type { ApiOperation, PerformancePlan, TestScenario, WorkflowVariable } from "@apipilot/shared-domain";
import { workflowVariableName } from "../../postman/workflowRendering";
import { compareCodeUnits } from "../../postman/ordering";
import { sha256Hex } from "../plan/identifiers";
import {
  buildStepRequest,
  operationKeyOf,
  planAuth,
  UNIQUE_TOKEN_PREFIX,
  type PerformanceContext,
  type RequestTemplate,
  type TokenSource,
} from "../plan/stepRequest";

/**
 * Renders a Performance Plan as a k6 script and an environment template
 * (specs/031-k6-performance-testing FR-020, FR-021; research D7, D8, D10 to D14, D25, D26).
 *
 * The script is data plus one fixed runtime: the plan's journeys, request templates, expected
 * codes and extractions are embedded as JSON constants, and a small interpreter below runs them.
 * Nothing in the output depends on time, randomness or the environment, so the same plan always
 * renders byte-identical files (SC-001). No value is ever embedded: templates hold only
 * `{{name}}` references, and values reach k6 only as `APIPILOT_V_<index>` environment variables
 * at run time (FR-021, D7). Only k6's built-in modules are imported (D8).
 */
export interface RenderedScript {
  script: string;
  environmentTemplate: string;
  /** Value name → index of its `APIPILOT_V_<index>` variable. */
  valueIndex: Record<string, number>;
}

/** k6 system tags kept on every sample. `url` and `name` are excluded, so no resolved URL reaches the metrics stream (FR-040, D11). */
export const SYSTEM_TAGS = ["status", "method", "error_code", "check", "group"] as const;

export const K6_BUILTIN_IMPORTS = ["k6", "k6/http", "k6/metrics", "k6/encoding"] as const;

interface RenderedStep {
  id: string;
  operationKey: string;
  request: RequestTemplate;
  expected: string[];
  needs: string[];
  dependsOn: string[];
  produces: { key: string; variable: string; field: string }[];
  tokenScheme: string | null;
}

interface RenderedJourney {
  id: string;
  steps: RenderedStep[];
}

interface RenderedTokenSource {
  scheme: string;
  kind: TokenSource["kind"];
  tokenVariable: string;
  request: RequestTemplate;
  responseField: string;
  needs: string[];
}

function formatDuration(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;
}

function originalValue(body: unknown, fieldPath: string): string {
  let current: unknown = body;
  for (const part of fieldPath.split(".")) {
    if (current === null || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : "";
}

function stepPositionsOf(workflow: PerformanceContext["workflows"][number]): Map<string, number> {
  return new Map(
    [...workflow.steps]
      .sort((a, b) => a.position - b.position)
      .map((step, index) => [`${step.operationMethod.toUpperCase()} ${step.operationPath}`, index]),
  );
}

export function renderScript(plan: PerformancePlan, context: PerformanceContext): RenderedScript {
  const auth = planAuth(context);
  const valueIndex: Record<string, number> = {};
  plan.userSuppliedValues.forEach((value, index) => {
    valueIndex[value.name] = index;
  });

  const operations = new Map<string, ApiOperation>(context.apiModel.operations.map((op) => [operationKeyOf(op), op]));
  const scenarios = new Map<string, TestScenario>(context.approvedScenarios.map((scenario) => [scenario.id, scenario]));

  const unique = plan.uniqueValueFields.map((field, index) => {
    const step = plan.journeys.flatMap((journey) => journey.steps).find((candidate) => candidate.id === field.stepId);
    const scenario = step ? scenarios.get(step.scenarioId) : undefined;
    return {
      token: `${UNIQUE_TOKEN_PREFIX}${index}`,
      stepId: field.stepId,
      fieldPath: field.fieldPath,
      format: field.format,
      original: originalValue(scenario?.request.body, field.fieldPath),
    };
  });

  const usedSchemes = new Set<string>();
  const journeys: RenderedJourney[] = plan.journeys.map((journey) => {
    const workflow =
      journey.source.kind === "workflow"
        ? context.workflows.find((candidate) => candidate.id === (journey.source as { workflowId: string }).workflowId)
        : undefined;
    const positions = workflow ? stepPositionsOf(workflow) : new Map<string, number>();
    return {
      id: journey.id,
      steps: journey.steps.map((step): RenderedStep => {
        const operation = operations.get(step.operationKey);
        const scenario = scenarios.get(step.scenarioId);
        if (!operation || !scenario) throw new Error(`The plan's step ${step.id} no longer matches the approvals.`);
        const position = positions.get(step.operationKey);
        const variables: WorkflowVariable[] = workflow?.variables ?? [];
        const consumes = position === undefined ? [] : variables.filter((variable) => variable.consumerStepIndex === position);
        const produces = position === undefined ? [] : variables.filter((variable) => variable.producerStepIndex === position);
        const built = buildStepRequest(context, auth, operation, scenario, {
          workflowId: workflow?.id,
          consumes,
          uniqueFields: unique.filter((entry) => entry.stepId === step.id).map((entry) => ({ fieldPath: entry.fieldPath, token: entry.token })),
        });
        const tokenScheme =
          built.schemeName && auth.tokenSources.has(built.schemeName) && (built.authKind === "oauth2-client-credentials" || built.authKind === "chained-login")
            ? built.schemeName
            : null;
        if (tokenScheme) usedSchemes.add(tokenScheme);
        return {
          id: step.id,
          operationKey: step.operationKey,
          request: built.template,
          expected: step.expectedStatuses.map((status) => status.code),
          needs: built.envNames,
          dependsOn: [
            ...new Set(
              step.variableBindings.flatMap((binding) => (binding.role === "consumes" && binding.producerStepId ? [binding.producerStepId] : [])),
            ),
          ],
          produces: produces.map((variable) => ({
            key: workflowVariableName(workflow!.id, variable.name),
            variable: variable.name,
            field: variable.producerField,
          })),
          tokenScheme,
        };
      }),
    };
  });

  const tokenSources: RenderedTokenSource[] = [...usedSchemes].sort(compareCodeUnits).map((scheme) => {
    const source = auth.tokenSources.get(scheme)!;
    return {
      scheme,
      kind: source.kind,
      tokenVariable: source.tokenVariable,
      request: source.request,
      responseField: source.responseField,
      needs: source.envNames,
    };
  });

  const usesBasic =
    journeys.some((journey) => journey.steps.some((step) => step.request.auth.kind === "basic")) ||
    tokenSources.some((source) => source.request.auth.kind === "basic");

  const lines: string[] = [
    "// ApiPilot k6 performance test (AP-029, specs/031-k6-performance-testing).",
    "// Generated by ApiPilot; do not edit. Only the unmodified generated script can be run from",
    "// ApiPilot. It contains no values: each value named in VALUE_INDEX is read from the",
    "// environment variable APIPILOT_V_<index> at run time.",
    `// Plan fingerprint: ${plan.fingerprint}`,
    'import http from "k6/http";',
    'import { check, sleep } from "k6";',
    'import { Counter } from "k6/metrics";',
    ...(usesBasic ? ['import encoding from "k6/encoding";'] : []),
    "",
    `export const options = ${JSON.stringify(
      {
        stages: plan.loadProfile.stages.map((stage) => ({ duration: formatDuration(stage.durationMs), target: stage.targetVirtualUsers })),
        systemTags: SYSTEM_TAGS,
      },
      null,
      2,
    )};`,
    "",
    `const VALUE_INDEX = ${JSON.stringify(valueIndex, null, 2)};`,
    `const THINK_TIME_S = ${JSON.stringify(plan.thinkTimeMs / 1000)};`,
    `const UNIQUE = ${JSON.stringify(Object.fromEntries(unique.map((entry) => [entry.token, { format: entry.format, original: entry.original }])), null, 2)};`,
    `const TOKEN_SOURCES = ${JSON.stringify(tokenSources, null, 2)};`,
    `const JOURNEYS = ${JSON.stringify(journeys, null, 2)};`,
    "",
    ...RUNTIME.split("\n").map((line) => (usesBasic ? line : line.replace(BASIC_LINE, BASIC_UNSUPPORTED))),
  ];
  const script = `${lines.join("\n")}\n`;

  const templateEntries = Object.fromEntries(
    plan.userSuppliedValues.map((value) => [
      value.name,
      { env: `APIPILOT_V_${valueIndex[value.name]}`, secret: value.secret, value: "" },
    ]),
  );
  const environmentTemplate = `${JSON.stringify(templateEntries, null, 2)}\n`;

  return { script, environmentTemplate, valueIndex };
}

export function scriptDigest(text: string): string {
  return sha256Hex(text);
}

const BASIC_LINE = '    headers.Authorization = "Basic " + encoding.b64encode(fill(auth.username, scope, "raw") + ":" + fill(auth.password, scope, "raw"));';
const BASIC_UNSUPPORTED = "    // Basic auth is not used by this plan.";

/**
 * The fixed interpreter. It reads only the constants above, `__ENV`, `__VU` and `__ITER`. Metrics:
 * each request is tagged `{step, journey}`; token requests carry `apipilot_kind` and no `step`, so
 * they never enter a step's figures (D12). Custom counters record what a request count cannot:
 * missing data, dependants not attempted, journeys cut short, and token refreshes.
 */
const RUNTIME = String.raw`const missingData = new Counter("apipilot_missing_data");
const notAttempted = new Counter("apipilot_not_attempted");
const cutShort = new Counter("apipilot_cut_short");
const tokenRefresh = new Counter("apipilot_token_refresh");
const REFERENCE = /\{\{([^{}]+)\}\}/g;
const SOURCE_BY_SCHEME = {};
for (const source of TOKEN_SOURCES) SOURCE_BY_SCHEME[source.scheme] = source;

function env(name) {
  const index = VALUE_INDEX[name];
  if (index === undefined) return undefined;
  const value = __ENV["APIPILOT_V_" + index];
  return value === undefined || value === "" ? undefined : value;
}

function hex(value, width) {
  let text = Number(value).toString(16);
  while (text.length < width) text = "0" + text;
  return text.slice(-width);
}

function uniqueValue(token) {
  const entry = UNIQUE[token];
  if (entry.format === "uuid") return hex(__VU, 8) + "-0000-4000-8000-" + hex(__ITER, 12);
  const at = entry.original.indexOf("@");
  const suffix = "+vu" + __VU + "-it" + __ITER;
  return at < 0 ? entry.original + suffix : entry.original.slice(0, at) + suffix + entry.original.slice(at);
}

function resolve(name, scope) {
  if (Object.prototype.hasOwnProperty.call(scope.vars, name)) return scope.vars[name];
  if (Object.prototype.hasOwnProperty.call(scope.tokens, name)) return scope.tokens[name];
  if (Object.prototype.hasOwnProperty.call(UNIQUE, name)) return uniqueValue(name);
  const value = env(name);
  return value === undefined ? "" : value;
}

function fill(template, scope, mode) {
  return template.replace(REFERENCE, function (match, name) {
    const value = String(resolve(name, scope));
    if (mode === "url") return name === "baseUrl" ? value : encodeURIComponent(value);
    if (mode === "json") return JSON.stringify(value).slice(1, -1);
    return value;
  });
}

function build(request, scope) {
  let url = fill(request.url, scope, "url");
  const headers = {};
  for (const header of request.headers) headers[fill(header.key, scope, "raw")] = fill(header.value, scope, "raw");
  const auth = request.auth;
  if (auth.kind === "bearer") headers.Authorization = "Bearer " + fill(auth.token, scope, "raw");
  if (auth.kind === "apikey" && auth.in === "header") headers[auth.key] = fill(auth.value, scope, "raw");
  if (auth.kind === "apikey" && auth.in === "query") url += (url.indexOf("?") < 0 ? "?" : "&") + encodeURIComponent(auth.key) + "=" + encodeURIComponent(fill(auth.value, scope, "raw"));
  if (auth.kind === "basic") {
    headers.Authorization = "Basic " + encoding.b64encode(fill(auth.username, scope, "raw") + ":" + fill(auth.password, scope, "raw"));
  }
  const body = request.body === undefined ? null : fill(request.body, scope, request.bodyKind === "json" ? "json" : "raw");
  return { method: request.method, url: url, headers: headers, body: body };
}

function jsonField(response, path) {
  let value;
  try {
    value = response.json();
  } catch (error) {
    return undefined;
  }
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = value[part];
  }
  return value;
}

function statusOk(status, expected) {
  const text = String(status);
  for (const code of expected) {
    if (code.length === 3 && code.slice(1) === "XX" ? text.length === 3 && text[0] === code[0] : text === code) return true;
  }
  return false;
}

function acquire(source, kind) {
  for (const name of source.needs) if (env(name) === undefined) return { value: undefined, acquiredAtMs: Date.now(), lifetimeS: 0 };
  const request = build(source.request, { vars: {}, tokens: {} });
  const response = http.request(request.method, request.url, request.body, {
    headers: request.headers,
    tags: { apipilot_kind: kind },
    responseType: "text",
  });
  const value = jsonField(response, source.responseField);
  const lifetime = Number(jsonField(response, "expires_in"));
  return {
    value: value === undefined || value === null || value === "" ? undefined : String(value),
    acquiredAtMs: Date.now(),
    lifetimeS: isFinite(lifetime) && lifetime > 0 ? lifetime : 0,
  };
}

export function setup() {
  const tokens = {};
  for (const source of TOKEN_SOURCES) {
    const token = acquire(source, "token-setup");
    if (token.value !== undefined && token.lifetimeS === 0) tokenRefresh.add(1, { outcome: "no-lifetime", scheme: source.scheme });
    tokens[source.scheme] = token;
  }
  return { tokens: tokens };
}

let vuTokens = null;

function refreshFraction() {
  return 0.7 + 0.01 * ((__VU - 1) % 11);
}

function maybeRefresh(scheme) {
  const current = vuTokens[scheme];
  const source = SOURCE_BY_SCHEME[scheme];
  if (!current || !source || current.value === undefined || !(current.lifetimeS > 0)) return;
  if (Date.now() - current.acquiredAtMs < current.lifetimeS * 1000 * refreshFraction()) return;
  const next = acquire(source, "token-refresh");
  if (next.value !== undefined) {
    vuTokens[scheme] = next;
    tokenRefresh.add(1, { outcome: "ok", scheme: scheme });
  } else {
    current.acquiredAtMs = Date.now();
    tokenRefresh.add(1, { outcome: "failed", scheme: scheme });
  }
}

function tokenScope() {
  const tokens = {};
  for (const source of TOKEN_SOURCES) {
    const token = vuTokens[source.scheme];
    tokens[source.tokenVariable] = token && token.value !== undefined ? token.value : "";
  }
  return tokens;
}

function runJourney(journey, run) {
  const scope = { vars: {}, tokens: {} };
  const unavailable = {};
  for (let index = 0; index < journey.steps.length; index++) {
    const step = journey.steps[index];
    const tags = { step: step.id, journey: journey.id };
    const missing = step.needs.filter(function (name) {
      return env(name) === undefined;
    });
    if (missing.length > 0) {
      for (const name of missing) missingData.add(1, { step: step.id, journey: journey.id, variable: name });
      unavailable[step.id] = true;
      continue;
    }
    if (step.dependsOn.some(function (id) { return unavailable[id]; })) {
      notAttempted.add(1, { step: step.id, journey: journey.id, reason: "dependency" });
      unavailable[step.id] = true;
      continue;
    }
    if (step.tokenScheme) maybeRefresh(step.tokenScheme);
    scope.tokens = tokenScope();
    if (run.sent > 0 && THINK_TIME_S > 0) sleep(THINK_TIME_S);
    const request = build(step.request, scope);
    const response = http.request(request.method, request.url, request.body, {
      headers: request.headers,
      tags: tags,
      responseType: step.produces.length > 0 ? "text" : "none",
    });
    run.sent += 1;
    check(response, { status: function (r) { return statusOk(r.status, step.expected); } }, tags);
    let extracted = true;
    for (const produce of step.produces) {
      const value = jsonField(response, produce.field);
      const ok = value !== undefined && value !== null && String(value) !== "";
      check(response, { extraction: function () { return ok; } }, tags);
      if (ok) scope.vars[produce.key] = String(value);
      else extracted = false;
    }
    if (!extracted) {
      cutShort.add(1, { step: step.id, journey: journey.id });
      for (const rest of journey.steps.slice(index + 1)) notAttempted.add(1, { step: rest.id, journey: journey.id, reason: "cut-short" });
      return;
    }
  }
}

export default function (data) {
  if (vuTokens === null) {
    vuTokens = {};
    for (const scheme of Object.keys(data.tokens)) {
      const token = data.tokens[scheme];
      vuTokens[scheme] = { value: token.value, acquiredAtMs: token.acquiredAtMs, lifetimeS: token.lifetimeS };
    }
  }
  const run = { sent: 0 };
  for (const journey of JOURNEYS) runJourney(journey, run);
}`;
