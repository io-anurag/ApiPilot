import { runnableJourneys, type PerformancePlan } from "@apipilot/shared-domain";
import { compareCodeUnits } from "../../postman/ordering";
import { sha256Hex } from "../plan/identifiers";
import { stepRequestFor, uniqueTokensOf, type StepCapture, type UniqueToken } from "../plan/planStepRequest";
import { planAuth, type PerformanceContext, type RequestTemplate, type TokenSource } from "../plan/stepRequest";

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

/**
 * AP-036 (specs/036-collection-performance-test research R2, data-model `ScriptInputs`): what the
 * renderer reads for one plan, made explicit, so a plan built from an OpenAPI context and one built
 * from a stored collection render through the same code. Every field is data only (FR-023).
 */
export interface RenderedStepInput {
  operationKey: string;
  request: RequestTemplate;
  expected: string[];
  needs: string[];
  dependsOn: string[];
  /** AP-035 research R7: what the step captures, as data only (FR-018). */
  captures: StepCapture[];
  /** AP-036 research R10: every token source the step's request uses, in plan order. */
  tokenSchemes: string[];
}

export interface RenderedTokenSource {
  scheme: string;
  kind: TokenSource["kind"] | "collection-request";
  request: RequestTemplate;
  needs: string[];
  /** AP-036 research R10: each value the token request provides; an AP-029 source has one. */
  captures: StepCapture[];
  /** AP-036 research R8: present on a collection credential request, whose status is checked. */
  expected?: string[];
}

/** AP-036 research R9: a Postman dynamic variable occurrence, `{{apipilot_dyn_<k>}}` in a template. */
export interface DynamicToken {
  token: string;
  kind: string;
}

export interface ScriptInputs {
  steps: Map<string, RenderedStepInput>;
  tokenSources: RenderedTokenSource[];
  unique: Pick<UniqueToken, "token" | "format" | "original">[];
  dynamic: DynamicToken[];
}

interface RenderedStep extends RenderedStepInput {
  id: string;
}

interface RenderedJourney {
  id: string;
  steps: RenderedStep[];
}

function formatDuration(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;
}

/** An AP-029 token source's one value: its token variable, taken from its response field. */
function tokenSourceCaptures(source: TokenSource): StepCapture[] {
  return [{ key: source.tokenVariable, name: source.tokenVariable, source: { body: source.responseField.split(".") } }];
}

/** The renderer's inputs for a plan built from an OpenAPI context (AP-029, AP-032, AP-035). */
export function scriptInputsFromContext(plan: PerformancePlan, context: PerformanceContext): ScriptInputs {
  const auth = planAuth(context);
  const unique = uniqueTokensOf(plan, context);
  const usedSchemes = new Set<string>();
  const steps = new Map<string, RenderedStepInput>();
  // AP-035 FR-025: an incomplete user-defined journey is not run.
  for (const journey of runnableJourneys(plan.journeys)) {
    for (const step of journey.steps) {
      const { built, captures } = stepRequestFor(plan, context, auth, step.id, unique);
      const tokenScheme =
        built.schemeName && auth.tokenSources.has(built.schemeName) && (built.authKind === "oauth2-client-credentials" || built.authKind === "chained-login")
          ? built.schemeName
          : null;
      if (tokenScheme) usedSchemes.add(tokenScheme);
      steps.set(step.id, {
        operationKey: step.operationKey,
        request: built.template,
        expected: step.expectedStatuses.map((status) => status.code),
        needs: built.envNames,
        dependsOn: [
          ...new Set(step.variableBindings.flatMap((binding) => (binding.role === "consumes" && binding.producerStepId ? [binding.producerStepId] : []))),
        ],
        captures,
        tokenSchemes: tokenScheme ? [tokenScheme] : [],
      });
    }
  }
  const tokenSources: RenderedTokenSource[] = [...usedSchemes].sort(compareCodeUnits).map((scheme) => {
    const source = auth.tokenSources.get(scheme)!;
    return { scheme, kind: source.kind, request: source.request, needs: source.envNames, captures: tokenSourceCaptures(source) };
  });
  return { steps, tokenSources, unique, dynamic: [] };
}

export function renderScript(plan: PerformancePlan, context: PerformanceContext): RenderedScript {
  return renderScriptFrom(plan, scriptInputsFromContext(plan, context));
}

export function renderScriptFrom(plan: PerformancePlan, inputs: ScriptInputs): RenderedScript {
  const valueIndex: Record<string, number> = {};
  plan.userSuppliedValues.forEach((value, index) => {
    valueIndex[value.name] = index;
  });

  const journeys: RenderedJourney[] = runnableJourneys(plan.journeys).map((journey) => ({
    id: journey.id,
    steps: journey.steps.map((step): RenderedStep => {
      const input = inputs.steps.get(step.id);
      if (!input) throw new Error(`The script has no request for step ${step.id}.`);
      return {
        id: step.id,
        operationKey: input.operationKey,
        request: input.request,
        expected: input.expected,
        needs: input.needs,
        dependsOn: input.dependsOn,
        captures: input.captures,
        tokenSchemes: input.tokenSchemes,
      };
    }),
  }));

  const tokenSources = inputs.tokenSources.map((source) => ({
    scheme: source.scheme,
    kind: source.kind,
    request: source.request,
    needs: source.needs,
    captures: source.captures,
    ...(source.expected === undefined ? {} : { expected: source.expected }),
  }));

  const usesBasic =
    journeys.some((journey) => journey.steps.some((step) => step.request.auth.kind === "basic")) ||
    tokenSources.some((source) => source.request.auth.kind === "basic");

  // AP-029 FR-022a (amended 2026-10-01): value name → its environment variable, as a literal
  // table, so AP-034's check can list the names a downloaded copy reads (specs/034 research R5).
  const valueEnv = Object.fromEntries(plan.userSuppliedValues.map((value) => [value.name, `APIPILOT_V_${valueIndex[value.name]}`]));

  const lines: string[] = [
    "// ApiPilot k6 performance test (AP-029, specs/031-k6-performance-testing).",
    "// Generated by ApiPilot. Only the unmodified generated script runs from the performance plan;",
    "// an edited copy can be run only as your own script in Run k6 Script (AP-034). It contains no",
    "// values: each value named in VALUE_ENV is read from that environment variable at run time.",
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
    `const VALUE_ENV = ${JSON.stringify(valueEnv, null, 2)};`,
    `const THINK_TIME_S = ${JSON.stringify(plan.thinkTimeMs / 1000)};`,
    `const UNIQUE = ${JSON.stringify(Object.fromEntries(inputs.unique.map((entry) => [entry.token, { format: entry.format, original: entry.original }])), null, 2)};`,
    `const DYNAMIC = ${JSON.stringify(Object.fromEntries(inputs.dynamic.map((entry) => [entry.token, { kind: entry.kind }])), null, 2)};`,
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
 *
 * AP-029 FR-022a (amended 2026-10-01; specs/034 research R23): the interpreter passes AP-034's
 * script check as written. Run-time lookups use `Map`s and `const` literal tables, setup hands its
 * tokens over as an array (k6 passes setup data to virtual users as JSON), and a response field is
 * found by walking the body's own fields, so an inherited name such as `toString` never counts as
 * extracted.
 *
 * AP-035 FR-010, FR-033 (specs/035 research R7, R8, R13): one capture rule for every step, workflow
 * variables included. A step's captures are attempted only when it received an expected status, and
 * succeed only for a string, a finite number or a boolean, sent as its text. A body capture walks
 * stored field names and array positions; a header capture matches the name regardless of case and
 * takes the value exactly as k6 reports it, never split. Each outcome is counted by capture name in
 * `apipilot_capture`; the first failed capture is named on `apipilot_cut_short`. No value is tagged.
 *
 * AP-036 (specs/036-collection-performance-test research R9, R10), the same text for every plan:
 * - `DYNAMIC` names the Postman dynamic variables a plan uses. Each occurrence is generated from the
 *   virtual user, the iteration, its occurrence index and the word lists below, never from
 *   `Math.random()`; the four unique kinds also carry `APIPILOT_RUN_TAG`, a run setting, so the
 *   script's bytes never change between runs. A tag that is not 6 lowercase hex characters is none.
 * - A token source provides one or more captures, taken with the capture rule above. A source with
 *   `expected` (a collection's credential request) is checked against it, and a failure before the
 *   load is counted as `setup-failed` with the capture that failed (`""` for the status). Its values
 *   stay empty, so the steps that use them fail as authentication failures.
 * - A step may use tokens from several sources (`tokenSchemes`); a source may use an earlier one's.
 * - A `form` body fills each reference URL-encoded.
 * - k6 hands setup data to virtual users as JSON with `undefined` written as `null`, so a token
 *   source that acquired nothing is recognised by its values not being an array.
 */
const RUNTIME = String.raw`const missingData = new Counter("apipilot_missing_data");
const notAttempted = new Counter("apipilot_not_attempted");
const cutShort = new Counter("apipilot_cut_short");
const tokenRefresh = new Counter("apipilot_token_refresh");
const captureOutcome = new Counter("apipilot_capture");
const REFERENCE = /\{\{([^{}]+)\}\}/g;
const RUN_TAG_SETTING = __ENV.APIPILOT_RUN_TAG;
const RUN_TAG = typeof RUN_TAG_SETTING === "string" && /^[0-9a-f]{6}$/.test(RUN_TAG_SETTING) ? RUN_TAG_SETTING : "";
const FIRST_NAMES = ["Ada", "Alan", "Barbara", "Claude", "Dennis", "Donald", "Edsger", "Frances", "Grace", "Hedy", "Ivan", "Jean", "Ken", "Katherine", "Leslie", "Linus", "Margaret", "Niklaus", "Radia", "Rosalind", "Sophie", "Tim", "Vint", "Whitfield"];
const LAST_NAMES = ["Allen", "Babbage", "Backus", "Berners", "Cerf", "Diffie", "Dijkstra", "Engelbart", "Hamilton", "Hopper", "Johnson", "Kahn", "Knuth", "Lamarr", "Lamport", "Liskov", "Lovelace", "Perlman", "Ritchie", "Shannon", "Sutherland", "Thompson", "Turing", "Wirth"];
const ALPHANUMERIC = "0123456789abcdefghijklmnopqrstuvwxyz";
const SOURCE_BY_SCHEME = {};
for (const source of TOKEN_SOURCES) SOURCE_BY_SCHEME[source.scheme] = source;

function env(name) {
  if (!Object.prototype.hasOwnProperty.call(VALUE_ENV, name)) return undefined;
  const value = __ENV[VALUE_ENV[name]];
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

function mix(vu, iteration, k) {
  let h = Math.imul(vu ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(iteration + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(k + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function dynamicValue(name) {
  const kind = DYNAMIC[name].kind;
  const k = Number(name.slice("apipilot_dyn_".length));
  const m = mix(__VU, __ITER, k);
  const first = FIRST_NAMES[m % FIRST_NAMES.length];
  const last = LAST_NAMES[Math.floor(m / FIRST_NAMES.length) % LAST_NAMES.length];
  const person = (first + "." + last).toLowerCase();
  if (kind === "$guid" || kind === "$randomUUID") {
    const tag = RUN_TAG === "" ? "000000" : RUN_TAG;
    return hex(__VU, 8) + "-" + hex(k, 4) + "-4" + tag.slice(0, 3) + "-8" + tag.slice(3) + "-" + hex(__ITER, 12);
  }
  if (kind === "$timestamp") return String(Math.floor(Date.now() / 1000));
  if (kind === "$isoTimestamp") return new Date(Date.now()).toISOString();
  if (kind === "$randomInt") return String(m % 1001);
  if (kind === "$randomFirstName") return first;
  if (kind === "$randomLastName") return last;
  if (kind === "$randomFullName") return first + " " + last;
  if (kind === "$randomUserName") return person + (RUN_TAG === "" ? "" : "_r" + RUN_TAG) + "_vu" + __VU + "_it" + __ITER + "_" + k;
  if (kind === "$randomEmail") return person + "+" + (RUN_TAG === "" ? "" : "r" + RUN_TAG + "-") + "vu" + __VU + "-it" + __ITER + "-" + k + "@example.com";
  if (kind === "$randomPhoneNumber") return String(200 + (m % 800)) + "-" + String(200 + (Math.floor(m / 800) % 800)) + "-" + String(10000 + (Math.floor(m / 640000) % 10000)).slice(1);
  if (kind === "$randomAlphaNumeric") return ALPHANUMERIC[m % ALPHANUMERIC.length];
  if (kind === "$randomBoolean") return m % 2 === 0 ? "true" : "false";
  return "";
}

function resolve(name, scope) {
  if (scope.vars.has(name)) return scope.vars.get(name);
  if (scope.tokens.has(name)) return scope.tokens.get(name);
  if (Object.prototype.hasOwnProperty.call(DYNAMIC, name)) return dynamicValue(name);
  if (Object.prototype.hasOwnProperty.call(UNIQUE, name)) return uniqueValue(name);
  const value = env(name);
  return value === undefined ? "" : value;
}

function fill(template, scope, mode) {
  return template.replace(REFERENCE, function (match, name) {
    const value = String(resolve(name, scope));
    if (mode === "url") return name === "baseUrl" ? value : encodeURIComponent(value);
    if (mode === "json") return JSON.stringify(value).slice(1, -1);
    if (mode === "form") return encodeURIComponent(value);
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
  const bodyMode = request.bodyKind === "json" || request.bodyKind === "form" ? request.bodyKind : "raw";
  const body = request.body === undefined ? null : fill(request.body, scope, bodyMode);
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
    let found = false;
    for (const [key, child] of Object.entries(value)) {
      if (key === part) {
        value = child;
        found = true;
        break;
      }
    }
    if (!found) return undefined;
  }
  return value;
}

function bodyValue(response, path) {
  let value;
  try {
    value = response.json();
  } catch (error) {
    return undefined;
  }
  for (const part of path) {
    if (value === null || typeof value !== "object") return undefined;
    if (typeof part === "number" && !Array.isArray(value)) return undefined;
    const name = String(part);
    let found = false;
    for (const [key, child] of Object.entries(value)) {
      if (key === name) {
        value = child;
        found = true;
        break;
      }
    }
    if (!found) return undefined;
  }
  return value;
}

function headerValue(response, name) {
  const headers = response.headers;
  if (headers === null || typeof headers !== "object") return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

function captured(response, source) {
  const value = source.header !== undefined ? headerValue(response, source.header) : bodyValue(response, source.body);
  if (typeof value === "string") return value === "" ? undefined : value;
  if (typeof value === "number") return isFinite(value) ? String(value) : undefined;
  if (typeof value === "boolean") return String(value);
  return undefined;
}

function statusOk(status, expected) {
  const text = String(status);
  for (const code of expected) {
    if (code.length === 3 && code.slice(1) === "XX" ? text.length === 3 && text[0] === code[0] : text === code) return true;
  }
  return false;
}

function acquire(source, kind, tokens) {
  for (const name of source.needs) if (env(name) === undefined) return { values: undefined, failed: null, acquiredAtMs: Date.now(), lifetimeS: 0 };
  const request = build(source.request, { vars: new Map(), tokens: tokens });
  const response = http.request(request.method, request.url, request.body, {
    headers: request.headers,
    tags: { apipilot_kind: kind },
    responseType: "text",
  });
  if (source.expected !== undefined && !statusOk(response.status, source.expected)) {
    return { values: undefined, failed: "", acquiredAtMs: Date.now(), lifetimeS: 0 };
  }
  const values = [];
  for (const capture of source.captures) {
    const value = captured(response, capture.source);
    if (value === undefined) return { values: undefined, failed: capture.name, acquiredAtMs: Date.now(), lifetimeS: 0 };
    values.push({ key: capture.key, value: value });
  }
  const lifetime = Number(jsonField(response, "expires_in"));
  return { values: values, failed: null, acquiredAtMs: Date.now(), lifetimeS: isFinite(lifetime) && lifetime > 0 ? lifetime : 0 };
}

export function setup() {
  const tokens = [];
  const acquired = new Map();
  for (const source of TOKEN_SOURCES) {
    const token = acquire(source, "token-setup", acquired);
    if (token.failed !== null && source.expected !== undefined) tokenRefresh.add(1, { outcome: "setup-failed", scheme: source.scheme, capture: token.failed });
    if (token.values !== undefined && token.lifetimeS === 0) tokenRefresh.add(1, { outcome: "no-lifetime", scheme: source.scheme });
    if (token.values !== undefined) for (const entry of token.values) acquired.set(entry.key, entry.value);
    tokens.push({ scheme: source.scheme, values: token.values, acquiredAtMs: token.acquiredAtMs, lifetimeS: token.lifetimeS });
  }
  return { tokens: tokens };
}

let vuTokens = null;

function refreshFraction() {
  return 0.7 + 0.01 * ((__VU - 1) % 11);
}

function maybeRefresh(scheme) {
  const current = vuTokens.get(scheme);
  const source = SOURCE_BY_SCHEME[scheme];
  if (!current || !source || !Array.isArray(current.values) || !(current.lifetimeS > 0)) return;
  if (Date.now() - current.acquiredAtMs < current.lifetimeS * 1000 * refreshFraction()) return;
  const next = acquire(source, "token-refresh", tokenScope());
  if (next.values !== undefined) {
    vuTokens.set(scheme, next);
    tokenRefresh.add(1, { outcome: "ok", scheme: scheme });
  } else {
    current.acquiredAtMs = Date.now();
    tokenRefresh.add(1, { outcome: "failed", scheme: scheme });
  }
}

function tokenScope() {
  const tokens = new Map();
  for (const source of TOKEN_SOURCES) {
    const token = vuTokens.get(source.scheme);
    for (const capture of source.captures) tokens.set(capture.key, "");
    if (token && Array.isArray(token.values)) for (const entry of token.values) tokens.set(entry.key, entry.value);
  }
  return tokens;
}

function runJourney(journey, run) {
  const scope = { vars: new Map(), tokens: new Map() };
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
    for (const scheme of step.tokenSchemes) maybeRefresh(scheme);
    scope.tokens = tokenScope();
    if (run.sent > 0 && THINK_TIME_S > 0) sleep(THINK_TIME_S);
    const request = build(step.request, scope);
    const response = http.request(request.method, request.url, request.body, {
      headers: request.headers,
      tags: tags,
      responseType: step.captures.length > 0 ? "text" : "none",
    });
    run.sent += 1;
    const expectedStatus = statusOk(response.status, step.expected);
    check(response, { status: function (r) { return statusOk(r.status, step.expected); } }, tags);
    let failedCapture = null;
    for (const capture of step.captures) {
      const value = expectedStatus ? captured(response, capture.source) : undefined;
      const ok = value !== undefined;
      check(response, { extraction: function () { return ok; } }, tags);
      captureOutcome.add(1, { step: step.id, journey: journey.id, capture: capture.name, outcome: ok ? "ok" : "failed" });
      if (ok) scope.vars.set(capture.key, value);
      else if (failedCapture === null) failedCapture = capture.name;
    }
    if (failedCapture !== null) {
      cutShort.add(1, { step: step.id, journey: journey.id, capture: failedCapture });
      for (const rest of journey.steps.slice(index + 1)) notAttempted.add(1, { step: rest.id, journey: journey.id, reason: "cut-short" });
      return;
    }
  }
}

export default function (data) {
  if (vuTokens === null) {
    vuTokens = new Map();
    for (const token of data.tokens) {
      vuTokens.set(token.scheme, { values: token.values, acquiredAtMs: token.acquiredAtMs, lifetimeS: token.lifetimeS });
    }
  }
  const run = { sent: 0 };
  for (const journey of JOURNEYS) runJourney(journey, run);
}`;
