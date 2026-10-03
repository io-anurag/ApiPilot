import {
  CHAIN_PLAN_LIMITS,
  REFERENCE_NAME,
  STEP_METHODS,
  isSettableHeader,
  isValidHeaderName,
  type Chain,
  type ChainPlan,
  type ChainStep,
  type CheckExpected,
  type Extractor,
  type NameValue,
  type StepBody,
  type StepCheck,
  type StepMethod,
  type StepRuns,
  type PerformanceThreshold,
  type PerformanceThresholdMetric,
  type PerformanceThresholdScope,
} from "@apipilot/shared-domain";
import {
  HeaderNotSettableError,
  InvalidChainError,
  InvalidChainPlanError,
  InvalidLoadProfileError,
  InvalidStepError,
  InvalidThresholdError,
  PlanLimitExceededError,
} from "../errors";
import { canonicalJson, sha256Hex, thresholdIdFor } from "../plan/identifiers";
import { validateLoadProfile, validateThinkTime } from "../plan/loadProfiles";

const METRICS: ReadonlySet<string> = new Set(["p50", "p90", "p95", "p99", "error-rate"]);

/**
 * One threshold of a saved plan, validated (AP-029 FR-019's rules, kept from the retired plan
 * update when phase two removed it). Its id is derived from its content.
 */
function parseThreshold(raw: unknown, stepIds: ReadonlySet<string>): PerformanceThreshold {
  if (typeof raw !== "object" || raw === null) throw new InvalidThresholdError("Each threshold must be an object.");
  const record = raw as Record<string, unknown>;
  const scopeRecord = (record.scope ?? {}) as Record<string, unknown>;
  let scope: PerformanceThresholdScope;
  if (scopeRecord.kind === "run") scope = { kind: "run" };
  else if (scopeRecord.kind === "step" && typeof scopeRecord.stepId === "string" && stepIds.has(scopeRecord.stepId)) {
    scope = { kind: "step", stepId: scopeRecord.stepId };
  } else throw new InvalidThresholdError("A threshold applies to the whole run or to an existing step.");
  if (typeof record.metric !== "string" || !METRICS.has(record.metric)) {
    throw new InvalidThresholdError("A threshold's metric must be p50, p90, p95, p99 or error-rate.");
  }
  const metric = record.metric as PerformanceThresholdMetric;
  if (record.comparator !== "<=") throw new InvalidThresholdError("A threshold's comparator must be <=.");
  const limit = record.limit;
  if (typeof limit !== "number" || !Number.isFinite(limit)) throw new InvalidThresholdError("A threshold needs a numeric limit.");
  if (metric === "error-rate" ? limit < 0 || limit > 100 : limit <= 0) {
    throw new InvalidThresholdError(
      metric === "error-rate" ? "An error-rate limit is a percentage from 0 to 100." : "A latency limit must be over 0 ms.",
    );
  }
  return { id: thresholdIdFor(canonicalJson({ scope, metric, limit })), scope, metric, comparator: "<=", limit };
}

/**
 * Saving a request-chain plan (specs/037-request-chain-performance research R2, R9, R22, R26). The
 * client sends the whole plan; this module checks it field by field at the HTTP boundary, keeps what
 * only the server may set (each step's source and seed digest, the seeding report, data sets), never
 * reuses an id, recomputes `changed` and the fingerprint, and enforces the limits. Pure: nothing
 * here reads or writes storage. Blockers such as a use before an extraction are not refused here;
 * the analysis lists them (FR-014).
 */

const RUNS: readonly StepRuns[] = ["every-iteration", "once-per-virtual-user", "once-before-load"];
const STATUS = /^[1-5](?:[0-9]{2}|XX)$/;
const MAX_THINK_TIME_MS = 600_000;
const MAX_CONTENT_TYPE_LENGTH = 200;
const MAX_STATUSES = 20;

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

/** The content of a step the `Changed` mark compares: everything sent or checked, not its name or provenance. */
export function stepContentDigest(step: Omit<ChainStep, "source" | "seedDigest" | "changed" | "id" | "name">): string {
  return sha256Hex(
    canonicalJson({
      method: step.method,
      url: step.url,
      query: step.query,
      headers: step.headers,
      body: step.body,
      expectedStatuses: step.expectedStatuses,
      extractors: step.extractors.map((extractor) => ({ name: extractor.name, source: extractor.source })),
      checks: step.checks.map(({ id: _id, ...check }) => check),
      runs: step.runs,
      thinkTimeMs: step.thinkTimeMs,
    }),
  );
}

/**
 * Research R22: what the generated script depends on. Not the plan's name, the seeding report, the
 * target environment, step and chain names, sources or `Changed` marks, and never data set content.
 */
export function planFingerprint(plan: Pick<ChainPlan, "chains" | "loadProfile" | "thinkTimeMs" | "thresholds" | "secretNames" | "dataSets">): string {
  return sha256Hex(
    canonicalJson({
      chains: plan.chains.map((chain) => ({
        id: chain.id,
        steps: chain.steps.map((step) => ({
          id: step.id,
          method: step.method,
          url: step.url,
          query: step.query,
          headers: step.headers,
          body: step.body,
          expectedStatuses: step.expectedStatuses,
          extractors: step.extractors,
          checks: step.checks,
          runs: step.runs,
          thinkTimeMs: step.thinkTimeMs,
        })),
      })),
      loadProfile: plan.loadProfile,
      thinkTimeMs: plan.thinkTimeMs,
      thresholds: plan.thresholds,
      secretNames: plan.secretNames,
      dataSets: plan.dataSets.map((dataSet) => ({ mode: dataSet.mode, columns: dataSet.columns.map((column) => column.name) })),
    }),
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberOf(id: string, prefix: string): number {
  return Number(id.slice(prefix.length));
}

function idPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}[1-9][0-9]{0,5}$`);
}

const CHAIN_ID = idPattern("c");
const STEP_ID = idPattern("s");
const EXTRACTOR_ID = idPattern("x");
const CHECK_ID = idPattern("k");

function text(value: unknown, fail: (reason: string) => never, what: string, max: number = CHAIN_PLAN_LIMITS.valueBytes): string {
  if (typeof value !== "string") fail(`${what} must be text.`);
  if (byteLength(value as string) > max) fail(`${what} is at most ${max} bytes.`);
  return value as string;
}

function displayName(value: unknown, fail: (reason: string) => never, what: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${what} needs a name.`);
  const trimmed = (value as string).trim();
  if (trimmed.length > CHAIN_PLAN_LIMITS.nameLength) fail(`${what}'s name is at most ${CHAIN_PLAN_LIMITS.nameLength} characters.`);
  return trimmed;
}

function rows(value: unknown, fail: (reason: string) => never, what: string, limitName: string, stepId: string): NameValue[] {
  if (!Array.isArray(value)) fail(`${what} must be a list.`);
  const list = value as unknown[];
  if (list.length > CHAIN_PLAN_LIMITS.rowsPerList) {
    throw new PlanLimitExceededError(limitName, `A step has at most ${CHAIN_PLAN_LIMITS.rowsPerList} ${what.toLowerCase()} (step ${stepId}).`);
  }
  return list.map((raw) => {
    const row = record(raw);
    if (!row) fail(`Each ${what.toLowerCase()} row has a name and a value.`);
    return { name: text(row!.name, fail, `A ${what.toLowerCase()} name`), value: text(row!.value, fail, `A ${what.toLowerCase()} value`) };
  });
}

function parseBody(raw: unknown, fail: (reason: string) => never, stepId: string): StepBody {
  const body = record(raw);
  if (!body) fail("A step's body must be none, raw or form.");
  if (body!.kind === "none") return { kind: "none" };
  if (body!.kind === "raw") {
    const contentType = text(body!.contentType, fail, "The body's content type", MAX_CONTENT_TYPE_LENGTH).trim();
    if (contentType === "") fail("A raw body needs a content type.");
    const bodyText = text(body!.text, fail, "The body", CHAIN_PLAN_LIMITS.bodyBytes);
    return { kind: "raw", contentType, text: bodyText };
  }
  if (body!.kind === "form") return { kind: "form", fields: rows(body!.fields, fail, "Form fields", "rowsPerList", stepId) };
  return fail("A step's body must be none, raw or form.");
}

function parseExpected(raw: unknown, fail: (reason: string) => never): CheckExpected {
  const expected = record(raw);
  if (expected?.type === "text") return { type: "text", value: text(expected.value, fail, "A check's expected text") };
  if (expected?.type === "number" && typeof expected.value === "number" && Number.isFinite(expected.value)) return { type: "number", value: expected.value };
  if (expected?.type === "boolean" && typeof expected.value === "boolean") return { type: "boolean", value: expected.value };
  return fail("A check's expected value is text, a number or true or false.");
}

function parseCheck(raw: unknown, fail: (reason: string) => never): StepCheck {
  const check = record(raw);
  if (!check || typeof check.id !== "string" || !CHECK_ID.test(check.id)) fail("Each check needs an id such as k1.");
  const id = check!.id as string;
  const path = () => text(check!.path, fail, "A check's field path", 256);
  switch (check!.kind) {
    case "field-exists":
      return { id, kind: "field-exists", path: path() };
    case "field-equals":
      return { id, kind: "field-equals", path: path(), expected: parseExpected(check!.expected, fail) };
    case "body-contains": {
      const contains = text(check!.text, fail, "A check's text");
      if (contains === "") fail("A body-contains check needs text to look for.");
      return { id, kind: "body-contains", text: contains };
    }
    case "time-at-most": {
      const maxMs = check!.maxMs;
      if (typeof maxMs !== "number" || !Number.isInteger(maxMs) || maxMs < 1 || maxMs > CHAIN_PLAN_LIMITS.maxCheckMs) {
        fail(`A response-time check is a whole number of milliseconds from 1 to ${CHAIN_PLAN_LIMITS.maxCheckMs}.`);
      }
      return { id, kind: "time-at-most", maxMs: maxMs as number };
    }
    default:
      return fail("A check is one of: field exists, field equals, body contains, response time at most.");
  }
}

function parseExtractor(raw: unknown, fail: (reason: string) => never): Extractor {
  const extractor = record(raw);
  if (!extractor || typeof extractor.id !== "string" || !EXTRACTOR_ID.test(extractor.id)) fail("Each extractor needs an id such as x1.");
  if (typeof extractor!.name !== "string" || !REFERENCE_NAME.test(extractor!.name)) fail("An extractor's name holds letters, digits and underscores only.");
  const source = record(extractor!.source);
  if (source?.kind === "body") return { id: extractor!.id as string, name: extractor!.name as string, source: { kind: "body", path: text(source.path, fail, "A field path", 256) } };
  if (source?.kind === "header") {
    const name = text(source.name, fail, "A header name", 256).trim();
    if (name === "") fail("A header extractor needs a header name.");
    return { id: extractor!.id as string, name: extractor!.name as string, source: { kind: "header", name } };
  }
  return fail("An extractor reads a JSON body field or a response header.");
}

function parseStep(raw: unknown): Omit<ChainStep, "source" | "seedDigest" | "changed"> {
  const input = record(raw);
  const stepId = typeof input?.id === "string" ? input.id : "";
  const failOn =
    (field: string) =>
    (reason: string): never => {
      throw new InvalidStepError(stepId, field, reason);
    };
  if (!input || !STEP_ID.test(stepId)) throw new InvalidStepError(stepId, "id", "Each step needs an id such as s1.");
  const name = displayName(input.name, failOn("name"), "A step");
  if (typeof input.method !== "string" || !(STEP_METHODS as readonly string[]).includes(input.method)) {
    failOn("method")("A step's method is GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS.");
  }
  const url = text(input.url, failOn("url"), "A step's URL").trim();
  if (url === "") failOn("url")("A step needs a URL.");
  if (url.includes("?") || url.includes("#")) failOn("url")("Put query parameters in the query list, not in the URL.");
  const query = rows(input.query, failOn("query"), "Query parameters", "rowsPerList", stepId);
  if (query.some((row) => row.name === "")) failOn("query")("Every query parameter needs a name.");
  const headers = rows(input.headers, failOn("headers"), "Headers", "rowsPerList", stepId);
  for (const header of headers) {
    if (!isValidHeaderName(header.name)) failOn("headers")(`"${header.name}" is not a valid header name.`);
    if (!isSettableHeader(header.name)) throw new HeaderNotSettableError(stepId, header.name);
  }
  const body = parseBody(input.body, failOn("body"), stepId);
  if (!Array.isArray(input.expectedStatuses) || input.expectedStatuses.length > MAX_STATUSES) failOn("expectedStatuses")("Expected statuses must be a list of status codes.");
  const expectedStatuses: string[] = [];
  for (const status of input.expectedStatuses as unknown[]) {
    const code = typeof status === "string" ? status.trim().toUpperCase() : "";
    if (!STATUS.test(code)) failOn("expectedStatuses")("An expected status is a code such as 200 or 2XX.");
    if (!expectedStatuses.includes(code)) expectedStatuses.push(code);
  }
  if (!Array.isArray(input.extractors)) failOn("extractors")("Extractors must be a list.");
  if ((input.extractors as unknown[]).length > CHAIN_PLAN_LIMITS.extractorsPerStep) {
    throw new PlanLimitExceededError("extractorsPerStep", `A step has at most ${CHAIN_PLAN_LIMITS.extractorsPerStep} extractors.`);
  }
  const extractors = (input.extractors as unknown[]).map((entry) => parseExtractor(entry, failOn("extractors")));
  if (!Array.isArray(input.checks)) failOn("checks")("Checks must be a list.");
  if ((input.checks as unknown[]).length > CHAIN_PLAN_LIMITS.checksPerStep) {
    throw new PlanLimitExceededError("checksPerStep", `A step has at most ${CHAIN_PLAN_LIMITS.checksPerStep} checks.`);
  }
  const checks = (input.checks as unknown[]).map((entry) => parseCheck(entry, failOn("checks")));
  if (typeof input.runs !== "string" || !(RUNS as readonly string[]).includes(input.runs)) {
    failOn("runs")("A step runs every iteration, once per virtual user, or once before load.");
  }
  const thinkTimeMs = input.thinkTimeMs;
  if (thinkTimeMs !== null && (typeof thinkTimeMs !== "number" || !Number.isInteger(thinkTimeMs) || thinkTimeMs < 0 || thinkTimeMs > MAX_THINK_TIME_MS)) {
    failOn("thinkTimeMs")(`A step's think time is blank or a whole number of milliseconds up to ${MAX_THINK_TIME_MS}.`);
  }
  return {
    id: stepId,
    name,
    method: input.method as StepMethod,
    url,
    query,
    headers,
    body,
    expectedStatuses,
    extractors,
    checks,
    runs: input.runs as StepRuns,
    thinkTimeMs: thinkTimeMs as number | null,
  };
}

function storedSteps(plan: ChainPlan): Map<string, ChainStep> {
  return new Map(plan.chains.flatMap((chain) => chain.steps.map((step) => [step.id, step] as const)));
}

function storedItemIds(plan: ChainPlan): Set<string> {
  return new Set(plan.chains.flatMap((chain) => chain.steps.flatMap((step) => [...step.extractors.map((item) => item.id), ...step.checks.map((item) => item.id)])));
}

function secretNamesOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new InvalidChainPlanError("secretNames", "Secret names must be a list.");
  const names = new Set<string>();
  for (const name of raw) {
    if (typeof name !== "string" || !REFERENCE_NAME.test(name)) throw new InvalidChainPlanError("secretNames", "A secret name holds letters, digits and underscores only.");
    names.add(name);
  }
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Checks a client-sent plan against the stored one and returns the plan to store at `revision + 1`.
 * New chains, steps, extractors and checks must use numbers at or above the stored counters, so an
 * id is never reused after a delete. A step the stored plan has keeps its stored source and seed
 * digest; a new step is "Added by you". `changed` is the step's content compared with its seed.
 */
export function normalizePlanInput(raw: unknown, stored: ChainPlan, now: string): ChainPlan {
  const input = record(raw);
  if (!input) throw new InvalidChainPlanError("plan", "The plan must be an object.");
  const name = displayName(input.name, (reason) => {
    throw new InvalidChainPlanError("name", reason);
  }, "The plan");
  if (!Array.isArray(input.chains) || input.chains.length === 0) throw new InvalidChainPlanError("chains", "A plan has at least one chain.");
  if (input.chains.length > CHAIN_PLAN_LIMITS.chains) {
    throw new PlanLimitExceededError("chains", `A plan has at most ${CHAIN_PLAN_LIMITS.chains} chains.`);
  }
  const previousSteps = storedSteps(stored);
  const previousChains = new Set(stored.chains.map((chain) => chain.id));
  const previousItems = storedItemIds(stored);
  const seenChains = new Set<string>();
  const seenSteps = new Set<string>();
  const seenItems = new Set<string>();
  let nextChainNumber = stored.nextChainNumber;
  let nextStepNumber = stored.nextStepNumber;
  let nextItemNumber = stored.nextItemNumber;

  const chains: Chain[] = (input.chains as unknown[]).map((rawChain) => {
    const chainInput = record(rawChain);
    const chainId = typeof chainInput?.id === "string" ? chainInput.id : "";
    const failChain = (reason: string): never => {
      throw new InvalidChainError(chainId, reason);
    };
    if (!chainInput || !CHAIN_ID.test(chainId)) failChain("Each chain needs an id such as c1.");
    if (seenChains.has(chainId)) failChain("Two chains have the same id.");
    seenChains.add(chainId);
    if (!previousChains.has(chainId)) {
      if (numberOf(chainId, "c") < stored.nextChainNumber) failChain("A new chain cannot reuse the id of a deleted one.");
      nextChainNumber = Math.max(nextChainNumber, numberOf(chainId, "c") + 1);
    }
    const chainName = displayName(chainInput!.name, failChain, "A chain");
    if (!Array.isArray(chainInput!.steps)) failChain("A chain's steps must be a list.");
    if ((chainInput!.steps as unknown[]).length > CHAIN_PLAN_LIMITS.stepsPerChain) {
      throw new PlanLimitExceededError("stepsPerChain", `A chain has at most ${CHAIN_PLAN_LIMITS.stepsPerChain} steps.`);
    }
    const steps = (chainInput!.steps as unknown[]).map((rawStep): ChainStep => {
      const previous = previousSteps.get(record(rawStep)?.id as string);
      const parsed = parseStep(rawStep);
      if (seenSteps.has(parsed.id)) throw new InvalidStepError(parsed.id, "id", "Two steps have the same id.");
      seenSteps.add(parsed.id);
      if (!previous) {
        if (numberOf(parsed.id, "s") < stored.nextStepNumber) throw new InvalidStepError(parsed.id, "id", "A new step cannot reuse the id of a deleted one.");
        nextStepNumber = Math.max(nextStepNumber, numberOf(parsed.id, "s") + 1);
      }
      for (const item of [...parsed.extractors, ...parsed.checks]) {
        if (seenItems.has(item.id)) throw new InvalidStepError(parsed.id, "id", `Two extractors or checks have the id ${item.id}.`);
        seenItems.add(item.id);
        if (!previousItems.has(item.id)) {
          const number = numberOf(item.id, item.id[0]);
          if (number < stored.nextItemNumber) throw new InvalidStepError(parsed.id, "id", "A new extractor or check cannot reuse the id of a deleted one.");
          nextItemNumber = Math.max(nextItemNumber, number + 1);
        }
      }
      const source = previous?.source ?? { kind: "added" as const };
      const seedDigest = previous?.seedDigest ?? null;
      return { ...parsed, source, seedDigest, changed: seedDigest !== null && stepContentDigest(parsed) !== seedDigest };
    });
    return { id: chainId, name: chainName, steps };
  });

  let loadProfile;
  let thinkTimeMs;
  try {
    loadProfile = validateLoadProfile(input.loadProfile);
    thinkTimeMs = validateThinkTime(input.thinkTimeMs);
  } catch (error) {
    if (error instanceof InvalidLoadProfileError) throw new InvalidChainPlanError("loadProfile", error.message);
    throw error;
  }
  if (thinkTimeMs > MAX_THINK_TIME_MS) throw new InvalidChainPlanError("thinkTimeMs", `Think time is at most ${MAX_THINK_TIME_MS} ms.`);
  if (!Array.isArray(input.thresholds)) throw new InvalidChainPlanError("thresholds", "Thresholds must be a list.");
  let thresholds;
  try {
    thresholds = (input.thresholds as unknown[]).map((threshold) => parseThreshold(threshold, seenSteps));
  } catch (error) {
    if (error instanceof InvalidThresholdError) throw new InvalidChainPlanError("thresholds", error.message);
    throw error;
  }
  const targetEnvironmentId = input.targetEnvironmentId;
  if (targetEnvironmentId !== null && (typeof targetEnvironmentId !== "string" || targetEnvironmentId === "")) {
    throw new InvalidChainPlanError("targetEnvironmentId", "The target environment is an environment id, or none.");
  }

  const plan: ChainPlan = {
    id: stored.id,
    name,
    revision: stored.revision + 1,
    chains,
    loadProfile,
    thinkTimeMs,
    thresholds,
    targetEnvironmentId: targetEnvironmentId as string | null,
    secretNames: secretNamesOf(input.secretNames),
    dataSets: stored.dataSets,
    seedingReport: stored.seedingReport,
    nextChainNumber,
    nextStepNumber,
    nextItemNumber,
    fingerprint: "",
    createdAt: stored.createdAt,
    updatedAt: now,
  };
  return withFingerprint(plan);
}

/** Recomputes the fingerprint and enforces the document size limit (R26). */
export function withFingerprint(plan: ChainPlan): ChainPlan {
  const finished = { ...plan, fingerprint: planFingerprint(plan) };
  if (byteLength(JSON.stringify(finished)) > CHAIN_PLAN_LIMITS.documentBytes) {
    throw new PlanLimitExceededError("documentBytes", `A plan is at most ${CHAIN_PLAN_LIMITS.documentBytes / (1024 * 1024)} MiB.`);
  }
  return finished;
}

/** Recomputes every step's `Changed` mark, after a change the server made (such as a credential move). */
export function withChangedMarks(plan: ChainPlan): ChainPlan {
  return {
    ...plan,
    chains: plan.chains.map((chain) => ({
      ...chain,
      steps: chain.steps.map((step) => ({ ...step, changed: step.seedDigest !== null && stepContentDigest(step) !== step.seedDigest })),
    })),
  };
}
