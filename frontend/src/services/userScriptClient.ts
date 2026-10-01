import type {
  K6Readiness,
  MappedValueStatus,
  ScriptProblem,
  UserScript,
  UserScriptRun,
  UserScriptRunSettings,
  UserScriptRunSummary,
  UserScriptSummary,
} from "@apipilot/shared-domain";
import { createLogger } from "../logger";
import { fetchReportFrom, type PerformanceErrorResult, type PerformanceRunsClient } from "./performanceTestingClient";

/**
 * AP-034 Run k6 Script (specs/034-run-user-k6-script contracts/user-scripts-api.md). Every error
 * body `{error, message, …}` becomes `{ok: false, …}`; a thrown fetch is `network_error`. The
 * script's content passes through this client only for the editor and its viewer; the download is
 * an `<a download>` the browser fetches itself.
 */

const logger = createLogger("userScriptClient");
export const USER_SCRIPTS_BASE = "/api/user-scripts";

export interface UserScriptErrorResult extends PerformanceErrorResult {
  /** `422 script_refused`. */
  problems?: ScriptProblem[];
  /** `400 invalid_mapping_name`. */
  reason?: string;
}

export type UserScriptResult<T> = ({ ok: true } & T) | UserScriptErrorResult;

/** `body: "text"` reads a text response (content, example); every other route answers JSON. */
async function call<T>(
  operation: string,
  path: string,
  init: RequestInit | undefined,
  map: (response: Response, body: Record<string, unknown>) => Promise<T> | T,
  body: "json" | "text" | "none" = "json",
): Promise<UserScriptResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (err) {
    logger.error("network_error", { operation, errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
  if (!response.ok) {
    const parsed = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const error = typeof parsed?.error === "string" ? parsed.error : "unknown_error";
    logger.error("request_failed", { operation, errorCategory: error, statusCode: response.status });
    return {
      ok: false,
      error,
      message: typeof parsed?.message === "string" ? parsed.message : `Request failed with status ${response.status}`,
      ...(Array.isArray(parsed?.problems) ? { problems: parsed.problems as ScriptProblem[] } : {}),
      ...(typeof parsed?.runId === "string" ? { runId: parsed.runId } : {}),
      ...(typeof parsed?.name === "string" ? { name: parsed.name } : {}),
      ...(typeof parsed?.reason === "string" ? { reason: parsed.reason } : {}),
      ...(parsed?.readiness ? { readiness: parsed.readiness as K6Readiness } : {}),
    };
  }
  const parsed = body === "json" ? ((await response.json().catch(() => ({}))) as Record<string, unknown>) : {};
  return { ok: true, ...(await map(response, parsed)) };
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

const toScript = (_response: Response, body: Record<string, unknown>) => ({ script: body.script as UserScript });
const scriptPath = (scriptId: string) => `${USER_SCRIPTS_BASE}/${encodeURIComponent(scriptId)}`;

/** The upload's display name: the file's name without its extension. */
export function nameFromFile(file: File): string {
  return file.name.replace(/\.[^.]+$/, "") || "Uploaded script";
}

export const userScriptClient = {
  fetchScripts: () => call("fetchScripts", USER_SCRIPTS_BASE, undefined, (_r, body) => ({ scripts: (body.scripts ?? []) as UserScriptSummary[] })),
  fetchScript: (scriptId: string) => call("fetchScript", scriptPath(scriptId), undefined, toScript),
  /** FR-002: the file's bytes exactly, so the SHA-256 is the file's. */
  uploadScript: (file: File) =>
    call("uploadScript", `${USER_SCRIPTS_BASE}/upload?name=${encodeURIComponent(nameFromFile(file))}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file }, toScript),
  createFromText: (name: string, content: string) => call("createFromText", USER_SCRIPTS_BASE, json("POST", { name, content }), toScript),
  fetchContent: (scriptId: string) => call("fetchContent", `${scriptPath(scriptId)}/content`, undefined, async (response) => ({ content: await response.text() }), "text"),
  fetchExample: () => call("fetchExample", `${USER_SCRIPTS_BASE}/example`, undefined, async (response) => ({ content: await response.text() }), "text"),
  saveContent: (scriptId: string, content: string, baseSha256: string) => call("saveContent", `${scriptPath(scriptId)}/content`, json("PUT", { content, baseSha256 }), toScript),
  replaceWithUpload: (scriptId: string, file: File, baseSha256: string) =>
    call("replaceWithUpload", `${scriptPath(scriptId)}/content?baseSha256=${encodeURIComponent(baseSha256)}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file }, toScript),
  renameScript: (scriptId: string, name: string) => call("renameScript", scriptPath(scriptId), json("PATCH", { name }), toScript),
  deleteScript: (scriptId: string) => call("deleteScript", scriptPath(scriptId), { method: "DELETE" }, () => ({}), "none"),
  confirmScript: (scriptId: string, sha256: string) => call("confirmScript", `${scriptPath(scriptId)}/confirmation`, json("POST", { sha256 }), toScript),
  saveSettings: (scriptId: string, settings: UserScriptSettingsInput) =>
    call("saveSettings", `${scriptPath(scriptId)}/settings`, json("PUT", settings), toScript),
  fetchValues: (scriptId: string, environmentId: string) =>
    call("fetchValues", `${scriptPath(scriptId)}/values?environmentId=${encodeURIComponent(environmentId)}`, undefined, (_r, body) => ({
      values: (body.values ?? []) as MappedValueStatus[],
      baseUrl: String(body.baseUrl ?? ""),
    })),
  downloadUrl: (scriptId: string) => `${scriptPath(scriptId)}/download`,
};

/** A `PUT /settings` body: names and sources only; threshold ids are content-derived by the server. */
export interface UserScriptSettingsInput {
  mapping: Pick<UserScriptRunSettings["mapping"][number], "name" | "source">[];
  removedNames: string[];
  load: UserScriptRunSettings["load"];
  thresholds: Omit<UserScriptRunSettings["thresholds"][number], "id">[];
}

export interface UserScriptStartInput {
  environmentId: string;
  /** The SHA-256 the trigger showed (research R17). */
  scriptSha256: string;
}

/** The runs of one script, in the shape `usePerformanceRuns` needs. */
export function userScriptRunsClient(scriptId: string): PerformanceRunsClient<UserScriptRun, UserScriptRunSummary, UserScriptStartInput> {
  return {
    fetchReadiness: (recheck = false) =>
      call("fetchReadiness", `${USER_SCRIPTS_BASE}/readiness${recheck ? "?recheck=true" : ""}`, undefined, (_r, body) => ({ readiness: body.readiness as K6Readiness })),
    startRun: (input) => call("startRun", `${scriptPath(scriptId)}/runs`, json("POST", input), (_r, body) => ({ run: body.run as UserScriptRun })),
    fetchRuns: () => call("fetchRuns", `${USER_SCRIPTS_BASE}/runs?scriptId=${encodeURIComponent(scriptId)}`, undefined, (_r, body) => ({ runs: (body.runs ?? []) as UserScriptRunSummary[] })),
    fetchRun: (runId) => call("fetchRun", `${USER_SCRIPTS_BASE}/runs/${encodeURIComponent(runId)}`, undefined, (_r, body) => ({ run: body.run as UserScriptRun })),
    cancelRun: (runId) => call("cancelRun", `${USER_SCRIPTS_BASE}/runs/${encodeURIComponent(runId)}/cancel`, json("POST", {}), (_r, body) => ({ run: body.run as UserScriptRun })),
    fetchReport: (runId) => fetchReportFrom(USER_SCRIPTS_BASE, runId),
    reportDownloadUrl: (runId) => `${USER_SCRIPTS_BASE}/runs/${encodeURIComponent(runId)}/report?download=true`,
  };
}
