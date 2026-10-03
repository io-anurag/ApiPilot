import type { K6Readiness, PerformanceRun, PerformanceRunSummary } from "@apipilot/shared-domain";
import { createLogger } from "../logger";

/**
 * The request and error handling shared by the performance clients (AP-029 contracts/performance-api.md,
 * AP-034 user scripts, AP-037 request-chain plans and legacy runs). Every error body
 * `{error, message, …}` becomes `{ok: false, …}`; a thrown fetch is `network_error`. The plan client
 * of the retired derived plans was removed in AP-037 phase two.
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
  /** AP-033 body-edit refusals (specs/033 contracts/body-edits-api.md): the step and where. */
  stepId?: string;
  line?: number;
  column?: number;
  reference?: string;
  fieldPath?: string;
  limitBytes?: number;
  /** AP-033 parameter-edit refusals (amended 2026-09-30): the parameter refused. */
  location?: string;
  name?: string;
  /** AP-035 user-journey refusals (specs/035 contracts/plan-journeys-api.md): which capture, target or journey. */
  capture?: string;
  captureName?: string;
  operationKey?: string;
  journeyId?: string;
  path?: string;
  target?: string;
  position?: number;
  /** AP-036 `409 collection_plan_out_of_date`: `changed` or `deleted`. */
  state?: string;
  /** AP-036 `400 not_supported_for_collection_plan`: the refused `PUT /plan` field. */
  field?: string;
  /** AP-036 `422 too_many_requests`: how many requests were selected. */
  count?: number;
}

export type Result<T> = ({ ok: true } & T) | PerformanceErrorResult;

type ErrorExtras = Omit<PerformanceErrorResult, "ok" | "error" | "message">;

const STRING_EXTRAS = [
  "variable",
  "runId",
  "stepId",
  "reference",
  "fieldPath",
  "location",
  "name",
  "capture",
  "captureName",
  "operationKey",
  "journeyId",
  "path",
  "target",
  "state",
  "field",
] as const;
const NUMBER_EXTRAS = ["line", "column", "limitBytes", "position", "count"] as const;

/** The contract's extra error fields, each copied only when it has the documented type. */
function errorExtras(parsed: Record<string, unknown>): ErrorExtras {
  const extras: ErrorExtras = {};
  if (Array.isArray(parsed.stepIds)) extras.stepIds = parsed.stepIds as string[];
  if (parsed.readiness) extras.readiness = parsed.readiness as K6Readiness;
  for (const key of STRING_EXTRAS) {
    const value = parsed[key];
    if (typeof value === "string") extras[key] = value;
  }
  for (const key of NUMBER_EXTRAS) {
    const value = parsed[key];
    if (typeof value === "number") extras[key] = value;
  }
  return extras;
}

/** Exported for AP-036's collection client, whose own routes share this error contract. */
export async function request<T>(operation: string, path: string, init: RequestInit | undefined, map: (body: Record<string, unknown>) => T): Promise<Result<T>> {
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
      ...errorExtras(parsed ?? {}),
    };
  }
  return { ok: true, ...map(parsed ?? {}) };
}

export function json(method: string, body?: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) };
}

/**
 * The readiness, run and report calls that `usePerformanceRuns` needs (AP-034, specs/034 tasks
 * T016). A request-chain plan starts a run from an environment id; AP-034's user scripts also
 * name the script and the SHA-256 the trigger showed, so the start input, run and summary types are
 * parameters.
 */
export interface PerformanceRunsClient<TRun = PerformanceRun, TSummary = PerformanceRunSummary, TStartInput = string> {
  fetchReadiness(recheck?: boolean): Promise<Result<{ readiness: K6Readiness }>>;
  startRun(input: TStartInput): Promise<Result<{ run: TRun }>>;
  fetchRuns(): Promise<Result<{ runs: TSummary[] }>>;
  fetchRun(runId: string): Promise<Result<{ run: TRun }>>;
  cancelRun(runId: string): Promise<Result<{ run: TRun }>>;
  /** The report HTML, for the sandboxed frame. The download link fetches the same bytes (research D17). */
  fetchReport(runId: string): Promise<Result<{ html: string }>>;
  reportDownloadUrl(runId: string): string;
}

/** Exported for AP-034's user-script client, whose report route has the same shape. */
export async function fetchReportFrom(base: string, runId: string): Promise<Result<{ html: string }>> {
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
