import { parseCapturePath } from "./capturePath";
import { SUPPORTED_DYNAMIC_VARIABLES } from "./dynamicVariables";
import type {
  LoadProfile,
  PerformanceRunCancelReason,
  PerformanceRunEnvironment,
  PerformanceRunFailureCategory,
  PerformanceRunStatus,
  PerformanceResult,
  PerformanceThreshold,
  RunProgress,
  ScriptStatus,
  WriteMethod,
  WriteOperationEntry,
  WriteOperationSummary,
} from "./performance";
import { isWriteMethod, writeEffectOf } from "./performance";

/**
 * AP-037 Request-Chain Performance Plans (specs/037-request-chain-performance data-model.md). A plan
 * the engineer owns outright, as in Postman or JMeter: chains of concrete steps, seeded once and never
 * re-derived (FR-026). Every type here holds structure and the engineer's step text only: never an
 * environment value, a data set value, an extracted value or a literal credential (FR-027, FR-028,
 * FR-044). The functions are pure and shared by the editor and the server, so a use before an
 * extraction is shown as the engineer types and enforced before a script is generated (research R3).
 */

export const STEP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type StepMethod = (typeof STEP_METHODS)[number];

/** FR-008. */
export type StepRuns = "every-iteration" | "once-per-virtual-user" | "once-before-load";

export interface NameValue {
  name: string;
  value: string;
}

/** FR-003, research R4. */
export type StepBody = { kind: "none" } | { kind: "raw"; contentType: string; text: string } | { kind: "form"; fields: NameValue[] };

/** FR-009: a JSON body field by the AP-035 closed grammar, or a response header by name. */
export type ExtractorSource = { kind: "body"; path: string } | { kind: "header"; name: string };

export interface Extractor {
  id: string;
  name: string;
  source: ExtractorSource;
}

export type CheckExpected = { type: "text"; value: string } | { type: "number"; value: number } | { type: "boolean"; value: boolean };

/** FR-016: data only, never an expression. */
export type StepCheck =
  | { id: string; kind: "field-exists"; path: string }
  | { id: string; kind: "field-equals"; path: string; expected: CheckExpected }
  | { id: string; kind: "body-contains"; text: string }
  | { id: string; kind: "time-at-most"; maxMs: number };

export type StepCheckKind = StepCheck["kind"];

/** FR-033, research R9. `passwordFields` are recorded at seeding for FR-027 and never leave the plan. */
export type StepSource =
  | { kind: "added" }
  | { kind: "operation"; operationKey: string; label: string; passwordFields: string[] }
  | { kind: "workflow"; workflowId: string; workflowName: string; operationKey: string; label: string; passwordFields: string[] }
  | { kind: "collection"; collectionId: string; collectionName: string; itemId: string; label: string };

export interface ChainStep {
  /** `s<n>`, unique in the plan and never reused. */
  id: string;
  name: string;
  method: StepMethod;
  /** No `?` or `#`; starts with `{{baseUrl}}` or a literal origin (research R7). */
  url: string;
  query: NameValue[];
  headers: NameValue[];
  body: StepBody;
  /** `"200"`, `"2XX"`; at least one before a script can be generated (FR-006). */
  expectedStatuses: string[];
  extractors: Extractor[];
  checks: StepCheck[];
  runs: StepRuns;
  /** `null`: the plan's default think time (FR-007). */
  thinkTimeMs: number | null;
  source: StepSource;
  /** SHA-256 of the step's content when seeded; `null` for a step the engineer added. */
  seedDigest: string | null;
  /** Derived on save: the content differs from what was seeded. */
  changed: boolean;
}

export interface Chain {
  /** `c<n>`. */
  id: string;
  name: string;
  steps: ChainStep[];
}

export type SeedingReportItemKind =
  | "pre-request-script"
  | "unrecognised-statement"
  | "unsupported-dynamic-variable"
  | "left-out-request"
  | "no-positive-scenario"
  | "workflow-fallback"
  | "basic-auth-encoded-value"
  | "literal-credential-moved"
  | "literal-credential-dropped";

export interface SeedingReportItem {
  kind: SeedingReportItemKind;
  /** The request, operation or workflow the item concerns. */
  sourceLabel: string;
  /** Fixed text with names, lines and labels; never a value. */
  detail: string;
  stepId: string | null;
}

export type SeedSource =
  | { kind: "specification"; filename: string }
  | { kind: "workflow"; specificationTitle: string }
  | { kind: "collection"; collectionId: string; collectionName: string };

export interface SeedingReport {
  source: SeedSource;
  seededAt: string;
  items: SeedingReportItem[];
}

/** FR-043. */
export type DataSetMode = "row-per-virtual-user" | "row-per-iteration";

export interface DataSetColumn {
  name: string;
  secret: boolean;
}

/** Metadata only: a data set's values are never in a plan (FR-044). */
export interface DataSetInfo {
  id: string;
  name: string;
  mode: DataSetMode;
  columns: DataSetColumn[];
  rowCount: number;
  sizeBytes: number;
  sha256: string;
}

/** FR-045: the first rows, with every secret column's cell `null`. */
export interface DataSetPreview {
  columns: DataSetColumn[];
  rows: (string | null)[][];
}

export interface ChainPlan {
  id: string;
  name: string;
  revision: number;
  chains: Chain[];
  loadProfile: LoadProfile;
  thinkTimeMs: number;
  thresholds: PerformanceThreshold[];
  targetEnvironmentId: string | null;
  /** Value names marked secret, sorted. */
  secretNames: string[];
  dataSets: DataSetInfo[];
  seedingReport: SeedingReport | null;
  nextChainNumber: number;
  nextStepNumber: number;
  /** Extractor ids `x<n>` and check ids `k<n>`. */
  nextItemNumber: number;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
}

/** What the editor sends on save (contracts/chain-plan-api.md `PUT /:planId`). */
export interface ChainPlanInput {
  name: string;
  chains: { id: string; name: string; steps: ChainStepInput[] }[];
  loadProfile: LoadProfile;
  thinkTimeMs: number;
  thresholds: PerformanceThreshold[];
  targetEnvironmentId: string | null;
  secretNames: string[];
  seedingReport: SeedingReport | null;
  nextChainNumber: number;
  nextStepNumber: number;
  nextItemNumber: number;
}

/** A step as sent: the server keeps `source` and `seedDigest` and recomputes `changed`. */
export type ChainStepInput = Omit<ChainStep, "source" | "seedDigest" | "changed"> & Partial<Pick<ChainStep, "source" | "seedDigest" | "changed">>;

export interface ChainPlanSummary {
  id: string;
  name: string;
  chainCount: number;
  stepCount: number;
  dataSetCount: number;
  seedSource: SeedSource["kind"] | null;
  updatedAt: string;
}

/** Plan limits (spec Assumptions; research R26). */
export const CHAIN_PLAN_LIMITS = {
  plansPerSession: 50,
  chains: 20,
  stepsPerChain: 50,
  extractorsPerStep: 10,
  checksPerStep: 10,
  rowsPerList: 100,
  valueBytes: 8 * 1024,
  bodyBytes: 256 * 1024,
  documentBytes: 8 * 1024 * 1024,
  nameLength: 120,
  dataSets: 5,
  dataSetBytes: 5 * 1024 * 1024,
  dataSetRows: 100_000,
  dataSetColumns: 50,
  maxCheckMs: 600_000,
} as const;

// ------------------------------------------------------------------------------------------------
// Analysis (data-model.md "Analysis")

export type PlanBlocker =
  | { kind: "missing-expected-status"; stepId: string }
  | { kind: "use-before-extraction"; stepId: string; name: string }
  | { kind: "setup-uses-iteration-value"; stepId: string; name: string }
  | { kind: "host-from-variable"; stepId: string; name: string }
  | { kind: "invalid-url"; stepId: string }
  | { kind: "invalid-reference"; stepId: string; text: string }
  | { kind: "invalid-field-path"; stepId: string; itemId: string; reason: string }
  | { kind: "no-runnable-chain" };

export type PlanNotice =
  | { kind: "empty-chain"; chainId: string }
  | { kind: "extracted-more-than-once"; name: string; stepIds: string[] }
  | { kind: "column-shadows-environment"; name: string; dataSetId: string }
  | { kind: "data-set-unused"; dataSetId: string };

export interface RequiredValue {
  name: string;
  stepIds: string[];
  secret: boolean;
  /** `null` when the plan has no target environment. */
  provided: boolean | null;
}

export interface ChainPlanAnalysis {
  blockers: PlanBlocker[];
  notices: PlanNotice[];
  requiredValues: RequiredValue[];
  dataSetUsage: { dataSetId: string; column: string; stepIds: string[] }[];
  /** `{{baseUrl}}` first when used, then literal origins in plan order (research R7). */
  hosts: string[];
  writeSummary: WriteOperationSummary;
  extractedNames: { name: string; stepIds: string[] }[];
}

export interface AnalysisContext {
  /** The target environment's value names (with `baseUrl` when it has one); never values. `null` without an environment. */
  environmentValueNames: readonly string[] | null;
}

/** What the plan routes return (contracts/chain-plan-api.md). */
export interface ChainPlanView {
  plan: ChainPlan;
  analysis: ChainPlanAnalysis;
  script: ScriptStatus | null;
}

/** FR-027: a literal credential the server moved into a secret environment value on save. */
export interface MovedCredential {
  stepId: string;
  location: { kind: "header"; name: string } | { kind: "body-field"; path: string };
  valueName: string;
  environmentName: string;
}

// ------------------------------------------------------------------------------------------------
// Run snapshot and run (FR-033: structure and provenance only)

export interface ChainRunSnapshotStep {
  id: string;
  name: string;
  method: StepMethod;
  /** The URL with no query; references as `{{name}}`; no value. */
  pathTemplate: string;
  runs: StepRuns;
  expectedStatuses: string[];
  extractorNames: string[];
  checks: { id: string; kind: StepCheckKind; path: string | null; maxMs: number | null; reference: string | null }[];
  source: { kind: StepSource["kind"]; label: string | null };
  changed: boolean;
}

export interface ChainRunSnapshot {
  planId: string;
  planName: string;
  fingerprint: string;
  chains: { id: string; name: string; steps: ChainRunSnapshotStep[] }[];
  loadProfile: LoadProfile;
  thinkTimeMs: number;
  thresholds: PerformanceThreshold[];
  hosts: string[];
  dataSets: { id: string; name: string; mode: DataSetMode; columns: DataSetColumn[]; rowCount: number; sha256: string }[];
  writeSummary: WriteOperationSummary;
  seedSource: SeedSource | null;
  /** Constitution XVII: step content is the engineer's and not verified by ApiPilot. */
  contentNotice: "user-authored-unverified";
}

export type ChainRunFailureCategory = PerformanceRunFailureCategory | "setup-step-failed";

export interface ChainRun {
  id: string;
  planSource: "chain";
  planId: string;
  status: PerformanceRunStatus;
  cancelReason?: PerformanceRunCancelReason;
  failure?: { category: ChainRunFailureCategory };
  environment: PerformanceRunEnvironment;
  snapshot: ChainRunSnapshot;
  scriptSha256: string;
  k6Version: string;
  plannedDurationMs: number;
  startedAt: string;
  endedAt?: string;
  cancelRequested: boolean;
  progress?: RunProgress;
  result?: PerformanceResult;
}

export type ChainRunSummary = Omit<ChainRun, "snapshot" | "progress" | "result">;

// ------------------------------------------------------------------------------------------------
// References (FR-004, research R5)

export const REFERENCE_NAME = /^[A-Za-z0-9_]+$/;
const REFERENCE = /\{\{([^{}]*)\}\}/g;
const DYNAMIC_NAME = /^\$[A-Za-z0-9]+$/;
/** RFC 7230 token. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** FR-003 edge case: set by the runtime, never by a step. */
export const HEADERS_NOT_SETTABLE: readonly string[] = ["host", "content-length"];

export type ParsedReference =
  | { kind: "name"; name: string; raw: string }
  | { kind: "dynamic"; name: string; raw: string }
  | { kind: "invalid"; raw: string };

/** Every `{{…}}` in `text`, in order. A lone `{{` or `}}` is literal text. */
export function parseReferences(text: string): ParsedReference[] {
  const found: ParsedReference[] = [];
  for (const match of text.matchAll(REFERENCE)) {
    const inner = match[1];
    if (REFERENCE_NAME.test(inner)) found.push({ kind: "name", name: inner, raw: match[0] });
    else if (DYNAMIC_NAME.test(inner) && SUPPORTED_DYNAMIC_VARIABLES.has(inner)) found.push({ kind: "dynamic", name: inner, raw: match[0] });
    else found.push({ kind: "invalid", raw: match[0] });
  }
  return found;
}

export function isValidHeaderName(name: string): boolean {
  return HEADER_NAME.test(name);
}

export function isSettableHeader(name: string): boolean {
  return !HEADERS_NOT_SETTABLE.includes(name.toLowerCase());
}

/** The literal `scheme://host[:port]` a URL starts with, or `null`. */
export function literalOrigin(url: string): string | null {
  const match = /^(https?:\/\/[^/?#{}\s]+)(?=$|\/)/i.exec(url);
  return match ? match[1] : null;
}

/** Every text of a step that may hold references, with where it is. Header names are never filled. */
export function referenceTextsOf(step: Pick<ChainStep, "url" | "query" | "headers" | "body" | "checks">): string[] {
  const texts = [step.url];
  for (const row of step.query) texts.push(row.name, row.value);
  for (const header of step.headers) texts.push(header.value);
  if (step.body.kind === "raw") texts.push(step.body.text);
  if (step.body.kind === "form") for (const field of step.body.fields) texts.push(field.name, field.value);
  for (const check of step.checks) if (check.kind === "field-equals" && check.expected.type === "text") texts.push(check.expected.value);
  return texts;
}

/** The plain names a step uses (no dynamic variables), in first-use order. */
export function namesUsedBy(step: Pick<ChainStep, "url" | "query" | "headers" | "body" | "checks">): string[] {
  const names: string[] = [];
  for (const text of referenceTextsOf(step)) {
    for (const reference of parseReferences(text)) if (reference.kind === "name" && !names.includes(reference.name)) names.push(reference.name);
  }
  return names;
}

// ------------------------------------------------------------------------------------------------
// Run order (research R6)

export interface RunOrderEntry {
  chainId: string;
  step: ChainStep;
  /** The step's place in its part of the run order: setup steps, then one iteration. */
  position: number;
}

export interface ChainRunOrder {
  setup: RunOrderEntry[];
  iteration: RunOrderEntry[];
}

/** **Once before load** steps in plan order, then one iteration: every chain in order, each step in order. */
export function chainRunOrder(plan: Pick<ChainPlan, "chains">): ChainRunOrder {
  const setup: RunOrderEntry[] = [];
  const iteration: RunOrderEntry[] = [];
  for (const chain of plan.chains) {
    for (const step of chain.steps) {
      if (step.runs === "once-before-load") setup.push({ chainId: chain.id, step, position: setup.length });
      else iteration.push({ chainId: chain.id, step, position: iteration.length });
    }
  }
  return { setup, iteration };
}

interface ExtractorPlace {
  stepId: string;
  setup: boolean;
  position: number;
}

function extractorPlaces(order: ChainRunOrder): Map<string, ExtractorPlace[]> {
  const places = new Map<string, ExtractorPlace[]>();
  const add = (entry: RunOrderEntry, setup: boolean) => {
    for (const extractor of entry.step.extractors) {
      const list = places.get(extractor.name) ?? [];
      list.push({ stepId: entry.step.id, setup, position: entry.position });
      places.set(extractor.name, list);
    }
  };
  for (const entry of order.setup) add(entry, true);
  for (const entry of order.iteration) add(entry, false);
  return places;
}

/**
 * FR-005: the extracted names a step can use, in run order: every setup extraction before it (or
 * every one, for an iteration step), then iteration extractions before it.
 */
export function namesAvailableAt(plan: Pick<ChainPlan, "chains">, stepId: string): string[] {
  const order = chainRunOrder(plan);
  const setupIndex = order.setup.findIndex((entry) => entry.step.id === stepId);
  const iterationIndex = order.iteration.findIndex((entry) => entry.step.id === stepId);
  const names: string[] = [];
  const push = (step: ChainStep) => {
    for (const extractor of step.extractors) if (!names.includes(extractor.name)) names.push(extractor.name);
  };
  const setupLimit = setupIndex >= 0 ? setupIndex : order.setup.length;
  for (const entry of order.setup.slice(0, setupLimit)) push(entry.step);
  if (iterationIndex >= 0) for (const entry of order.iteration.slice(0, iterationIndex)) push(entry.step);
  return names;
}

// ------------------------------------------------------------------------------------------------
// Writes (AP-032 FR-009 to FR-012a, FR-031)

const WRITE_ORDER: readonly WriteMethod[] = ["POST", "PUT", "PATCH", "DELETE"];

/** Per step: a plan's write steps, counted by method, in plan order. `operationKey` is the step id. */
export function summarizeChainWrites(plan: Pick<ChainPlan, "chains">): WriteOperationSummary {
  const operations: WriteOperationEntry[] = [];
  const counts = new Map<WriteMethod, number>();
  for (const chain of plan.chains) {
    for (const step of chain.steps) {
      if (!isWriteMethod(step.method)) continue;
      const method = step.method;
      counts.set(method, (counts.get(method) ?? 0) + 1);
      operations.push({
        operationKey: step.id,
        method,
        path: step.url,
        effect: writeEffectOf(method)!,
        stepIds: [step.id],
        steps: [{ stepId: step.id, journeyId: chain.id, journeyLabel: chain.name }],
      });
    }
  }
  return {
    total: operations.length,
    byMethod: WRITE_ORDER.filter((method) => (counts.get(method) ?? 0) > 0).map((method) => ({ method, count: counts.get(method)! })),
    operations,
  };
}

// ------------------------------------------------------------------------------------------------
// The analysis (FR-006, FR-014, FR-015, FR-029; research R6, R7)

function urlBlocker(step: ChainStep): PlanBlocker | null {
  const url = step.url;
  if (url.includes("?") || url.includes("#")) return { kind: "invalid-url", stepId: step.id };
  if (url.startsWith("{{")) {
    const first = parseReferences(url)[0];
    if (first && url.startsWith(first.raw)) {
      if (first.kind === "name" && first.name === "baseUrl") return null;
      if (first.kind === "name") return { kind: "host-from-variable", stepId: step.id, name: first.name };
    }
    return { kind: "invalid-url", stepId: step.id };
  }
  const scheme = /^(https?):\/\//i.exec(url);
  if (!scheme) return { kind: "invalid-url", stepId: step.id };
  const rest = url.slice(scheme[0].length);
  const hostEnd = rest.search(/\//);
  const hostPart = hostEnd < 0 ? rest : rest.slice(0, hostEnd);
  const inHost = parseReferences(hostPart);
  if (hostPart.includes("{{")) {
    const named = inHost.find((reference) => reference.kind !== "invalid");
    return { kind: "host-from-variable", stepId: step.id, name: named ? (named as { name: string }).name : hostPart };
  }
  return literalOrigin(url) === null ? { kind: "invalid-url", stepId: step.id } : null;
}

function itemBlockers(step: ChainStep): PlanBlocker[] {
  const blockers: PlanBlocker[] = [];
  for (const extractor of step.extractors) {
    if (extractor.source.kind === "body") {
      const parsed = parseCapturePath(extractor.source.path);
      if (!parsed.ok) blockers.push({ kind: "invalid-field-path", stepId: step.id, itemId: extractor.id, reason: parsed.reason });
    } else if (!isValidHeaderName(extractor.source.name)) {
      blockers.push({ kind: "invalid-field-path", stepId: step.id, itemId: extractor.id, reason: "A header name holds letters, digits and the characters ! # $ % & ' * + . ^ _ ` | ~ -." });
    }
  }
  for (const check of step.checks) {
    if (check.kind !== "field-exists" && check.kind !== "field-equals") continue;
    const parsed = parseCapturePath(check.path);
    if (!parsed.ok) blockers.push({ kind: "invalid-field-path", stepId: step.id, itemId: check.id, reason: parsed.reason });
  }
  return blockers;
}

function invalidReferences(step: ChainStep): PlanBlocker[] {
  const blockers: PlanBlocker[] = [];
  for (const text of referenceTextsOf(step)) {
    for (const reference of parseReferences(text)) {
      if (reference.kind === "invalid") blockers.push({ kind: "invalid-reference", stepId: step.id, text: reference.raw });
    }
  }
  for (const header of step.headers) {
    if (header.name.includes("{{")) blockers.push({ kind: "invalid-reference", stepId: step.id, text: header.name });
  }
  return blockers;
}

export function analyzeChainPlan(plan: Pick<ChainPlan, "chains" | "dataSets" | "secretNames">, context: AnalysisContext): ChainPlanAnalysis {
  const order = chainRunOrder(plan);
  const places = extractorPlaces(order);
  const columns = new Map<string, string>();
  for (const dataSet of plan.dataSets) for (const column of dataSet.columns) columns.set(column.name, dataSet.id);
  const blockers: PlanBlocker[] = [];
  const notices: PlanNotice[] = [];
  const required = new Map<string, string[]>();
  const usage = new Map<string, string[]>();
  const hosts: string[] = [];
  let usesBaseUrl = false;

  const useOf = (name: string, stepId: string) => {
    if (columns.has(name)) {
      const list = usage.get(name) ?? [];
      if (!list.includes(stepId)) list.push(stepId);
      usage.set(name, list);
      return;
    }
    const list = required.get(name) ?? [];
    if (!list.includes(stepId)) list.push(stepId);
    required.set(name, list);
  };

  const visit = (entry: RunOrderEntry, setup: boolean) => {
    const step = entry.step;
    if (step.expectedStatuses.length === 0) blockers.push({ kind: "missing-expected-status", stepId: step.id });
    const url = urlBlocker(step);
    if (url) blockers.push(url);
    else if (step.url.startsWith("{{baseUrl}}")) usesBaseUrl = true;
    else {
      const origin = literalOrigin(step.url);
      if (origin && !hosts.includes(origin)) hosts.push(origin);
    }
    blockers.push(...invalidReferences(step), ...itemBlockers(step));
    for (const name of namesUsedBy(step)) {
      const extracted = places.get(name);
      if (!extracted) {
        useOf(name, step.id);
        continue;
      }
      if (setup) {
        if (extracted.some((place) => place.setup && place.position < entry.position)) continue;
        if (extracted.some((place) => place.setup)) blockers.push({ kind: "use-before-extraction", stepId: step.id, name });
        else blockers.push({ kind: "setup-uses-iteration-value", stepId: step.id, name });
        continue;
      }
      if (extracted.some((place) => place.setup || place.position < entry.position)) continue;
      blockers.push({ kind: "use-before-extraction", stepId: step.id, name });
    }
  };
  for (const entry of order.setup) visit(entry, true);
  for (const entry of order.iteration) visit(entry, false);

  for (const chain of plan.chains) {
    if (!chain.steps.some((step) => step.runs !== "once-before-load")) notices.push({ kind: "empty-chain", chainId: chain.id });
  }
  if (order.iteration.length === 0) blockers.push({ kind: "no-runnable-chain" });
  for (const [name, list] of places) {
    if (list.length > 1) notices.push({ kind: "extracted-more-than-once", name, stepIds: list.map((place) => place.stepId) });
  }
  const environmentNames = context.environmentValueNames === null ? null : new Set(context.environmentValueNames);
  for (const dataSet of plan.dataSets) {
    for (const column of dataSet.columns) {
      if (environmentNames?.has(column.name)) notices.push({ kind: "column-shadows-environment", name: column.name, dataSetId: dataSet.id });
    }
    if (!dataSet.columns.some((column) => usage.has(column.name))) notices.push({ kind: "data-set-unused", dataSetId: dataSet.id });
  }

  const secret = new Set(plan.secretNames);
  const requiredValues: RequiredValue[] = [...required.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, stepIds]) => ({ name, stepIds, secret: secret.has(name), provided: environmentNames === null ? null : environmentNames.has(name) }));
  const dataSetUsage = plan.dataSets.flatMap((dataSet) =>
    dataSet.columns.filter((column) => usage.has(column.name)).map((column) => ({ dataSetId: dataSet.id, column: column.name, stepIds: usage.get(column.name)! })),
  );

  return {
    blockers,
    notices,
    requiredValues,
    dataSetUsage,
    hosts: usesBaseUrl ? ["{{baseUrl}}", ...hosts] : hosts,
    writeSummary: summarizeChainWrites(plan),
    extractedNames: [...places.entries()].map(([name, list]) => ({ name, stepIds: list.map((place) => place.stepId) })),
  };
}
