import { createHash, randomUUID } from "node:crypto";
import type { ScriptCheckResult, UserScript, UserScriptLastRun, UserScriptSummary } from "@apipilot/shared-domain";
import { createLogger } from "../../logger";
import { getUserScriptRepository, type StoredUserScript, type StoredUserScriptMeta, type StoredUserScriptSettings } from "../../persistence/userScriptRepository";
import { getUserScriptRunRepository } from "../../persistence/userScriptRunRepository";
import { getSessionId } from "../../session/sessionContext";
import { onExpire } from "../../session/sessionRegistry";
import { UserScriptChangedError, UserScriptNotFoundError, UserScriptRefusedError, UserScriptRunInProgressError } from "../errors";
import { checkUserScript } from "./checkUserScript";
import { initialSettings, mergeSettingsAfterContentChange, withFoundFlags } from "./settings";

const logger = createLogger("performance.userScripts");

/**
 * Session-scoped AP-034 user scripts for route handlers (specs/034-run-user-k6-script FR-002 to
 * FR-016; research R7, R8). Every function reads the calling request's session. A script is stored
 * only after the check accepts it, and the check result is never stored: it is recomputed from the
 * content with the current rules, memoised by SHA-256 (FR-008 makes that safe).
 */

onExpire((sessionId) => {
  getUserScriptRepository().deleteBySession(sessionId);
});

export const MAX_SCRIPT_NAME_LENGTH = 100;

export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type Check = (bytes: Uint8Array) => ScriptCheckResult;
let check: Check = checkUserScript;

/** Test-only: replaces the check, for example with a stricter one (tasks T025, research R17). */
export function setScriptCheckForTest(replacement: Check | null): void {
  check = replacement ?? checkUserScript;
  checkCache.clear();
}

const CHECK_CACHE_SIZE = 64;
const checkCache = new Map<string, ScriptCheckResult>();

/** The current check's result for these bytes, memoised by their SHA-256 (least recently used first out). */
export function checkFor(bytes: Uint8Array, sha256: string): ScriptCheckResult {
  const cached = checkCache.get(sha256);
  if (cached) {
    checkCache.delete(sha256);
    checkCache.set(sha256, cached);
    return cached;
  }
  const result = check(bytes);
  checkCache.set(sha256, result);
  if (checkCache.size > CHECK_CACHE_SIZE) checkCache.delete(checkCache.keys().next().value as string);
  return result;
}

/** Trimmed, line breaks removed, at most 100 characters; empty becomes `fallback`. */
export function normalizeScriptName(raw: unknown, fallback: string): string {
  const text = typeof raw === "string" ? raw.replace(/[\r\n\t]+/g, " ").trim() : "";
  return (text === "" ? fallback : text).slice(0, MAX_SCRIPT_NAME_LENGTH);
}

function lastRunsByScript(sessionId: string): Map<string, UserScriptLastRun> {
  const latest = new Map<string, UserScriptLastRun>();
  for (const run of getUserScriptRunRepository().listBySession(sessionId)) {
    if (!latest.has(run.snapshot.scriptId)) latest.set(run.snapshot.scriptId, { runId: run.id, status: run.status, startedAt: run.startedAt });
  }
  return latest;
}

function toSummary(meta: StoredUserScriptMeta, lastRun: UserScriptLastRun | null): UserScriptSummary {
  return {
    id: meta.id,
    name: meta.name,
    sizeBytes: meta.sizeBytes,
    sha256: meta.sha256,
    confirmed: meta.confirmedSha256 === meta.sha256,
    lastRun,
    updatedAt: meta.updatedAt,
  };
}

function toUserScript(stored: StoredUserScript, lastRun: UserScriptLastRun | null): UserScript {
  const result = checkFor(stored.content, stored.sha256);
  return {
    ...toSummary(stored, lastRun),
    check: result,
    confirmation: stored.confirmation && stored.confirmation.sha256 === stored.sha256 ? stored.confirmation : null,
    settings: withFoundFlags(stored.settings, result),
  };
}

function requireStored(scriptId: string): StoredUserScript {
  const stored = getUserScriptRepository().get(getSessionId(), scriptId);
  if (!stored) throw new UserScriptNotFoundError(scriptId);
  return stored;
}

export function listUserScripts(): UserScriptSummary[] {
  const sessionId = getSessionId();
  const lastRuns = lastRunsByScript(sessionId);
  return getUserScriptRepository()
    .listBySession(sessionId)
    .map((meta) => toSummary(meta, lastRuns.get(meta.id) ?? null));
}

export function getUserScript(scriptId: string): UserScript {
  const stored = requireStored(scriptId);
  return toUserScript(stored, lastRunsByScript(getSessionId()).get(scriptId) ?? null);
}

/** The stored script, for the run trigger (research R17). */
export function getStoredUserScript(scriptId: string): StoredUserScript {
  return requireStored(scriptId);
}

export function readUserScriptContent(scriptId: string): { name: string; content: Buffer } {
  const stored = requireStored(scriptId);
  return { name: stored.name, content: stored.content };
}

function refuseUnlessAccepted(bytes: Uint8Array, sha256: string): Extract<ScriptCheckResult, { accepted: true }> {
  const result = checkFor(bytes, sha256);
  if (!result.accepted) {
    logger.info("user_script_refused", { problemCount: result.problems.length, ruleIds: [...new Set(result.problems.map((problem) => problem.rule))].join(",") });
    throw new UserScriptRefusedError(result.problems);
  }
  return result;
}

/** FR-002, FR-004: checks the bytes and stores them only when accepted. */
export function createUserScript(name: string, bytes: Buffer): UserScript {
  const sha256 = sha256OfBytes(bytes);
  const result = refuseUnlessAccepted(bytes, sha256);
  const id = randomUUID();
  const at = new Date().toISOString();
  getUserScriptRepository().create(getSessionId(), { id, name, content: bytes, sha256, settings: initialSettings(result), at });
  logger.info("user_script_stored", { scriptId: id, sizeBytes: bytes.length, sha256Prefix: sha256.slice(0, 12) });
  return getUserScript(id);
}

/** FR-011, FR-016: a new version, only from the version the engineer was looking at. */
export function replaceUserScriptContent(scriptId: string, bytes: Buffer, baseSha256: unknown): UserScript {
  const stored = requireStored(scriptId);
  if (baseSha256 !== stored.sha256) throw new UserScriptChangedError();
  const sha256 = sha256OfBytes(bytes);
  const result = refuseUnlessAccepted(bytes, sha256);
  getUserScriptRepository().replaceContent(getSessionId(), scriptId, bytes, sha256, mergeSettingsAfterContentChange(stored.settings, result), new Date().toISOString());
  logger.info("user_script_stored", { scriptId, sizeBytes: bytes.length, sha256Prefix: sha256.slice(0, 12) });
  return getUserScript(scriptId);
}

export function renameUserScript(scriptId: string, name: string): UserScript {
  requireStored(scriptId);
  getUserScriptRepository().rename(getSessionId(), scriptId, name, new Date().toISOString());
  return getUserScript(scriptId);
}

/** FR-013 to FR-015: an explicit confirmation of exactly the bytes the dialog showed. */
export function confirmUserScript(scriptId: string, sha256: unknown): UserScript {
  const stored = requireStored(scriptId);
  if (sha256 !== stored.sha256) throw new UserScriptChangedError();
  const result = refuseUnlessAccepted(stored.content, stored.sha256);
  if (!getUserScriptRepository().confirm(getSessionId(), scriptId, stored.sha256, result.hosts, new Date().toISOString())) throw new UserScriptChangedError();
  logger.info("user_script_confirmed", { scriptId, sha256Prefix: stored.sha256.slice(0, 12), hostCount: result.hosts.length });
  return getUserScript(scriptId);
}

export function saveUserScriptSettings(scriptId: string, settings: StoredUserScriptSettings): UserScript {
  requireStored(scriptId);
  getUserScriptRepository().saveSettings(getSessionId(), scriptId, settings);
  return getUserScript(scriptId);
}

/** Spec Edge Cases: deleting keeps the script's runs; a script with a run in progress cannot be deleted. */
export function deleteUserScript(scriptId: string): void {
  requireStored(scriptId);
  const sessionId = getSessionId();
  const inProgress = getUserScriptRunRepository().getInProgress(sessionId);
  if (inProgress && inProgress.snapshot.scriptId === scriptId) throw new UserScriptRunInProgressError(inProgress.id);
  getUserScriptRepository().delete(sessionId, scriptId);
}

/** AP-034 FR-024: environments open to a session that holds at least one script. */
export function hasUserScript(): boolean {
  return getUserScriptRepository().hasAny(getSessionId());
}
