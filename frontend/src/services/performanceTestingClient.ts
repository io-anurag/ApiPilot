import type {
  K6Readiness,
  PerformancePlan,
  PerformanceRun,
  PerformanceRunSummary,
  ScriptStatus,
  StepRequestPreview,
  UserSuppliedValueStatus,
} from "@apipilot/shared-domain";
import { createLogger } from "../logger";

/**
 * One client for AP-029's contracts/performance-api.md (specs/031-k6-performance-testing), per plan
 * source (AP-032). Every error body `{error, message, …}` becomes `{ok: false, …}`; a thrown fetch
 * is `network_error`.
 */

const logger = createLogger("performanceTestingClient");

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

export type Result<T> = ({ ok: true } & T) | PerformanceErrorResult;

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

export interface PlanUpdate {
  excludedOperationKeys?: string[];
  journeyOrder?: string[];
  stepOrder?: Record<string, string[]>;
  thinkTimeMs?: number;
  loadProfile?: { kind: PerformancePlan["loadProfile"]["kind"]; stages: PerformancePlan["loadProfile"]["stages"] };
  thresholds?: Array<Omit<PerformancePlan["thresholds"][number], "id">>;
  expectedStatuses?: Record<string, string[]>;
}

export type ValueStatusesResult = Result<{
  environment: { id: string; name: string; tier: string; baseUrl: string };
  values: UserSuppliedValueStatus[];
}>;

/**
 * The plan, script and run calls of one plan source (AP-032, specs/032-quick-performance-test
 * research Q16): `/api/test-generation-workflow/performance` for the guided workflow's stage, or
 * `/api/quick-performance` for the quick performance test. Both share one contract.
 */
export interface PerformanceClient {
  /** Opens the plan: on the guided path the first call builds the plan and makes the stage active (contract). */
  fetchPlan(): Promise<PlanResult>;
  updatePlan(update: PlanUpdate): Promise<PlanResult>;
  resetPlan(): Promise<PlanResult>;
  fetchValueStatuses(environmentId: string): Promise<ValueStatusesResult>;
  /** AP-032 FR-008: the view-only request of one step. */
  fetchStepRequest(stepId: string): Promise<Result<{ request: StepRequestPreview }>>;
  generateScript(): Promise<Result<{ script: ScriptStatus }>>;
  /** For an `<a download>`: the browser fetches the file itself, so no script text passes through app state. */
  scriptDownloadUrl(file: "script" | "environment-template"): string;
  fetchReadiness(recheck?: boolean): Promise<Result<{ readiness: K6Readiness }>>;
  startRun(environmentId: string): Promise<Result<{ run: PerformanceRun }>>;
  fetchRuns(): Promise<Result<{ runs: PerformanceRunSummary[] }>>;
  fetchRun(runId: string): Promise<Result<{ run: PerformanceRun }>>;
  cancelRun(runId: string): Promise<Result<{ run: PerformanceRun }>>;
  /** The report HTML, for the sandboxed frame. The download link fetches the same bytes (research D17). */
  fetchReport(runId: string): Promise<Result<{ html: string }>>;
  reportDownloadUrl(runId: string): string;
}

async function fetchReportFrom(base: string, runId: string): Promise<Result<{ html: string }>> {
  const operation = "fetchReport";
  let response: Response;
  try {
    response = await fetch(`${base}/runs/${encodeURIComponent(runId)}/report`);
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

export function createPerformanceClient(base: string): PerformanceClient {
  return {
    fetchPlan: () => request("fetchPlan", `${base}/plan`, undefined, toPlan),
    updatePlan: (update) => request("updatePlan", `${base}/plan`, json("PUT", update), toPlan),
    resetPlan: () => request("resetPlan", `${base}/plan/reset`, json("POST"), toPlan),
    fetchValueStatuses: (environmentId) =>
      request("fetchValueStatuses", `${base}/plan/values?environmentId=${encodeURIComponent(environmentId)}`, undefined, (body) => ({
        environment: body.environment as { id: string; name: string; tier: string; baseUrl: string },
        values: (body.values ?? []) as UserSuppliedValueStatus[],
      })),
    fetchStepRequest: (stepId) =>
      request("fetchStepRequest", `${base}/plan/steps/${encodeURIComponent(stepId)}/request`, undefined, (body) => ({
        request: body.request as StepRequestPreview,
      })),
    generateScript: () => request("generateScript", `${base}/script`, json("POST"), (body) => ({ script: body.script as ScriptStatus })),
    scriptDownloadUrl: (file) => `${base}/script/download?file=${file}`,
    fetchReadiness: (recheck = false) =>
      request("fetchReadiness", `${base}/readiness${recheck ? "?recheck=true" : ""}`, undefined, (body) => ({ readiness: body.readiness as K6Readiness })),
    startRun: (environmentId) => request("startRun", `${base}/runs`, json("POST", { environmentId }), (body) => ({ run: body.run as PerformanceRun })),
    fetchRuns: () => request("fetchRuns", `${base}/runs`, undefined, (body) => ({ runs: (body.runs ?? []) as PerformanceRunSummary[] })),
    fetchRun: (runId) => request("fetchRun", `${base}/runs/${encodeURIComponent(runId)}`, undefined, (body) => ({ run: body.run as PerformanceRun })),
    cancelRun: (runId) =>
      request("cancelRun", `${base}/runs/${encodeURIComponent(runId)}/cancel`, json("POST"), (body) => ({ run: body.run as PerformanceRun })),
    fetchReport: (runId) => fetchReportFrom(base, runId),
    reportDownloadUrl: (runId) => `${base}/runs/${encodeURIComponent(runId)}/report?download=true`,
  };
}

/** The guided workflow's Performance Testing stage (AP-029 contract). */
export const guidedPerformanceClient: PerformanceClient = createPerformanceClient("/api/test-generation-workflow/performance");

export const {
  fetchPlan,
  updatePlan,
  resetPlan,
  fetchValueStatuses,
  fetchStepRequest,
  generateScript,
  scriptDownloadUrl,
  fetchReadiness,
  startRun,
  fetchRuns,
  fetchRun,
  cancelRun,
  fetchReport,
  reportDownloadUrl,
} = guidedPerformanceClient;
