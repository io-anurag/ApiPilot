import type {
  BindingTarget,
  BodyEditInput,
  ParameterEditInput,
  K6Readiness,
  PerformancePlan,
  PerformanceRun,
  PerformanceRunSummary,
  RemovedOperationPreview,
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
  /** AP-033: a step's new base body, or `null` to reset it to the generated body. */
  bodyEdits?: Record<string, BodyEditInput | null>;
  /** AP-033 FR-020 (amended 2026-09-30): a step's full set of parameter changes, or `null` to reset them. */
  parameterEdits?: Record<string, ParameterEditInput | null>;
  /** AP-035: the complete list of the engineer's journeys (contracts/plan-journeys-api.md). */
  userJourneys?: UserJourneyInput[];
  /** AP-035 research R12: sent with a restored list, so new ids never repeat restored ones. */
  nextUserJourneyNumber?: number;
  /** AP-035 FR-003. */
  alsoStandalone?: string[];
  /** AP-035 FR-024 (guided only). */
  editProposedJourney?: string;
  revertProposedJourney?: string;
  /** AP-036 (collection plans only): the request ids the engineer removed. */
  excludedRequestIds?: string[];
  /** AP-036 FR-019: each step's full list of captures the engineer added. */
  addedCaptures?: Record<string, { name: string; source: { kind: "body"; path: string } | { kind: "header"; name: string } }[]>;
  /** AP-036 FR-019: each step's full list of references the engineer bound to an earlier capture. */
  addedBindings?: Record<string, { name: string; captureStepId: string; captureName: string }[]>;
  /** AP-036 FR-018: marks the current conversion reviewed. */
  conversionReviewed?: true;
}

/** AP-035: one journey as `PUT /plan` takes it. A new journey or step has no id. */
export interface UserJourneyInput {
  id?: string;
  name: string;
  nextStepNumber?: number;
  steps: {
    id?: string;
    operationKey: string;
    captures: { name: string; source: { kind: "body"; path: string } | { kind: "header"; name: string } }[];
    bindings: ({ target: BindingTarget; captureName: string } & ({ captureStepId: string } | { captureStepIndex: number }))[];
  }[];
}

/** AP-035 FR-009: a response field the specification documents. */
export interface DocumentedResponseField {
  path: string;
  type: string | null;
  statusCodes: string[];
}

export type ValueStatusesResult = Result<{
  environment: { id: string; name: string; tier: string; baseUrl: string };
  values: UserSuppliedValueStatus[];
}>;

/**
 * The readiness, run and report calls that `usePerformanceRuns` needs (AP-034, specs/034 tasks
 * T016). The guided and quick plan sources start a run from an environment id; AP-034's user
 * scripts also name the script and the SHA-256 the trigger showed, so the start input, run and
 * summary types are parameters.
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

/**
 * The plan, script and run calls of one plan source (AP-032, specs/032-quick-performance-test
 * research Q16): `/api/test-generation-workflow/performance` for the guided workflow's stage, or
 * `/api/quick-performance` for the quick performance test. Both share one contract.
 */
export interface PerformanceClient extends PerformanceRunsClient {
  /** Opens the plan: on the guided path the first call builds the plan and makes the stage active (contract). */
  fetchPlan(): Promise<PlanResult>;
  updatePlan(update: PlanUpdate): Promise<PlanResult>;
  resetPlan(): Promise<PlanResult>;
  fetchValueStatuses(environmentId: string): Promise<ValueStatusesResult>;
  /** AP-032 FR-008: the view-only request of one step. */
  fetchStepRequest(stepId: string): Promise<Result<{ request: StepRequestPreview }>>;
  /** A removed operation's step and request as they would be if restored; the plan is unchanged. */
  fetchRemovedOperation(operationKey: string): Promise<Result<RemovedOperationPreview>>;
  generateScript(): Promise<Result<{ script: ScriptStatus }>>;
  /** For an `<a download>`: the browser fetches the file itself, so no script text passes through app state. */
  scriptDownloadUrl(file: "script" | "environment-template"): string;
  /** AP-035 FR-009: the documented response fields of an operation, for the capture picker. */
  fetchResponseFields(operationKey: string): Promise<Result<{ fields: DocumentedResponseField[]; truncated: boolean }>>;
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
    fetchRemovedOperation: (operationKey) =>
      request(
        "fetchRemovedOperation",
        `${base}/plan/removed-operation?operationKey=${encodeURIComponent(operationKey)}`,
        undefined,
        (body) => ({ step: body.step as RemovedOperationPreview["step"], request: body.request as StepRequestPreview }),
      ),
    generateScript: () => request("generateScript", `${base}/script`, json("POST"), (body) => ({ script: body.script as ScriptStatus })),
    scriptDownloadUrl: (file) => `${base}/script/download?file=${file}`,
    fetchResponseFields: (operationKey) =>
      request("fetchResponseFields", `${base}/plan/response-fields?operationKey=${encodeURIComponent(operationKey)}`, undefined, (body) => ({
        fields: (body.fields ?? []) as DocumentedResponseField[],
        truncated: body.truncated === true,
      })),
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
  fetchRemovedOperation,
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
