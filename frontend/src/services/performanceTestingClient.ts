import type {
  K6Readiness,
  PerformancePlan,
  PerformanceRun,
  PerformanceRunSummary,
  ScriptStatus,
  UserSuppliedValueStatus,
} from "@apipilot/shared-domain";
import { createLogger } from "../logger";

/**
 * One client for AP-029's contracts/performance-api.md (specs/031-k6-performance-testing). Every
 * error body `{error, message, …}` becomes `{ok: false, …}`; a thrown fetch is `network_error`.
 */

const logger = createLogger("performanceTestingClient");
const BASE = "/api/test-generation-workflow/performance";

export interface PerformanceErrorResult {
  ok: false;
  error: string;
  message: string;
  /** `422 expected_status_missing`. */
  stepIds?: string[];
  /** `400 dependency_order_violation`. */
  variable?: string;
  /** `409 execution_in_progress`. */
  runId?: string;
  /** `409 k6_unavailable`. */
  readiness?: K6Readiness;
}

type Result<T> = ({ ok: true } & T) | PerformanceErrorResult;

async function request<T>(operation: string, path: string, init: RequestInit | undefined, map: (body: Record<string, unknown>) => T): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (err) {
    logger.error("network_error", { operation, errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
  const parsed = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const error = typeof parsed?.error === "string" ? parsed.error : "unknown_error";
    logger.error("request_failed", { operation, errorCategory: error, statusCode: response.status });
    return {
      ok: false,
      error,
      message: typeof parsed?.message === "string" ? parsed.message : `Request failed with status ${response.status}`,
      ...(Array.isArray(parsed?.stepIds) ? { stepIds: parsed.stepIds as string[] } : {}),
      ...(typeof parsed?.variable === "string" ? { variable: parsed.variable } : {}),
      ...(typeof parsed?.runId === "string" ? { runId: parsed.runId } : {}),
      ...(parsed?.readiness ? { readiness: parsed.readiness as K6Readiness } : {}),
    };
  }
  return { ok: true, ...map(parsed ?? {}) };
}

function json(method: string, body?: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) };
}

export type PlanResult = Result<{ plan: PerformancePlan; script: ScriptStatus | null }>;

const toPlan = (body: Record<string, unknown>) => ({ plan: body.plan as PerformancePlan, script: (body.script as ScriptStatus | null) ?? null });

/** Opens the stage: the first call builds the proposed plan and makes the stage active (contract). */
export function fetchPlan(): Promise<PlanResult> {
  return request("fetchPlan", `${BASE}/plan`, undefined, toPlan);
}

export interface PlanUpdate {
  scope?: PerformancePlan["scope"];
  excludedOperationKeys?: string[];
  journeyOrder?: string[];
  stepOrder?: Record<string, string[]>;
  thinkTimeMs?: number;
  loadProfile?: { kind: PerformancePlan["loadProfile"]["kind"]; stages: PerformancePlan["loadProfile"]["stages"] };
  thresholds?: Array<Omit<PerformancePlan["thresholds"][number], "id">>;
  expectedStatuses?: Record<string, string[]>;
}

export function updatePlan(update: PlanUpdate): Promise<PlanResult> {
  return request("updatePlan", `${BASE}/plan`, json("PUT", update), toPlan);
}

export function resetPlan(): Promise<PlanResult> {
  return request("resetPlan", `${BASE}/plan/reset`, json("POST"), toPlan);
}

export type ValueStatusesResult = Result<{
  environment: { id: string; name: string; tier: string; baseUrl: string };
  values: UserSuppliedValueStatus[];
}>;

export function fetchValueStatuses(environmentId: string): Promise<ValueStatusesResult> {
  return request("fetchValueStatuses", `${BASE}/plan/values?environmentId=${encodeURIComponent(environmentId)}`, undefined, (body) => ({
    environment: body.environment as { id: string; name: string; tier: string; baseUrl: string },
    values: (body.values ?? []) as UserSuppliedValueStatus[],
  }));
}

export function generateScript(): Promise<Result<{ script: ScriptStatus }>> {
  return request("generateScript", `${BASE}/script`, json("POST"), (body) => ({ script: body.script as ScriptStatus }));
}

/** For an `<a download>`: the browser fetches the file itself, so no script text passes through app state. */
export function scriptDownloadUrl(file: "script" | "environment-template"): string {
  return `${BASE}/script/download?file=${file}`;
}

export function fetchReadiness(recheck = false): Promise<Result<{ readiness: K6Readiness }>> {
  return request("fetchReadiness", `${BASE}/readiness${recheck ? "?recheck=true" : ""}`, undefined, (body) => ({ readiness: body.readiness as K6Readiness }));
}

export function startRun(environmentId: string): Promise<Result<{ run: PerformanceRun }>> {
  return request("startRun", `${BASE}/runs`, json("POST", { environmentId }), (body) => ({ run: body.run as PerformanceRun }));
}

export function fetchRuns(): Promise<Result<{ runs: PerformanceRunSummary[] }>> {
  return request("fetchRuns", `${BASE}/runs`, undefined, (body) => ({ runs: (body.runs ?? []) as PerformanceRunSummary[] }));
}

export function fetchRun(runId: string): Promise<Result<{ run: PerformanceRun }>> {
  return request("fetchRun", `${BASE}/runs/${encodeURIComponent(runId)}`, undefined, (body) => ({ run: body.run as PerformanceRun }));
}

export function cancelRun(runId: string): Promise<Result<{ run: PerformanceRun }>> {
  return request("cancelRun", `${BASE}/runs/${encodeURIComponent(runId)}/cancel`, json("POST"), (body) => ({ run: body.run as PerformanceRun }));
}

/** The report HTML, for the sandboxed frame. The download link fetches the same bytes (research D17). */
export async function fetchReport(runId: string): Promise<Result<{ html: string }>> {
  const operation = "fetchReport";
  let response: Response;
  try {
    response = await fetch(`${BASE}/runs/${encodeURIComponent(runId)}/report`);
  } catch (err) {
    logger.error("network_error", { operation, errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
  if (!response.ok) {
    const parsed = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const error = typeof parsed?.error === "string" ? parsed.error : "unknown_error";
    logger.error("request_failed", { operation, errorCategory: error, statusCode: response.status });
    return { ok: false, error, message: typeof parsed?.message === "string" ? parsed.message : `Request failed with status ${response.status}` };
  }
  return { ok: true, html: await response.text() };
}

export function reportDownloadUrl(runId: string): string {
  return `${BASE}/runs/${encodeURIComponent(runId)}/report?download=true`;
}
