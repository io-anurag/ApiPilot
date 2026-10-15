import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DebugBody, DebugHeader, DebugRequest, DebugResponse, UserScriptDebugCutOffReason, UserScriptDebugExchange, UserScriptDebugOutcome, UserScriptDebugResult } from "@apipilot/shared-domain";
import { maskedTextToString, USER_SCRIPT_DEBUG_MAX_EXCHANGES, USER_SCRIPT_DEBUG_TIME_LIMIT_MS } from "@apipilot/shared-domain";
import { createLogger } from "../../../logger";
import { getSessionId } from "../../../session/sessionContext";
import { touch } from "../../../session/sessionRegistry";
import { DebugValueNotFoundError, UserScriptDebugRunInProgressError } from "../../errors";
import { Masker, type SecretValue } from "../../chain/debug/masker";
import { getHeldValues } from "../../chain/debug/heldValues";
import { createRunDirectory, removeRunDirectory } from "../../k6/runDirectory";
import type { RunnerHandle } from "../../k6/runnerTypes";
import { buildUserScriptChildEnv, buildUserScriptDebugK6Args } from "../../k6/runner";
import { settledStatusOf } from "../exitCodes";
import { prepareUserScriptRun, type UserScriptRunDependencies } from "../startUserScriptRun";
import { createStderrFilter } from "../stderrFilter";
import { getUserScript, sha256OfBytes } from "../userScriptStore";
import { createDebugLogCollector, type RawExchange, type RawHeader } from "./parseDebugLog";

const logger = createLogger("performance.userScriptDebugRun");

/**
 * The application layer of the Debug run of a supplied script (specs/053-user-script-debug-run; constitution
 * v3.1.0, XVII). It runs the confirmed script once with k6's own options, reads only k6's HTTP debug records,
 * masks everything, keeps the revealable values in memory for the reveal call, and logs the outcome. It
 * creates no run record, report or stored result (FR-006), and logs only ids, counts, a duration and an
 * outcome category: never a URL, header, body or environment value.
 *
 * Like the request-chain Debug run it does not take the session's execution slot, because it is not a
 * stored run; it refuses to start while another execution holds the slot (`prepareUserScriptRun`), and an
 * in-memory per-script flag keeps two Debug runs of one script from overlapping.
 */
const running = new Set<string>();

export type UserScriptDebugDependencies = Pick<UserScriptRunDependencies, "runner" | "probe" | "now" | "runDirectoryRoot" | "debugLimits">;

const RUN_NOTES = [
  "The script ran once, with one virtual user and one iteration, whatever load it or its setup defines. The load profile and the thresholds set in ApiPilot did not apply.",
  "k6 does not log a request's scheme or its time, so each address is shown as host and path, and no durations are shown.",
  "The script's own console output is never shown.",
];

const textEncoder = new TextEncoder();

function headerOf(headers: readonly RawHeader[], name: string): string | null {
  const lower = name.toLowerCase();
  return headers.find((header) => header.name.toLowerCase() === lower)?.value ?? null;
}

function addressOf(exchange: RawExchange): string {
  const { target, host } = exchange.request;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : `${host}${target}`;
}

/** Every value mapped from the environment is a secret to this view; the base URL is not (FR-005). */
function secretsOf(script: { settings: { mapping: readonly { name: string; source: { kind: string; valueName?: string } }[] } }, variableValues: Readonly<Record<string, string>>): SecretValue[] {
  const secrets: SecretValue[] = [];
  for (const entry of script.settings.mapping) {
    if (entry.source.kind !== "environment-value" || entry.source.valueName === undefined) continue;
    const value = variableValues[entry.source.valueName];
    if (value !== undefined && value !== "") secrets.push({ name: entry.name, value, kind: "environment" });
  }
  return secrets;
}

function maskedBody(masker: Masker, text: string, contentType: string | null): DebugBody {
  if (text === "") return { kind: "none" };
  return masker.maskBody(textEncoder.encode(text), contentType, false);
}

function headersOf(masker: Masker, headers: readonly RawHeader[]): DebugHeader[] {
  return headers.map((header) => masker.maskHeader(header.name, header.value));
}

/**
 * Masks the raw exchanges. Everything is observed before anything is masked, so a credential found in a
 * later response is also masked where an earlier request carried it.
 */
export function maskExchanges(raw: readonly RawExchange[], masker: Masker): UserScriptDebugExchange[] {
  for (const exchange of raw) {
    masker.observeUrl(addressOf(exchange));
    for (const header of exchange.request.headers) masker.observeHeader(header.name, header.value);
    if (exchange.request.body !== "") masker.observeBody(textEncoder.encode(exchange.request.body), headerOf(exchange.request.headers, "content-type"));
    const response = exchange.response;
    if (!response) continue;
    for (const header of response.headers) masker.observeHeader(header.name, header.value);
    if (response.body !== "" && response.compressedWith === null) masker.observeBody(textEncoder.encode(response.body), headerOf(response.headers, "content-type"));
  }
  return raw.map((exchange, position): UserScriptDebugExchange => {
    const requestType = headerOf(exchange.request.headers, "content-type");
    const request: DebugRequest = {
      method: exchange.request.method,
      url: masker.maskUrl(addressOf(exchange)),
      headers: headersOf(masker, exchange.request.headers),
      body: maskedBody(masker, exchange.request.body, requestType),
    };
    let response: DebugResponse | null = null;
    if (exchange.response) {
      const responseType = headerOf(exchange.response.headers, "content-type");
      let body: DebugBody;
      if (exchange.response.compressedWith !== null && exchange.response.body !== "") {
        body = { kind: "binary", contentType: `${responseType ?? "unknown type"} (${exchange.response.compressedWith}-compressed)`, sizeBytes: Buffer.byteLength(exchange.response.body) };
      } else {
        body = maskedBody(masker, exchange.response.body, responseType);
      }
      response = { status: exchange.response.status, statusText: exchange.response.statusText, headers: headersOf(masker, exchange.response.headers), body, redirects: [] };
    }
    return { index: position + 1, name: exchange.name === null ? null : masker.maskText(exchange.name), request, response };
  });
}

/**
 * Runs the confirmed script once and returns what it sent and received. `signal` aborts the run (the
 * browser cancels by aborting its request). Throws the same errors as a run start, in the same order, and
 * `UserScriptDebugRunInProgressError` when this script's Debug run is already executing.
 */
export async function executeUserScriptDebugRun(
  scriptId: string,
  body: { environmentId?: unknown; scriptSha256?: unknown },
  signal: AbortSignal,
  deps: UserScriptDebugDependencies,
): Promise<UserScriptDebugResult> {
  const sessionId = getSessionId();
  const prepared = await prepareUserScriptRun(scriptId, body, deps, { checkLoadOverride: false });
  const { stored, environment } = prepared;
  const key = `${sessionId}:${stored.id}`;
  if (running.has(key)) throw new UserScriptDebugRunInProgressError();
  running.add(key);

  const debugRunId = randomUUID();
  const startedAtMs = deps.now().getTime();
  const maxExchanges = deps.debugLimits?.maxExchanges ?? USER_SCRIPT_DEBUG_MAX_EXCHANGES;
  const timeLimitMs = deps.debugLimits?.timeLimitMs ?? USER_SCRIPT_DEBUG_TIME_LIMIT_MS;
  const collector = createDebugLogCollector({ maxExchanges });
  const stderr = createStderrFilter();
  logger.info("user_script_debug_started", { scriptId: stored.id, environmentTier: environment.tier });

  let runDir: string | undefined;
  let cutOff: UserScriptDebugCutOffReason | null = null;
  let spawnFailed = false;
  let exitCode: number | null = null;
  try {
    runDir = createRunDirectory(debugRunId, deps.runDirectoryRoot);
    const scriptPath = path.join(runDir, "script.js");
    writeFileSync(scriptPath, stored.content, { mode: 0o600 });
    // The copy is re-read and must hash to the confirmed SHA-256, or k6 never starts (034 FR-017).
    if (sha256OfBytes(readFileSync(scriptPath)) !== stored.sha256) {
      return finish("failed", { integrity: true });
    }

    const values: Record<string, string> = {};
    for (const entry of stored.settings.mapping) {
      const value = entry.source.kind === "base-url" ? environment.baseUrl : environment.variableValues[entry.source.valueName];
      if (value !== undefined && value !== "") values[entry.name] = value;
    }
    // A runner may deliver stderr while `start` is still running, before the handle exists; a cut-off then waits for it.
    const started: { handle?: RunnerHandle } = {};
    started.handle = deps.runner.start({
      runDir,
      scriptPath,
      metricsPath: path.join(runDir, "metrics.ndjson"),
      binaryPath: prepared.binaryPath,
      args: buildUserScriptDebugK6Args(scriptPath),
      env: buildUserScriptChildEnv(process.env, values),
      onLine: () => undefined,
      onStderrLine: (line) => {
        collector.onStderrLine(line);
        stderr.onLine(line);
        if (collector.limitReached() && cutOff === null) {
          cutOff = "exchange-limit";
          started.handle?.cancel();
        }
      },
    });
    const active = started.handle;
    if (!active) throw new Error("The runner returned no handle.");
    const onAbort = () => active.cancel();
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted || cutOff !== null) active.cancel();
    const timer = setTimeout(() => {
      if (cutOff === null) cutOff = "time-limit";
      active.cancel();
    }, timeLimitMs);
    const exit = await active.done;
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    spawnFailed = exit.spawnError !== undefined;
    exitCode = exit.exitCode;
    return finish(null, {});
  } finally {
    running.delete(key);
    if (runDir) removeRunDirectory(debugRunId, deps.runDirectoryRoot);
  }

  function finish(forced: UserScriptDebugOutcome | null, flags: { integrity?: boolean }): UserScriptDebugResult {
    const masker = new Masker(secretsOf(stored, environment.variableValues));
    const exchanges = maskExchanges(collector.exchanges(), masker);
    const counts = collector.counts();
    let outcome: UserScriptDebugOutcome;
    if (forced) outcome = forced;
    else if (signal.aborted) outcome = "cancelled";
    else if (cutOff !== null) outcome = "cut-off";
    else if (spawnFailed || settledStatusOf(exitCode, exchanges.length) === "failed") outcome = "failed";
    else outcome = exchanges.length === 0 ? "no-requests" : "completed";

    const notes = [...RUN_NOTES];
    if (counts.oversizedRecords > 0) notes.push("A request or response too large to read was left out, and its request may be listed with no response.");
    if (spawnFailed) notes.push("k6 could not be started.");
    if (flags.integrity) notes.push("The script's working copy did not match its confirmed SHA-256, so k6 was not started.");
    const k6Text = outcome === "failed" ? stderr.keptErrorText() : null;

    if (outcome !== "cancelled") getHeldValues().hold(sessionId, stored.id, debugRunId, masker.revealableValues());
    touch(sessionId);
    const durationMs = deps.now().getTime() - startedAtMs;
    logger.info("user_script_debug_finished", { scriptId: stored.id, outcome, exchangeCount: exchanges.length, consoleLineCount: stderr.counts().consoleLines, durationMs });
    return {
      debugRunId,
      scriptId: stored.id,
      scriptName: stored.name,
      scriptSha256: stored.sha256,
      environment: { id: environment.id, name: environment.name, tier: environment.tier, baseUrl: environment.baseUrl },
      startedAt: new Date(startedAtMs).toISOString(),
      durationMs,
      outcome,
      ...(outcome === "cut-off" && cutOff !== null ? { cutOffReason: cutOff } : {}),
      k6ExitCode: exitCode,
      ...(k6Text ? { k6Message: maskedTextToString(masker.maskText(k6Text), "[masked]") } : {}),
      exchanges,
      notes,
    };
  }
}

/** One revealed value, or `DebugValueNotFoundError` for any reason the value is not available. */
export function revealUserScriptDebugValue(scriptId: string, debugRunId: string, valueId: string): string {
  const value = getHeldValues().reveal(getSessionId(), getUserScript(scriptId).id, debugRunId, valueId);
  if (value === null) throw new DebugValueNotFoundError();
  logger.info("user_script_debug_value_revealed", { scriptId });
  return value;
}

export function discardUserScriptDebugRun(scriptId: string, debugRunId: string): void {
  getHeldValues().discard(getSessionId(), getUserScript(scriptId).id, debugRunId);
}

/** Tests only. */
export function resetUserScriptDebugRunsForTests(): void {
  running.clear();
}
