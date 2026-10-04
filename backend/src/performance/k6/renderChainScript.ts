import {
  analyzeChainPlan,
  chainRunOrder,
  namesUsedBy,
  parseCapturePath,
  type ChainPlan,
  type ChainPlanAnalysis,
  type ChainStep,
  type StepCheck,
} from "@apipilot/shared-domain";
import { compareCodeUnits } from "../../postman/ordering";
import type { DynamicToken, RenderedScript } from "./scriptTypes";
import { SYSTEM_TAGS } from "./scriptTypes";

/**
 * Renders a request-chain plan as a k6 script and an environment template
 * (specs/037-request-chain-performance research R10 to R14; contracts/chain-script.md).
 *
 * The script is data plus one fixed runtime, `CHAIN_RUNTIME`, which is the same text for every plan.
 * The engineer's steps reach it only inside the JSON constants: URLs, query rows, headers and bodies
 * as text with `{{name}}` references; expected statuses; extractors as a name with a field path or a
 * header name; checks as one of four data forms. No expression, pattern, filter or function is ever
 * taken from a plan (constitution XVII, AP-037 conditions). Nothing depends on time, randomness, the
 * environment or a data set's content, so the same plan always renders byte-identical files
 * (FR-030, FR-047). Values reach k6 only as `APIPILOT_V_<index>` environment variables and, for data
 * sets, as per-run files ApiPilot writes and removes (FR-044).
 *
 * The legacy runtime in `renderScript.ts` is untouched (research R10): chain plans and the older
 * derived plans each keep their own fixed text until phase two retires the older one.
 */

export const CHAIN_K6_IMPORTS = ["k6", "k6/http", "k6/metrics", "k6/execution", "k6/data"] as const;

const DYNAMIC_REFERENCE = /\{\{(\$[A-Za-z0-9]+)\}\}/g;
const DYNAMIC_PREFIX = "apipilot_dyn_";

type Segment = string | number;

interface RenderedExtractor {
  name: string;
  body?: Segment[];
  header?: string;
}

type RenderedCheck =
  | { id: string; kind: "field-exists"; path: Segment[] }
  | { id: string; kind: "field-equals"; path: Segment[]; expected: { type: string; value: string | number | boolean } }
  | { id: string; kind: "body-contains"; text: string }
  | { id: string; kind: "time-at-most"; maxMs: number };

interface RenderedStep {
  id: string;
  chain: string;
  runs: ChainStep["runs"];
  method: string;
  url: string;
  query: { name: string; value: string }[];
  headers: { name: string; value: string }[];
  body: { kind: "none" } | { kind: "raw"; contentType: string; fill: "json" | "raw"; text: string } | { kind: "form"; fields: { name: string; value: string }[] };
  expected: string[];
  extractors: RenderedExtractor[];
  checks: RenderedCheck[];
  thinkS: number | null;
  needs: string[];
  uses: string[];
  columns: string[];
  refreshFrom: string[];
  readsBody: boolean;
}

function segmentsOf(path: string): Segment[] {
  const parsed = parseCapturePath(path);
  if (!parsed.ok) throw new Error("A field path that does not parse reached the renderer; the analysis blocks it first.");
  return parsed.segments.map((segment) => ("index" in segment ? segment.index : segment.field));
}

function isJson(contentType: string): boolean {
  const type = contentType.split(";")[0].trim().toLowerCase();
  return type === "application/json" || type.endsWith("+json");
}

/** Rewrites each `{{$name}}` occurrence, in plan order, to its own `{{apipilot_dyn_<k>}}` (research R5). */
class DynamicRewriter {
  readonly tokens: DynamicToken[] = [];

  rewrite(text: string): string {
    return text.replace(DYNAMIC_REFERENCE, (_match, name: string) => {
      const token = `${DYNAMIC_PREFIX}${this.tokens.length}`;
      this.tokens.push({ token, kind: name });
      return `{{${token}}}`;
    });
  }
}

function renderCheck(check: StepCheck, dynamic: DynamicRewriter): RenderedCheck {
  switch (check.kind) {
    case "field-exists":
      return { id: check.id, kind: "field-exists", path: segmentsOf(check.path) };
    case "field-equals":
      return {
        id: check.id,
        kind: "field-equals",
        path: segmentsOf(check.path),
        expected: check.expected.type === "text" ? { type: "text", value: dynamic.rewrite(check.expected.value) } : { type: check.expected.type, value: check.expected.value },
      };
    case "body-contains":
      return { id: check.id, kind: "body-contains", text: check.text };
    case "time-at-most":
      return { id: check.id, kind: "time-at-most", maxMs: check.maxMs };
  }
}

const BODY_CHECKS: ReadonlySet<StepCheck["kind"]> = new Set(["field-exists", "field-equals", "body-contains"]);

function renderStep(step: ChainStep, chainId: string, context: { needs: Map<string, string[]>; columns: Set<string>; extracted: Set<string>; setupExtracts: Map<string, string[]> }, dynamic: DynamicRewriter): RenderedStep {
  const url = dynamic.rewrite(step.url);
  const query = step.query.map((row) => ({ name: dynamic.rewrite(row.name), value: dynamic.rewrite(row.value) }));
  const headers = step.headers.map((header) => ({ name: header.name, value: dynamic.rewrite(header.value) }));
  const body: RenderedStep["body"] =
    step.body.kind === "raw"
      ? { kind: "raw", contentType: step.body.contentType, fill: isJson(step.body.contentType) ? "json" : "raw", text: dynamic.rewrite(step.body.text) }
      : step.body.kind === "form"
        ? { kind: "form", fields: step.body.fields.map((field) => ({ name: dynamic.rewrite(field.name), value: dynamic.rewrite(field.value) })) }
        : { kind: "none" };
  const checks = step.checks.map((check) => renderCheck(check, dynamic));
  const used = namesUsedBy(step);
  const uses = used.filter((name) => context.extracted.has(name));
  const refreshFrom =
    step.runs === "once-before-load" ? [] : [...context.setupExtracts.entries()].filter(([, names]) => names.some((name) => uses.includes(name))).map(([id]) => id);
  return {
    id: step.id,
    chain: chainId,
    runs: step.runs,
    method: step.method,
    url,
    query,
    headers,
    body,
    expected: step.expectedStatuses,
    extractors: step.extractors.map((extractor) =>
      extractor.source.kind === "body" ? { name: extractor.name, body: segmentsOf(extractor.source.path) } : { name: extractor.name, header: extractor.source.name.toLowerCase() },
    ),
    checks,
    thinkS: step.thinkTimeMs === null ? null : step.thinkTimeMs / 1000,
    needs: context.needs.get(step.id) ?? [],
    uses,
    columns: used.filter((name) => context.columns.has(name)),
    refreshFrom,
    readsBody: step.runs === "once-before-load" || step.extractors.length > 0 || step.checks.some((check) => BODY_CHECKS.has(check.kind)),
  };
}

function jsonConst(name: string, value: unknown): string {
  return `const ${name} = ${JSON.stringify(value, null, 2)};`;
}

/** The data set loaders: only for a plan with data sets, each reading one fixed file name (research R14). */
function dataLoaders(count: number): string {
  if (count === 0) return "const DATA = [];";
  const loaders = Array.from({ length: count }, (_unused, index) => `  new SharedArray("apipilot-data-${index}", function () {\n    return JSON.parse(open("./apipilot-data-${index}.json"));\n  }),`);
  return ["const DATA = [", ...loaders, "];"].join("\n");
}

/**
 * Renders `plan`. The caller has checked that `analysis` has no blockers (FR-014); the renderer
 * relies on that, for example that every field path parses and every URL has an allowed host.
 */
export function renderChainScript(plan: ChainPlan, analysis: ChainPlanAnalysis = analyzeChainPlan(plan, { environmentValueNames: null })): RenderedScript {
  const valueNames = analysis.requiredValues.map((value) => value.name).sort(compareCodeUnits);
  const valueIndex: Record<string, number> = {};
  valueNames.forEach((name, index) => {
    valueIndex[name] = index;
  });
  const needs = new Map<string, string[]>();
  for (const value of analysis.requiredValues) {
    for (const stepId of value.stepIds) needs.set(stepId, [...(needs.get(stepId) ?? []), value.name]);
  }
  const columns = new Set(plan.dataSets.flatMap((dataSet) => dataSet.columns.map((column) => column.name)));
  const extracted = new Set(analysis.extractedNames.map((entry) => entry.name));
  const order = chainRunOrder(plan);
  const setupExtracts = new Map(order.setup.map((entry) => [entry.step.id, entry.step.extractors.map((extractor) => extractor.name)] as const));
  const context = { needs, columns, extracted, setupExtracts };

  const dynamic = new DynamicRewriter();
  const rendered = new Map<string, RenderedStep>();
  for (const chain of plan.chains) for (const step of chain.steps) rendered.set(step.id, renderStep(step, chain.id, context, dynamic));
  const setupSteps = order.setup.map((entry) => rendered.get(entry.step.id)!);
  const chains = plan.chains
    .map((chain) => ({ id: chain.id, steps: chain.steps.filter((step) => step.runs !== "once-before-load").map((step) => rendered.get(step.id)!) }))
    .filter((chain) => chain.steps.length > 0);

  const valueEnv = Object.fromEntries(valueNames.map((name) => [name, `APIPILOT_V_${valueIndex[name]}`]));
  const dataSets = plan.dataSets.map((dataSet) => ({ mode: dataSet.mode, columns: dataSet.columns.map((column) => column.name) }));
  const usesData = dataSets.length > 0;

  const lines = [
    "// ApiPilot k6 performance test, request-chain plan (AP-037, specs/037-request-chain-performance).",
    "// Generated by ApiPilot from steps authored by the engineer and not verified by ApiPilot. Only the",
    "// unmodified generated script runs from the plan. It contains no values: each value named in",
    "// VALUE_ENV is read from that environment variable at run time.",
    ...(usesData ? ["// Data set rows are read at run time from apipilot-data-<n>.json files ApiPilot writes for one run."] : []),
    `// Plan fingerprint: ${plan.fingerprint}`,
    'import http from "k6/http";',
    'import { check, sleep } from "k6";',
    'import { Counter } from "k6/metrics";',
    'import exec from "k6/execution";',
    ...(usesData ? ['import { SharedArray } from "k6/data";'] : []),
    "",
    `export const options = ${JSON.stringify(
      {
        stages: plan.loadProfile.stages.map((stage) => ({ duration: stage.durationMs % 1000 === 0 ? `${stage.durationMs / 1000}s` : `${stage.durationMs}ms`, target: stage.targetVirtualUsers })),
        systemTags: SYSTEM_TAGS,
      },
      null,
      2,
    )};`,
    "",
    jsonConst("VALUE_ENV", valueEnv),
    `const THINK_TIME_S = ${JSON.stringify(plan.thinkTimeMs / 1000)};`,
    jsonConst("DYNAMIC", Object.fromEntries(dynamic.tokens.map((entry) => [entry.token, { kind: entry.kind }]))),
    jsonConst("DATA_SETS", dataSets),
    jsonConst("SETUP_STEPS", setupSteps),
    jsonConst("CHAINS", chains),
    dataLoaders(dataSets.length),
    "",
    CHAIN_RUNTIME,
  ];
  const script = `${lines.join("\n")}\n`;

  const secret = new Set(plan.secretNames);
  const template = Object.fromEntries(valueNames.map((name) => [name, { env: `APIPILOT_V_${valueIndex[name]}`, secret: secret.has(name), value: "" }]));
  return { script, environmentTemplate: `${JSON.stringify(template, null, 2)}\n`, valueIndex };
}

/** How many steps the script sends per iteration and before the load, for `ScriptStatus.stepCount`. */
export function chainStepCount(plan: ChainPlan): number {
  return plan.chains.reduce((total, chain) => total + chain.steps.length, 0);
}

/**
 * The fixed interpreter (research R5, R11 to R14; contracts/chain-script.md). It reads only the
 * constants above, `__ENV`, `exec` and, with data sets, the per-run files. It stays within AP-034's
 * checked subset (AP-029 FR-022a): run-time lookups use `Map`s, `const` literal tables, numeric
 * indexes and own-field walks of a response body, never other property reads with keys built at run
 * time. Metrics: each load request is tagged `{step, journey}` (journey = chain id); setup and refresh
 * requests carry `apipilot_kind` and `setup_step` instead, so they never enter a step's figures. No
 * tag ever carries a value.
 *
 * - Scopes (R5): each iteration starts from the setup values, then the virtual user's values, and
 *   every extraction overwrites, so the latest write wins and nothing stale survives an iteration.
 * - Runs (FR-008, FR-019): a once-per-virtual-user step is marked done only when it got an expected
 *   status and every extractor succeeded; otherwise it cuts its chain short and runs again next time.
 * - Setup (FR-018): a failed setup step is counted with its reason and the test is aborted before
 *   any virtual user starts.
 * - Refresh (FR-040): a setup step whose response stated `expires_in` is sent again per virtual user
 *   at 70 to 80 % of the lifetime, staggered by virtual user, before a step that uses its values.
 * - Data sets (FR-043): one row per virtual user by its number, or the next row per iteration by the
 *   test-wide iteration number, wrapping; setup steps use the first row. Takes are counted, never valued.
 */
export const CHAIN_RUNTIME = String.raw`const missingData = new Counter("apipilot_missing_data");
const notAttempted = new Counter("apipilot_not_attempted");
const cutShort = new Counter("apipilot_cut_short");
const tokenRefresh = new Counter("apipilot_token_refresh");
const captureOutcome = new Counter("apipilot_capture");
const checkOutcome = new Counter("apipilot_check");
const setupOutcome = new Counter("apipilot_setup");
const dataOutcome = new Counter("apipilot_data");
const REFERENCE = /\{\{([A-Za-z0-9_]+)\}\}/g;
const RUN_TAG_SETTING = __ENV.APIPILOT_RUN_TAG;
const RUN_TAG = typeof RUN_TAG_SETTING === "string" && /^[0-9a-f]{6}$/.test(RUN_TAG_SETTING) ? RUN_TAG_SETTING : "";
const FIRST_NAMES = ["Ada", "Alan", "Barbara", "Claude", "Dennis", "Donald", "Edsger", "Frances", "Grace", "Hedy", "Ivan", "Jean", "Ken", "Katherine", "Leslie", "Linus", "Margaret", "Niklaus", "Radia", "Rosalind", "Sophie", "Tim", "Vint", "Whitfield"];
const LAST_NAMES = ["Allen", "Babbage", "Backus", "Berners", "Cerf", "Diffie", "Dijkstra", "Engelbart", "Hamilton", "Hopper", "Johnson", "Kahn", "Knuth", "Lamarr", "Lamport", "Liskov", "Lovelace", "Perlman", "Ritchie", "Shannon", "Sutherland", "Thompson", "Turing", "Wirth"];
const ALPHANUMERIC = "0123456789abcdefghijklmnopqrstuvwxyz";
const COLORS = ["red", "orange", "yellow", "green", "blue", "indigo", "violet", "black", "white", "grey", "pink", "teal"];
const ABBREVIATIONS = ["SQL", "TCP", "HTTP", "JSON", "XML", "SSL", "API", "CSS", "RAM", "SMS", "PCI", "USB"];
const LOCALES = ["en", "de", "fr", "es", "it", "pt", "nl", "sv", "pl", "ja", "ko", "zh"];
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
];
const NAME_PREFIXES = ["Mr", "Mrs", "Ms", "Miss", "Dr"];
const NAME_SUFFIXES = ["Jr.", "Sr.", "I", "II", "III", "IV", "MD", "DDS", "PhD"];
const JOB_AREAS = ["Accounts", "Brand", "Communications", "Creative", "Data", "Factors", "Integration", "Marketing", "Operations", "Optimization", "Research", "Security", "Tactics"];
const JOB_DESCRIPTORS = ["Central", "Chief", "Corporate", "Customer", "Direct", "Dynamic", "Forward", "Future", "Global", "Internal", "Lead", "National", "Principal", "Regional"];
const JOB_TYPES = ["Administrator", "Agent", "Analyst", "Architect", "Assistant", "Coordinator", "Designer", "Developer", "Director", "Engineer", "Executive", "Facilitator", "Liaison", "Manager", "Officer", "Planner", "Specialist", "Strategist", "Supervisor", "Technician"];
const CITIES = ["London", "Paris", "Berlin", "Madrid", "Rome", "Lisbon", "Dublin", "Vienna", "Oslo", "Helsinki", "Tokyo", "Sydney", "Toronto", "Chicago", "Austin", "Denver"];
const STREET_NAMES = ["Maple", "Oak", "Cedar", "Elm", "Pine", "Willow", "Birch", "Lake", "Hill", "River", "Park", "Church"];
const STREET_TYPES = ["Street", "Avenue", "Road", "Lane", "Drive", "Court", "Way", "Place"];
const COUNTRIES = [["United Kingdom", "GB"], ["France", "FR"], ["Germany", "DE"], ["Spain", "ES"], ["Italy", "IT"], ["Portugal", "PT"], ["Ireland", "IE"], ["Austria", "AT"], ["Norway", "NO"], ["Finland", "FI"], ["Japan", "JP"], ["Australia", "AU"], ["Canada", "CA"], ["United States", "US"], ["India", "IN"], ["Brazil", "BR"]];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOMAIN_WORDS = ["alpha", "brisk", "cedar", "delta", "ember", "fable", "glint", "harbor", "indigo", "juniper", "kestrel", "lumen"];
const DOMAIN_SUFFIXES = ["com", "net", "org", "info", "biz", "io"];
const EXAMPLE_DOMAINS = ["example.com", "example.net", "example.org"];
const SETUP_BY_ID = new Map();
for (const step of SETUP_STEPS) SETUP_BY_ID.set(step.id, step);
const COLUMNS = new Map();
for (let set = 0; set < DATA_SETS.length; set++) {
  const columns = DATA_SETS[set].columns;
  for (let column = 0; column < columns.length; column++) COLUMNS.set(columns[column], { set: set, column: column });
}

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
  // Further independent values for one occurrence: each salt gives its own, still deterministic, draw.
  const draw = function (salt) { return mix(m, salt, 101); };
  const pick = function (list, salt) { return list[draw(salt) % list.length]; };
  const groups = function (count, width, separator) {
    const parts = [];
    for (let i = 0; i < count; i++) parts.push(hex(draw(20 + i), width));
    return parts.join(separator);
  };
  const phone = String(200 + (m % 800)) + "-" + String(200 + (Math.floor(m / 800) % 800)) + "-" + String(10000 + (Math.floor(m / 640000) % 10000)).slice(1);
  const streetName = pick(STREET_NAMES, 1) + " " + pick(STREET_TYPES, 2);
  const domainName = pick(DOMAIN_WORDS, 3) + "." + pick(DOMAIN_SUFFIXES, 4);
  const day = 86400000;
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
  if (kind === "$randomPhoneNumber") return phone;
  if (kind === "$randomAlphaNumeric") return ALPHANUMERIC[m % ALPHANUMERIC.length];
  if (kind === "$randomBoolean") return m % 2 === 0 ? "true" : "false";
  if (kind === "$randomColor") return pick(COLORS, 1);
  if (kind === "$randomHexColor") return "#" + hex(draw(1), 6);
  if (kind === "$randomAbbreviation") return pick(ABBREVIATIONS, 1);
  if (kind === "$randomIP") return String(1 + (draw(1) % 254)) + "." + String(draw(2) % 256) + "." + String(draw(3) % 256) + "." + String(1 + (draw(4) % 254));
  if (kind === "$randomIPV6") return groups(8, 4, ":");
  if (kind === "$randomMACAddress") return groups(6, 2, ":");
  if (kind === "$randomPassword") {
    let password = "";
    for (let i = 0; i < 15; i++) password += ALPHANUMERIC[draw(40 + i) % ALPHANUMERIC.length];
    return password;
  }
  if (kind === "$randomLocale") return pick(LOCALES, 1);
  if (kind === "$randomUserAgent") return pick(USER_AGENTS, 1);
  if (kind === "$randomProtocol") return pick(["http", "https"], 1);
  if (kind === "$randomSemver") return String(draw(1) % 10) + "." + String(draw(2) % 10) + "." + String(draw(3) % 10);
  if (kind === "$randomNamePrefix") return pick(NAME_PREFIXES, 1);
  if (kind === "$randomNameSuffix") return pick(NAME_SUFFIXES, 1);
  if (kind === "$randomJobArea") return pick(JOB_AREAS, 1);
  if (kind === "$randomJobDescriptor") return pick(JOB_DESCRIPTORS, 1);
  if (kind === "$randomJobType") return pick(JOB_TYPES, 1);
  if (kind === "$randomJobTitle") return pick(JOB_DESCRIPTORS, 1) + " " + pick(JOB_AREAS, 2) + " " + pick(JOB_TYPES, 3);
  if (kind === "$randomPhoneNumberExt") return phone + "x" + String(100 + (draw(5) % 9900));
  if (kind === "$randomCity") return pick(CITIES, 1);
  if (kind === "$randomStreetName") return streetName;
  if (kind === "$randomStreetAddress") return String(1 + (draw(6) % 9999)) + " " + streetName;
  if (kind === "$randomCountry") return pick(COUNTRIES, 1)[0];
  if (kind === "$randomCountryCode") return pick(COUNTRIES, 1)[1];
  if (kind === "$randomLatitude") return (((draw(1) % 1800001) / 10000) - 90).toFixed(4);
  if (kind === "$randomLongitude") return (((draw(2) % 3600001) / 10000) - 180).toFixed(4);
  if (kind === "$randomDateFuture") return new Date(Date.now() + (1 + (draw(1) % 365)) * day).toISOString();
  if (kind === "$randomDatePast") return new Date(Date.now() - (1 + (draw(1) % 365)) * day).toISOString();
  if (kind === "$randomDateRecent") return new Date(Date.now() - (draw(1) % day)).toISOString();
  if (kind === "$randomWeekday") return pick(WEEKDAYS, 1);
  if (kind === "$randomMonth") return pick(MONTHS, 1);
  if (kind === "$randomDomainName") return domainName;
  if (kind === "$randomDomainSuffix") return pick(DOMAIN_SUFFIXES, 4);
  if (kind === "$randomDomainWord") return pick(DOMAIN_WORDS, 3);
  if (kind === "$randomExampleEmail") return person + "+" + (RUN_TAG === "" ? "" : "r" + RUN_TAG + "-") + "vu" + __VU + "-it" + __ITER + "-" + k + "@" + pick(EXAMPLE_DOMAINS, 7);
  if (kind === "$randomUrl") return pick(["http", "https"], 8) + "://" + domainName;
  return "";
}

function take(set, index) {
  const rows = DATA[set];
  if (rows.length === 0) return undefined;
  dataOutcome.add(1, { dataset: String(set), outcome: index >= rows.length ? "wrap" : "take" });
  return rows[index % rows.length];
}

function firstRows() {
  const rows = new Map();
  for (let set = 0; set < DATA_SETS.length; set++) {
    const all = DATA[set];
    if (all.length > 0) rows.set(set, all[0]);
  }
  return rows;
}

function resolve(name, scope) {
  if (scope.vars.has(name)) return scope.vars.get(name);
  if (Object.prototype.hasOwnProperty.call(DYNAMIC, name)) return dynamicValue(name);
  const column = COLUMNS.get(name);
  if (column !== undefined) {
    const row = scope.rows.get(column.set);
    if (row !== undefined) return row[+column.column];
  }
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

function build(step, scope) {
  let url = fill(step.url, scope, "url");
  const query = [];
  for (const row of step.query) query.push(encodeURIComponent(fill(row.name, scope, "raw")) + "=" + encodeURIComponent(fill(row.value, scope, "raw")));
  if (query.length > 0) url += "?" + query.join("&");
  const headers = {};
  let typed = false;
  for (const header of step.headers) {
    headers[header.name] = fill(header.value, scope, "raw");
    if (header.name.toLowerCase() === "content-type") typed = true;
  }
  let body = null;
  if (step.body.kind === "raw") {
    body = fill(step.body.text, scope, step.body.fill);
    if (!typed) headers["Content-Type"] = step.body.contentType;
  }
  if (step.body.kind === "form") {
    const pairs = [];
    for (const field of step.body.fields) pairs.push(encodeURIComponent(fill(field.name, scope, "raw")) + "=" + encodeURIComponent(fill(field.value, scope, "raw")));
    body = pairs.join("&");
    if (!typed) headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  return { method: step.method, url: url, headers: headers, body: body };
}

function field(response, path) {
  let value;
  try {
    value = response.json();
  } catch (error) {
    return { found: false, value: undefined };
  }
  for (const part of path) {
    if (value === null || typeof value !== "object") return { found: false, value: undefined };
    if (typeof part === "number" && !Array.isArray(value)) return { found: false, value: undefined };
    const name = String(part);
    let found = false;
    for (const [key, child] of Object.entries(value)) {
      if (key === name) {
        value = child;
        found = true;
        break;
      }
    }
    if (!found) return { found: false, value: undefined };
  }
  return { found: true, value: value };
}

function headerValue(response, name) {
  const headers = response.headers;
  if (headers === null || typeof headers !== "object") return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

function scalarText(value) {
  if (typeof value === "string") return value === "" ? undefined : value;
  if (typeof value === "number") return isFinite(value) ? String(value) : undefined;
  if (typeof value === "boolean") return String(value);
  return undefined;
}

function extracted(response, extractor) {
  if (extractor.header !== undefined) return scalarText(headerValue(response, extractor.header));
  return scalarText(field(response, extractor.body).value);
}

function statusOk(status, expected) {
  const text = String(status);
  for (const code of expected) {
    if (code.length === 3 && code.slice(1) === "XX" ? text.length === 3 && text[0] === code[0] : text === code) return true;
  }
  return false;
}

function passes(item, response, scope) {
  if (item.kind === "time-at-most") return response.timings.duration <= item.maxMs;
  if (item.kind === "body-contains") return typeof response.body === "string" && response.body.indexOf(item.text) >= 0;
  const found = field(response, item.path);
  if (item.kind === "field-exists") return found.found;
  if (!found.found) return false;
  const expected = item.expected;
  if (expected.type === "number") return typeof found.value === "number" && found.value === expected.value;
  if (expected.type === "boolean") return typeof found.value === "boolean" && found.value === expected.value;
  const actual = found.value === null ? undefined : scalarText(found.value);
  return actual !== undefined && actual === fill(expected.value, scope, "raw");
}

function runChecks(step, response, scope, tags) {
  for (const item of step.checks) {
    const outcome = { check: item.id, outcome: passes(item, response, scope) ? "passed" : "failed" };
    if (tags.step !== undefined) {
      outcome.step = tags.step;
      outcome.journey = tags.journey;
    } else outcome.setup_step = tags.setup_step;
    checkOutcome.add(1, outcome);
  }
}

function send(step, scope, tags) {
  const request = build(step, scope);
  return http.request(request.method, request.url, request.body, {
    headers: request.headers,
    tags: tags,
    responseType: step.readsBody ? "text" : "none",
  });
}

function sendSetup(step, scope, kind) {
  for (const name of step.needs) if (env(name) === undefined) return { values: [], failed: "missing-data:" + name, acquiredAtMs: Date.now(), lifetimeS: 0 };
  const response = send(step, scope, { apipilot_kind: kind, setup_step: step.id });
  if (response.status === 0) return { values: [], failed: "no-response", acquiredAtMs: Date.now(), lifetimeS: 0 };
  runChecks(step, response, scope, { setup_step: step.id });
  if (!statusOk(response.status, step.expected)) return { values: [], failed: "status", acquiredAtMs: Date.now(), lifetimeS: 0 };
  const values = [];
  for (const extractor of step.extractors) {
    const value = extracted(response, extractor);
    captureOutcome.add(1, { setup_step: step.id, capture: extractor.name, outcome: value === undefined ? "failed" : "ok" });
    if (value === undefined) return { values: [], failed: "extractor:" + extractor.name, acquiredAtMs: Date.now(), lifetimeS: 0 };
    values.push({ name: extractor.name, value: value });
  }
  const lifetime = Number(field(response, ["expires_in"]).value);
  return { values: values, failed: null, acquiredAtMs: Date.now(), lifetimeS: isFinite(lifetime) && lifetime > 0 ? lifetime : 0 };
}

export function setup() {
  const scope = { vars: new Map(), rows: firstRows() };
  const usedSets = new Set();
  const handed = [];
  for (const step of SETUP_STEPS) {
    for (const name of step.columns) {
      const column = COLUMNS.get(name);
      if (column !== undefined) usedSets.add(column.set);
    }
    const result = sendSetup(step, scope, "setup");
    if (result.failed !== null) {
      setupOutcome.add(1, { setup_step: step.id, outcome: "failed", reason: result.failed });
      exec.test.abort("apipilot: a once-before-load step failed");
    }
    setupOutcome.add(1, { setup_step: step.id, outcome: "ok", reason: "" });
    if (result.lifetimeS === 0 && step.extractors.length > 0) tokenRefresh.add(1, { setup_step: step.id, outcome: "no-lifetime" });
    for (const entry of result.values) scope.vars.set(entry.name, entry.value);
    handed.push({ id: step.id, values: result.values, acquiredAtMs: result.acquiredAtMs, lifetimeS: result.lifetimeS });
  }
  for (const set of usedSets) dataOutcome.add(1, { dataset: String(set), outcome: "setup" });
  return { setup: handed };
}

let vu = null;

function initVirtualUser(data) {
  vu = { setupValues: new Map(), setupState: new Map(), values: new Map(), done: new Set(), rows: new Map() };
  for (const entry of data.setup) {
    vu.setupState.set(entry.id, { values: entry.values, acquiredAtMs: entry.acquiredAtMs, lifetimeS: entry.lifetimeS });
    if (Array.isArray(entry.values)) for (const value of entry.values) vu.setupValues.set(value.name, value.value);
  }
  for (let set = 0; set < DATA_SETS.length; set++) {
    if (DATA_SETS[set].mode !== "row-per-virtual-user") continue;
    const row = take(set, exec.vu.idInTest - 1);
    if (row !== undefined) vu.rows.set(set, row);
  }
}

function refreshFraction() {
  return 0.7 + 0.01 * ((exec.vu.idInTest - 1) % 11);
}

function maybeRefresh(id, scope) {
  const state = vu.setupState.get(id);
  const step = SETUP_BY_ID.get(id);
  if (!state || !step || !Array.isArray(state.values) || !(state.lifetimeS > 0)) return;
  if (Date.now() - state.acquiredAtMs < state.lifetimeS * 1000 * refreshFraction()) return;
  const result = sendSetup(step, { vars: new Map(vu.setupValues), rows: firstRows() }, "token-refresh");
  if (result.failed === null) {
    vu.setupState.set(id, { values: result.values, acquiredAtMs: result.acquiredAtMs, lifetimeS: result.lifetimeS });
    for (const entry of result.values) {
      vu.setupValues.set(entry.name, entry.value);
      scope.vars.set(entry.name, entry.value);
    }
    tokenRefresh.add(1, { setup_step: id, outcome: "ok" });
  } else {
    state.acquiredAtMs = Date.now();
    tokenRefresh.add(1, { setup_step: id, outcome: "failed" });
  }
}

function pause(step) {
  const seconds = step.thinkS === null ? THINK_TIME_S : step.thinkS;
  if (seconds > 0) sleep(seconds);
}

function cut(chain, index, tags, capture) {
  cutShort.add(1, { step: tags.step, journey: tags.journey, capture: capture });
  for (const rest of chain.steps.slice(index + 1)) notAttempted.add(1, { step: rest.id, journey: chain.id, reason: "cut-short" });
}

function runChain(chain, scope) {
  for (let index = 0; index < chain.steps.length; index++) {
    const step = chain.steps[index];
    const tags = { step: step.id, journey: chain.id };
    const perUser = step.runs === "once-per-virtual-user";
    if (perUser && vu.done.has(step.id)) continue;
    const missing = step.needs.filter(function (name) {
      return env(name) === undefined;
    });
    if (missing.length > 0) {
      for (const name of missing) missingData.add(1, { step: step.id, journey: chain.id, variable: name });
      continue;
    }
    if (step.uses.some(function (name) { return !scope.vars.has(name); })) {
      notAttempted.add(1, { step: step.id, journey: chain.id, reason: "dependency" });
      continue;
    }
    for (const id of step.refreshFrom) maybeRefresh(id, scope);
    const response = send(step, scope, tags);
    const expected = statusOk(response.status, step.expected);
    check(response, { status: function () { return expected; } }, tags);
    runChecks(step, response, scope, tags);
    let failed = null;
    for (const extractor of step.extractors) {
      const value = expected ? extracted(response, extractor) : undefined;
      const ok = value !== undefined;
      check(response, { extraction: function () { return ok; } }, tags);
      captureOutcome.add(1, { step: step.id, journey: chain.id, capture: extractor.name, outcome: ok ? "ok" : "failed" });
      if (ok) {
        scope.vars.set(extractor.name, value);
        if (perUser) vu.values.set(extractor.name, value);
      } else if (failed === null) failed = extractor.name;
    }
    pause(step);
    if (failed !== null) {
      cut(chain, index, tags, failed);
      return;
    }
    if (perUser) {
      if (!expected) {
        cut(chain, index, tags, "");
        return;
      }
      vu.done.add(step.id);
    }
  }
}

export default function (data) {
  if (vu === null) initVirtualUser(data);
  const rows = new Map(vu.rows);
  for (let set = 0; set < DATA_SETS.length; set++) {
    if (DATA_SETS[set].mode !== "row-per-iteration") continue;
    const row = take(set, exec.scenario.iterationInTest);
    if (row !== undefined) rows.set(set, row);
  }
  const scope = { vars: new Map(), rows: rows };
  for (const [name, value] of vu.setupValues) scope.vars.set(name, value);
  for (const [name, value] of vu.values) scope.vars.set(name, value);
  for (const chain of CHAINS) runChain(chain, scope);
}`;
