import type {
  ChainPlan,
  ChainPlanInput,
  ChainPlanSummary,
  ChainPlanView,
  ChainRun,
  ChainRunSummary,
  DataSetColumn,
  DataSetInfo,
  DataSetMode,
  DataSetPreview,
  DebugRunResult,
  K6Readiness,
  MovedCredential,
  PlanBlocker,
  ScriptStatus,
} from "@apipilot/shared-domain";
import { createLogger } from "../logger";
import { fetchReportFrom, json, request, type PerformanceRunsClient } from "./performanceTestingClient";

/**
 * AP-037 request-chain plans (specs/037-request-chain-performance contracts/chain-plan-api.md). Every
 * HTTP call of the request-chain screens goes through this module. Error bodies `{error, message, …}`
 * become `{ok: false, …}` with the contract's details; a thrown fetch is `network_error`. No call
 * returns a value of an environment or a data set, except the data set preview's non-secret cells.
 */

const logger = createLogger("requestChainClient");
export const CHAIN_PLANS_BASE = "/api/chain-plans";

export interface ChainErrorResult {
  ok: false;
  error: string;
  message: string;
  stepId?: string;
  chainId?: string;
  field?: string;
  header?: string;
  limit?: string;
  location?: MovedCredential["location"];
  /** `409 plan_revision_conflict`: the plan as stored now. */
  current?: ChainPlanView;
  /** `422 plan_has_blockers`. */
  blockers?: PlanBlocker[];
  /** `409 execution_in_progress`. */
  runId?: string;
  /** `409 k6_unavailable`. */
  readiness?: K6Readiness;
  /** `422 data_set_invalid`: why, and where when it applies. */
  reason?: string;
  line?: number;
  column?: string;
  expected?: number;
  found?: number;
  dataSetName?: string;
}

export type ChainResult<T> = ({ ok: true } & T) | ChainErrorResult;

const DETAIL_KEYS = ["stepId", "chainId", "field", "header", "limit", "location", "current", "blockers", "runId", "readiness", "reason", "line", "column", "expected", "found", "dataSetName"] as const;

async function chainRequest<T>(operation: string, path: string, init: RequestInit | undefined, map: (body: Record<string, unknown>) => T): Promise<ChainResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (err) {
    // The engineer cancelled (a Debug run's request is aborted to cancel it): not an error to log.
    if (err instanceof DOMException && err.name === "AbortError") return { ok: false, error: "aborted", message: "Cancelled." };
    logger.error("network_error", { operation, errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
  if (response.status === 204) return { ok: true, ...map({}) };
  const parsed = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const error = typeof parsed?.error === "string" ? parsed.error : "unknown_error";
    logger.error("request_failed", { operation, errorCategory: error, statusCode: response.status });
    const result: ChainErrorResult = { ok: false, error, message: typeof parsed?.message === "string" ? parsed.message : `Request failed with status ${response.status}` };
    for (const key of DETAIL_KEYS) {
      if (parsed && parsed[key] !== undefined) (result as unknown as Record<string, unknown>)[key] = parsed[key];
    }
    return result;
  }
  return { ok: true, ...map(parsed ?? {}) };
}

const toView = (body: Record<string, unknown>): ChainPlanView => ({
  plan: body.plan as ChainPlan,
  analysis: body.analysis as ChainPlanView["analysis"],
  script: (body.script as ScriptStatus | null) ?? null,
});

const toSaved = (body: Record<string, unknown>) => ({ ...toView(body), movedCredentials: (body.movedCredentials ?? []) as MovedCredential[] });

function planPath(planId: string): string {
  return `${CHAIN_PLANS_BASE}/${encodeURIComponent(planId)}`;
}

export type SeedSourceInput = { kind: "specification"; selectedOperationKeys?: string[] } | { kind: "workflow" } | { kind: "collection"; collectionId: string; orderedRequestIds: string[] };

export const listPlans = () => chainRequest("listPlans", CHAIN_PLANS_BASE, undefined, (body) => ({ plans: (body.plans ?? []) as ChainPlanSummary[] }));

export const createPlan = (name: string) => chainRequest("createPlan", CHAIN_PLANS_BASE, json("POST", { name }), toView);

export const seedPlan = (input: { name: string; source: SeedSourceInput; environmentId?: string }) =>
  chainRequest("seedPlan", `${CHAIN_PLANS_BASE}/seed`, json("POST", input), toSaved);

export const fetchPlan = (planId: string) => chainRequest("fetchPlan", planPath(planId), undefined, toView);

export const savePlan = (planId: string, revision: number, plan: ChainPlanInput) => chainRequest("savePlan", planPath(planId), json("PUT", { revision, plan }), toSaved);

export const duplicatePlan = (planId: string, name: string) => chainRequest("duplicatePlan", `${planPath(planId)}/duplicate`, json("POST", { name }), toView);

export const deletePlan = (planId: string) => chainRequest("deletePlan", planPath(planId), { method: "DELETE" }, () => ({}));

function dataSetForm(file: File, fields: Record<string, string> = {}): RequestInit {
  const form = new FormData();
  form.append("file", file);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return { method: "POST", body: form };
}

const toDataSet = (body: Record<string, unknown>) => ({ dataSet: body.dataSet as DataSetInfo, ...toView(body) });

export const uploadDataSet = (planId: string, file: File, name: string, mode: DataSetMode) =>
  chainRequest("uploadDataSet", `${planPath(planId)}/data-sets`, dataSetForm(file, { name, mode }), toDataSet);

export const updateDataSet = (planId: string, dataSetId: string, update: { name: string; mode: DataSetMode; columns: DataSetColumn[] }) =>
  chainRequest("updateDataSet", `${planPath(planId)}/data-sets/${encodeURIComponent(dataSetId)}`, json("PUT", update), toDataSet);

export const replaceDataSetFile = (planId: string, dataSetId: string, file: File) =>
  chainRequest("replaceDataSetFile", `${planPath(planId)}/data-sets/${encodeURIComponent(dataSetId)}/file`, { ...dataSetForm(file), method: "PUT" }, toDataSet);

export const deleteDataSet = (planId: string, dataSetId: string) =>
  chainRequest("deleteDataSet", `${planPath(planId)}/data-sets/${encodeURIComponent(dataSetId)}`, { method: "DELETE" }, toView);

export const fetchDataSetPreview = (planId: string, dataSetId: string) =>
  chainRequest("fetchDataSetPreview", `${planPath(planId)}/data-sets/${encodeURIComponent(dataSetId)}/preview`, undefined, (body) => ({
    preview: { columns: body.columns, rows: body.rows } as DataSetPreview,
  }));

export const generateScript = (planId: string) => chainRequest("generateScript", `${planPath(planId)}/script`, json("POST"), (body) => ({ script: body.script as ScriptStatus }));

/**
 * AP-039 (specs/039-chain-debug-run contracts/debug-run-api.md). The request stays open until the run
 * ends; aborting `signal` cancels it. The result is held in component state only: it is never written to
 * storage, the URL or a log, and `discardDebugRun` tells the server to forget what it kept for reveal.
 */
export const debugRun = (planId: string, environmentId: string, signal?: AbortSignal) =>
  chainRequest("debugRun", `${planPath(planId)}/debug-runs`, { ...json("POST", { environmentId }), signal }, (body) => ({ result: body as unknown as DebugRunResult }));

export const revealDebugValue = (planId: string, debugRunId: string, valueId: string) =>
  chainRequest("revealDebugValue", `${planPath(planId)}/debug-runs/${encodeURIComponent(debugRunId)}/values/${encodeURIComponent(valueId)}`, undefined, (body) => ({ value: String(body.value ?? "") }));

export const discardDebugRun = (planId: string, debugRunId: string) =>
  chainRequest("discardDebugRun", `${planPath(planId)}/debug-runs/${encodeURIComponent(debugRunId)}`, { method: "DELETE" }, () => ({}));

/** For an `<a download>`: the browser fetches the file itself, so no script text passes through app state. */
export const scriptDownloadUrl = (planId: string, file: "script" | "environment-template") => `${planPath(planId)}/script/download?file=${file}`;

export const restoreRun = (runId: string, into: { into: "plan"; planId: string; revision: number } | { into: "new-plan" }) =>
  chainRequest("restoreRun", `${CHAIN_PLANS_BASE}/runs/${encodeURIComponent(runId)}/restore`, json("POST", into), (body) => ({
    ...toView(body),
    dataSetsNotRestored: (body.dataSetsNotRestored ?? []) as { name: string; reason: "deleted" | "content-changed" }[],
  }));

/** The runs of one plan, in the shape `usePerformanceRuns` takes; a run starts from an environment id. */
export function chainRunsClient(planId: string): PerformanceRunsClient<ChainRun, ChainRunSummary, string> {
  const runsBase = `${CHAIN_PLANS_BASE}/runs`;
  return {
    fetchReadiness: (recheck = false) =>
      request("fetchReadiness", `${CHAIN_PLANS_BASE}/readiness${recheck ? "?recheck=true" : ""}`, undefined, (body) => ({ readiness: body.readiness as K6Readiness })),
    startRun: (environmentId) => request("startRun", `${planPath(planId)}/runs`, json("POST", { environmentId }), (body) => ({ run: body.run as ChainRun })),
    fetchRuns: () => request("fetchRuns", `${planPath(planId)}/runs`, undefined, (body) => ({ runs: (body.runs ?? []) as ChainRunSummary[] })),
    fetchRun: (runId) => request("fetchRun", `${runsBase}/${encodeURIComponent(runId)}`, undefined, (body) => ({ run: body.run as ChainRun })),
    cancelRun: (runId) => request("cancelRun", `${runsBase}/${encodeURIComponent(runId)}/cancel`, json("POST"), (body) => ({ run: body.run as ChainRun })),
    fetchReport: (runId) => fetchReportFrom(CHAIN_PLANS_BASE, runId),
    reportDownloadUrl: (runId) => `${runsBase}/${encodeURIComponent(runId)}/report?download=true`,
  };
}
