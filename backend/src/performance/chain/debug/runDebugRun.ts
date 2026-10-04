import {
  chainRunOrder,
  namesUsedBy,
  type Chain,
  type ChainPlan,
  type ChainPlanAnalysis,
  type ChainStep,
  type DebugChainOutcome,
  type DebugCheckOutcome,
  type DebugExtractorOutcome,
  type DebugNoResponseReason,
  type DebugRunOutcome,
  type DebugRunResult,
  type DebugSkipCause,
  type DebugStepOutcome,
  type DebugStopReason,
  type Environment,
} from "@apipilot/shared-domain";
import { evaluateCheck, responseForChecks } from "./checks";
import { extractValue, parseJsonBody, statusOk, type ExtractionResult } from "./extraction";
import { Masker, type SecretValue } from "./masker";
import { buildRequest, expectedTextOf, preparePlan, type BuiltRequest, type PreparedPlan, type ResolveContext, type Scope } from "./resolveRequest";
import { REQUEST_TIMEOUT_MS, type Sender, type SendResult } from "./sender";

/**
 * Runs a request-chain plan once, in process, for the Debug run (specs/039-chain-debug-run). The
 * continue-or-stop rule is the load run's, step for step (`runChain`, `sendSetup` and `setup` in
 * `CHAIN_RUNTIME`, research R3): a failed extractor stops its chain; an unexpected status stops it only
 * for a once-per-virtual-user step; a step with a missing value or a missing extracted value is
 * skipped alone; a failed once-before-load step ends the run. Every chain runs, in plan order, and they
 * share one scope, as one iteration of the script does.
 *
 * Nothing is stored or logged here. The run keeps the raw exchanges in memory, observes every
 * response and request for credential-looking values, and only then builds the masked result, so a
 * value found late is masked everywhere it appears (research R5). The only I/O is `deps.sender`.
 */

export const RUN_CAP_MS = 120_000;

export interface DebugData {
  /** The first row's value of every data set column, by column name. */
  columns: ReadonlyMap<string, string>;
  /** Columns marked secret: their row values are masked and never revealable. */
  secretColumns: readonly string[];
  /** Which row of which data set was used. */
  rows: { dataSetName: string; rowNumber: number }[];
}

export interface DebugRunInput {
  debugRunId: string;
  plan: ChainPlan;
  analysis: ChainPlanAnalysis;
  environment: Environment;
  data: DebugData;
  /** The run's 6 hex characters, for the unique dynamic values. */
  runTag: string;
  signal: AbortSignal;
}

export interface DebugRunDependencies {
  sender: Sender;
  nowMs: () => number;
}

export interface DebugRunOutput {
  result: DebugRunResult;
  /** The real value of each revealable masked value, by value id. Held by the caller, never returned whole. */
  revealable: Map<string, string>;
}

interface RawSent {
  kind: "sent";
  step: ChainStep;
  request: BuiltRequest;
  send: SendResult;
  status: number;
  expected: boolean;
  extractors: { id: string; name: string; source: DebugExtractorOutcome["source"]; result: ExtractionResult }[];
  checks: DebugCheckOutcome[];
}

interface RawNotSent {
  kind: "not-sent";
  step: ChainStep;
  cause: DebugSkipCause;
}

type RawStep = RawSent | RawNotSent;

interface RawChain {
  chain: Chain;
  steps: RawStep[];
  stoppedAt?: { stepId: string; cause: DebugStopReason };
}

function allowedOrigins(analysis: ChainPlanAnalysis, environment: Environment): Set<string> {
  const origins = new Set<string>();
  const add = (text: string) => {
    try {
      origins.add(new URL(text).origin);
    } catch {
      // A value that is not a URL allows nothing; a step that needs it is reported as not allowed.
    }
  };
  for (const host of analysis.hosts) add(host === "{{baseUrl}}" ? environment.baseUrl : host);
  return origins;
}

function headerOf(headers: [string, string][], name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find(([key]) => key.toLowerCase() === lower)?.[1];
}

export async function runDebugRun(input: DebugRunInput, deps: DebugRunDependencies): Promise<DebugRunOutput> {
  const { plan, analysis, environment, data, signal } = input;
  const startedAtMs = deps.nowMs();
  const deadlineMs = startedAtMs + RUN_CAP_MS;
  const prepared: PreparedPlan = preparePlan(plan);
  const origins = allowedOrigins(analysis, environment);

  const secrets: SecretValue[] = [];
  for (const name of plan.secretNames) {
    const value = environment.variableValues[name];
    if (value) secrets.push({ name, value, kind: "environment" });
  }
  for (const name of data.secretColumns) {
    const value = data.columns.get(name);
    if (value) secrets.push({ name, value, kind: "data-column" });
  }
  const masker = new Masker(secrets);

  const needs = new Map<string, string[]>();
  for (const value of analysis.requiredValues) for (const stepId of value.stepIds) needs.set(stepId, [...(needs.get(stepId) ?? []), value.name]);
  const extractedNames = new Set(analysis.extractedNames.map((entry) => entry.name));

  const environmentValue = (name: string): string | undefined => {
    const value = name === "baseUrl" ? environment.baseUrl : environment.variableValues[name];
    return value === undefined || value === "" ? undefined : value;
  };
  const contextFor = (vu: number): ResolveContext => ({
    prepared,
    values: { environment: environmentValue, column: (name) => data.columns.get(name) },
    dynamic: { vu, iteration: 0, runTag: input.runTag, nowMs: deps.nowMs },
  });

  let halt: "cancelled" | "cap" | null = null;
  const haltCause = (): DebugSkipCause => ({ kind: "not-reached", reason: halt === "cap" ? "run-time-cap" : "run-cancelled" });
  const checkHalt = (): boolean => {
    if (halt) return true;
    if (signal.aborted) halt = "cancelled";
    else if (deps.nowMs() >= deadlineMs) halt = "cap";
    return halt !== null;
  };

  /** Sends one step now, or says why it is not sent. `vu` is 0 in the setup phase and 1 after it. */
  async function exchange(step: ChainStep, scope: Scope, vu: number): Promise<RawSent | RawNotSent> {
    const prep = prepared.steps.get(step.id)!;
    const context = contextFor(vu);
    const request = buildRequest(prep, scope, context);
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return { kind: "not-sent", step, cause: { kind: "host-not-allowed", host: "(not a valid URL)" } };
    }
    if (!origins.has(url.origin)) return { kind: "not-sent", step, cause: { kind: "host-not-allowed", host: url.host } };
    const send = await deps.sender.send({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: request.body,
      timeoutMs: Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadlineMs - deps.nowMs())),
      signal,
      allowUrl: (next) => origins.has(next.origin),
    });
    const status = send.kind === "response" ? send.status : 0;
    const expected = statusOk(status, step.expectedStatuses);
    const bodyText = send.kind === "response" ? new TextDecoder("utf-8").decode(send.body) : "";
    const parsed = parseJsonBody(bodyText);
    const extraction = {
      status,
      header: (name: string) => (send.kind === "response" ? headerOf(send.headers, name) : undefined),
      contentType: send.kind === "response" ? send.contentType : null,
      bodyText,
    };
    const extractors = step.extractors.map((extractor) => ({
      id: extractor.id,
      name: extractor.name,
      source: extractor.source,
      result: extractValue(extractor, extraction, parsed, send.kind === "response" && expected),
    }));
    // Checks run on a response whatever its status, as in the runtime; with no response there is nothing to check.
    const checks =
      send.kind === "response"
        ? step.checks.map((check) => evaluateCheck(check, responseForChecks(send.durationMs, bodyText), expectedTextOf(prep, check, scope, context)))
        : step.checks.map((check) => ({ checkId: check.id, kind: check.kind, passed: false, detail: "No response arrived, so the check could not run." }));
    return { kind: "sent", step, request, send, status, expected, extractors, checks };
  }

  const scope = { vars: new Map<string, string>() };
  const record = (sent: RawSent): void => {
    for (const entry of sent.extractors) {
      if (entry.result.ok) {
        scope.vars.set(entry.name, entry.result.value);
        masker.addExtracted(entry.name, entry.result.value);
      }
    }
  };

  // ---- Setup: once-before-load steps, as `setup()` runs them (virtual user 0, first data row). ----
  const order = chainRunOrder(plan);
  const setup: RawStep[] = [];
  let setupFailure: { step: ChainStep } | null = null;
  for (const entry of order.setup) {
    const step = entry.step;
    if (setupFailure) {
      setup.push({ kind: "not-sent", step, cause: { kind: "stopped-by", stepId: setupFailure.step.id, stepName: setupFailure.step.name, reason: "setup-failed" } });
      continue;
    }
    if (checkHalt()) {
      setup.push({ kind: "not-sent", step, cause: haltCause() });
      continue;
    }
    const missing = (needs.get(step.id) ?? []).filter((name) => environmentValue(name) === undefined);
    if (missing.length > 0) {
      setup.push({ kind: "not-sent", step, cause: { kind: "missing-value", names: missing } });
      setupFailure = { step };
      continue;
    }
    const sent = await exchange(step, scope, 0);
    setup.push(sent);
    const failed = sent.kind === "not-sent" || sent.send.kind !== "response" || !sent.expected || sent.extractors.some((entry) => !entry.result.ok);
    if (sent.kind === "sent") record(sent);
    if (failed) setupFailure = { step };
  }

  // ---- One iteration: every chain in plan order, one shared scope (virtual user 1). ----
  const chains: RawChain[] = [];
  for (const chain of plan.chains) {
    const steps = chain.steps.filter((step) => step.runs !== "once-before-load");
    if (steps.length === 0) continue;
    const raw: RawChain = { chain, steps: [] };
    chains.push(raw);
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      if (setupFailure) {
        raw.steps.push({ kind: "not-sent", step, cause: { kind: "stopped-by", stepId: setupFailure.step.id, stepName: setupFailure.step.name, reason: "setup-failed" } });
        continue;
      }
      if (checkHalt()) {
        raw.steps.push({ kind: "not-sent", step, cause: haltCause() });
        continue;
      }
      const missing = (needs.get(step.id) ?? []).filter((name) => environmentValue(name) === undefined);
      if (missing.length > 0) {
        raw.steps.push({ kind: "not-sent", step, cause: { kind: "missing-value", names: missing } });
        continue;
      }
      const absent = namesUsedBy(step).filter((name) => extractedNames.has(name) && !scope.vars.has(name));
      if (absent.length > 0) {
        raw.steps.push({ kind: "not-sent", step, cause: { kind: "missing-extracted", names: absent } });
        continue;
      }
      const sent = await exchange(step, scope, 1);
      raw.steps.push(sent);
      if (sent.kind === "not-sent") continue;
      record(sent);
      const failedExtractor = sent.extractors.some((entry) => !entry.result.ok);
      const stopReason: DebugStopReason | null = failedExtractor ? "extractor-failed" : step.runs === "once-per-virtual-user" && !sent.expected ? "unexpected-status" : null;
      if (stopReason) {
        raw.stoppedAt = { stepId: step.id, cause: stopReason };
        for (const rest of steps.slice(index + 1)) raw.steps.push({ kind: "not-sent", step: rest, cause: { kind: "stopped-by", stepId: step.id, stepName: step.name, reason: stopReason } });
        break;
      }
    }
  }

  // ---- Observe everything first, then mask: a credential found in a late response is masked in an early one too. ----
  const allRaw: RawStep[] = [...setup, ...chains.flatMap((entry) => entry.steps)];
  for (const entry of allRaw) {
    if (entry.kind !== "sent") continue;
    masker.observeUrl(entry.request.url);
    for (const [name, value] of Object.entries(entry.request.headers)) masker.observeHeader(name, value);
    if (entry.request.body !== null) masker.observeBody(new TextEncoder().encode(entry.request.body), entry.request.headers["Content-Type"] ?? entry.request.headers["content-type"] ?? null);
    if (entry.send.kind === "response") {
      for (const redirect of entry.send.redirects) masker.observeUrl(redirect);
      for (const [name, value] of entry.send.headers) masker.observeHeader(name, value);
      masker.observeBody(entry.send.body, entry.send.contentType);
    }
  }

  const render = (entry: RawStep): DebugStepOutcome => {
    if (entry.kind === "not-sent") return { status: "not-sent", stepId: entry.step.id, stepName: entry.step.name, cause: entry.cause };
    const requestType = Object.entries(entry.request.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? null;
    const request = {
      method: entry.request.method,
      url: masker.maskUrl(entry.request.url),
      headers: Object.entries(entry.request.headers).map(([name, value]) => masker.maskHeader(name, value)),
      body: masker.maskBody(entry.request.body === null ? null : new TextEncoder().encode(entry.request.body), requestType, false),
    };
    const send = entry.send;
    const response =
      send.kind === "response"
        ? {
            status: send.status,
            statusText: send.statusText,
            headers: send.headers.map(([name, value]) => masker.maskHeader(name, value)),
            body: masker.maskBody(send.body, send.contentType, send.bodyTruncated),
            redirects: send.redirects.map((url) => masker.maskUrl(url)),
            ...(send.redirectBlockedTo === undefined ? {} : { redirectBlockedTo: send.redirectBlockedTo }),
          }
        : null;
    const noResponseReason: DebugNoResponseReason | undefined = send.kind === "no-response" ? send.reason : undefined;
    return {
      status: "sent",
      stepId: entry.step.id,
      stepName: entry.step.name,
      request,
      response,
      ...(noResponseReason === undefined ? {} : { noResponseReason }),
      durationMs: Math.round(send.durationMs),
      statusOutcome: { expected: entry.step.expectedStatuses, received: send.kind === "response" ? send.status : null, ok: entry.expected },
      extractors: entry.extractors.map((item) => ({
        extractorId: item.id,
        name: item.name,
        source: item.source,
        outcome: item.result.ok ? { kind: "extracted" as const, value: masker.maskStructuredValue(item.result.value) } : { kind: "failed" as const, reason: item.result.reason },
      })),
      checks: entry.checks,
    };
  };

  const chainOutcomes: DebugChainOutcome[] = chains.map((entry) => ({
    chainId: entry.chain.id,
    chainName: entry.chain.name,
    steps: entry.steps.map(render),
    ...(entry.stoppedAt === undefined ? {} : { stoppedAt: entry.stoppedAt }),
  }));

  const outcome: DebugRunOutcome = signal.aborted
    ? "cancelled"
    : halt === "cap"
      ? "cut-off"
      : setupFailure
        ? "setup-failed"
        : chains.some((entry) => entry.stoppedAt || entry.steps.some((step) => step.kind === "not-sent"))
          ? "stopped-early"
          : "completed";

  const notes = ["Think time and request pauses were not waited out.", "Headers the HTTP client adds itself (such as User-Agent, Host and Content-Length) are not shown."];
  if (data.rows.length > 0) notes.push("The first row of each data set was used.");
  if (outcome === "cut-off") notes.push(`The run was cut off after ${RUN_CAP_MS / 1000} seconds; the steps not yet sent are marked.`);

  return {
    result: {
      debugRunId: input.debugRunId,
      planId: plan.id,
      environment: { id: environment.id, name: environment.name, tier: environment.tier, baseUrl: environment.baseUrl },
      startedAt: new Date(startedAtMs).toISOString(),
      durationMs: deps.nowMs() - startedAtMs,
      outcome,
      setup: setup.map(render),
      chains: chainOutcomes,
      dataRows: data.rows,
      notes,
    },
    revealable: masker.revealableValues(),
  };
}
