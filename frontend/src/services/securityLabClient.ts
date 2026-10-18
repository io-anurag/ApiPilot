import type {
  ExecutionStatus,
  GenerationReply,
  ScenarioDetail,
  ScenarioEditReply,
  ScenarioIdsReply,
  ScenarioListItem,
  ScenarioListReply,
  ScenarioReference,
  ScenarioReviewReply,
  ScenarioScopeReply,
  SecurityAnalysis,
  SecurityCategory,
  SecurityReviewAction,
  SecurityReviewState,
  Severity,
  TaxonomyEdition,
} from "@apipilot/shared-domain";
import { createLogger } from "../logger";

/**
 * Security Lab client (specs/057 contracts/security-lab-api.md). Follows the coverage client's pattern:
 * every call returns a discriminated result and never throws, a failure carries the server's error code and
 * safe message, and only typed fields are logged: an operation, an error category and a status, never a
 * request or response body, an id or a credential (constitution XX). The browser holds no session or owner id;
 * both cookies are httpOnly and sent by the browser.
 */

const logger = createLogger("securityLabClient");
const BASE = "/api/security-lab";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string; status: number; details: Record<string, unknown> };

type Validator<T> = (body: unknown) => body is T;

export interface RequestOptions {
  signal?: AbortSignal;
}

function networkFailure(operation: string, err: unknown): ApiResult<never> {
  logger.error("request_failed", { operation, errorCategory: "network_error" });
  return {
    ok: false,
    error: "network_error",
    message: err instanceof Error ? err.message : "The Security Lab service is unreachable.",
    status: 0,
    details: {},
  };
}

/** Builds the failure for a non-2xx reply from the server's own error code and safe message. */
function httpFailure(operation: string, status: number, parsed: unknown): ApiResult<never> {
  const record = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;
  const error = typeof record.error === "string" ? record.error : "unknown_error";
  logger.error("request_failed", { operation, errorCategory: error, statusCode: status });
  const details: Record<string, unknown> = { ...record };
  delete details.error;
  delete details.message;
  const message = typeof record.message === "string" ? record.message : `Request failed with status ${status}`;
  return { ok: false, error, message, status, details };
}

/** One typed request. A body is sent as JSON; the reply must pass `validate` or the call fails with `invalid_response`. */
export async function securityLabRequest<T>(
  operation: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  validate: Validator<T>,
  body?: unknown,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      cache: "no-store",
      signal: options.signal,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return networkFailure(operation, err);
  }

  // A 204 has no body; treat it as an empty object so callers can validate `{}`.
  const parsed = response.status === 204 ? {} : ((await response.json().catch(() => null)) as unknown);
  if (!response.ok) return httpFailure(operation, response.status, parsed);
  if (!validate(parsed)) {
    logger.error("request_failed", { operation, errorCategory: "invalid_response", statusCode: response.status });
    return { ok: false, error: "invalid_response", message: "The Security Lab reply was not understood.", status: response.status, details: {} };
  }
  return { ok: true, data: parsed };
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// --- Registry --------------------------------------------------------------------------------

export interface CategoriesReply {
  edition: TaxonomyEdition;
  editionTitle: string;
  editionSource: string;
  taxonomy: { id: string; name: string }[];
  categories: SecurityCategory[];
}

const isCategoriesReply = (body: unknown): body is CategoriesReply =>
  isRecord(body) && typeof body.edition === "string" && Array.isArray(body.taxonomy) && Array.isArray(body.categories);

export function fetchCategories(options?: RequestOptions): Promise<ApiResult<CategoriesReply>> {
  return securityLabRequest("fetchCategories", "GET", "/categories", isCategoriesReply, undefined, options);
}

// --- Analysis and settings (US1) -----------------------------------------------------------------

export interface AnalysisReply {
  analysis: SecurityAnalysis;
  configuredSensitiveFields: string[];
  operationCount: number;
}

const isAnalysisReply = (body: unknown): body is AnalysisReply =>
  isRecord(body) && isRecord(body.analysis) && Array.isArray((body.analysis as Record<string, unknown>).observations) && typeof body.operationCount === "number";

export function fetchAnalysis(options?: RequestOptions): Promise<ApiResult<AnalysisReply>> {
  return securityLabRequest("fetchAnalysis", "GET", "/analysis", isAnalysisReply, undefined, options);
}

export interface SettingsReply {
  sensitiveFields: string[];
}

const isSettingsReply = (body: unknown): body is SettingsReply => isRecord(body) && Array.isArray(body.sensitiveFields);

export function fetchSettings(options?: RequestOptions): Promise<ApiResult<SettingsReply>> {
  return securityLabRequest("fetchSettings", "GET", "/settings", isSettingsReply, undefined, options);
}

export function saveSettings(sensitiveFields: string[], options?: RequestOptions): Promise<ApiResult<SettingsReply>> {
  return securityLabRequest("saveSettings", "PUT", "/settings", isSettingsReply, { sensitiveFields }, options);
}

// --- Scenarios (US2) -----------------------------------------------------------------------------

/** The derived-flag filters the server accepts. */
export type ScenarioFlagFilter = "stale" | "orphaned" | "blocked" | "executable" | "specification_not_loaded";

/** The filters of a scenario list. An absent field is not applied. */
export interface ScenarioFilterQuery {
  q?: string;
  operation?: string;
  category?: string;
  severity?: Severity;
  reviewState?: SecurityReviewState;
  executionStatus?: ExecutionStatus;
  flag?: ScenarioFlagFilter;
}

export interface ScenarioPaging {
  page?: number;
  pageSize?: number;
}

/** The largest page the server serves. */
export const SCENARIO_MAX_PAGE_SIZE = 100;

/** The query string for a list or id request: only fields that are set, in a fixed order so the address is stable. */
export function scenarioQueryString(filters: ScenarioFilterQuery, paging: ScenarioPaging = {}): string {
  const params = new URLSearchParams();
  const entries: Array<[string, string | number | undefined]> = [
    ["q", filters.q],
    ["operation", filters.operation],
    ["category", filters.category],
    ["severity", filters.severity],
    ["reviewState", filters.reviewState],
    ["executionStatus", filters.executionStatus],
    ["flag", filters.flag],
    ["page", paging.page],
    ["pageSize", paging.pageSize],
  ];
  for (const [key, value] of entries) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const isScopeReply = (body: unknown): body is ScenarioScopeReply =>
  isRecord(body) && (body.mode === "selection" || body.mode === "all") && isNumber(body.selectedCount) && isNumber(body.totalCount);

export function fetchScope(options?: RequestOptions): Promise<ApiResult<ScenarioScopeReply>> {
  return securityLabRequest("fetchScope", "GET", "/scope", isScopeReply, undefined, options);
}

const isGenerationReply = (body: unknown): body is GenerationReply =>
  isRecord(body) &&
  isRecord(body.scope) &&
  isNumber(body.created) &&
  isNumber(body.kept) &&
  isNumber(body.newVersions) &&
  Array.isArray(body.rejected) &&
  Array.isArray(body.omittedByCap) &&
  Array.isArray(body.notes);

export interface GenerateRequestBody {
  scope?: { mode: "selection" | "all" | "custom"; operationKeys?: string[] };
  categories?: string[];
}

export function generateScenarios(body: GenerateRequestBody, options?: RequestOptions): Promise<ApiResult<GenerationReply>> {
  return securityLabRequest("generateScenarios", "POST", "/scenarios/generate", isGenerationReply, body, options);
}

const isListReply = (body: unknown): body is ScenarioListReply =>
  isRecord(body) && Array.isArray(body.items) && isNumber(body.total) && isNumber(body.page) && isNumber(body.pageSize) && isRecord(body.counts);

export function listScenarios(filters: ScenarioFilterQuery, paging: ScenarioPaging = {}, options?: RequestOptions): Promise<ApiResult<ScenarioListReply>> {
  return securityLabRequest("listScenarios", "GET", `/scenarios${scenarioQueryString(filters, paging)}`, isListReply, undefined, options);
}

/** The most pages `listAllScenarios` reads: the id endpoint's cap of 5000 at the largest page size. */
const MAX_LIST_PAGES = 50;

/**
 * Every scenario a filter matches, read page by page (the batch bar needs each one's state, flags and destructive
 * mark, which `/scenarios/ids` does not carry). It stops at `total` or after `MAX_LIST_PAGES`, and a failed page
 * fails the whole call: a partial set is never returned as if it were complete.
 */
export async function listAllScenarios(filters: ScenarioFilterQuery, options?: RequestOptions): Promise<ApiResult<ScenarioListItem[]>> {
  const items: ScenarioListItem[] = [];
  for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
    const result = await listScenarios(filters, { page, pageSize: SCENARIO_MAX_PAGE_SIZE }, options);
    if (!result.ok) return result;
    items.push(...result.data.items);
    if (items.length >= result.data.total || result.data.items.length === 0) break;
  }
  return { ok: true, data: items };
}

const isReference = (value: unknown): value is ScenarioReference => isRecord(value) && typeof value.id === "string" && isNumber(value.version);

const isIdsReply = (body: unknown): body is ScenarioIdsReply =>
  isRecord(body) && Array.isArray(body.items) && body.items.every(isReference) && isNumber(body.total) && typeof body.capped === "boolean";

export function listScenarioIds(filters: ScenarioFilterQuery, options?: RequestOptions): Promise<ApiResult<ScenarioIdsReply>> {
  return securityLabRequest("listScenarioIds", "GET", `/scenarios/ids${scenarioQueryString(filters)}`, isIdsReply, undefined, options);
}

const isScenarioDetail = (body: unknown): body is ScenarioDetail =>
  isRecord(body) && isRecord(body.scenario) && isRecord(body.content) && Array.isArray(body.versions);

export function fetchScenario(id: string, options?: RequestOptions): Promise<ApiResult<ScenarioDetail>> {
  return securityLabRequest("fetchScenario", "GET", `/scenarios/${encodeURIComponent(id)}`, isScenarioDetail, undefined, options);
}

const isEditReply = (body: unknown): body is ScenarioEditReply =>
  isRecord(body) && typeof body.scenarioId === "string" && isNumber(body.version) && typeof body.material === "boolean" && isScenarioDetail(body.scenario);

export interface EditScenarioBody {
  expectedVersion: number;
  changes: Record<string, unknown>;
  note?: string;
}

export function editScenario(id: string, body: EditScenarioBody, options?: RequestOptions): Promise<ApiResult<ScenarioEditReply>> {
  return securityLabRequest("editScenario", "PATCH", `/scenarios/${encodeURIComponent(id)}`, isEditReply, body, options);
}

const isReviewReply = (body: unknown): body is ScenarioReviewReply => isRecord(body) && Array.isArray(body.applied) && Array.isArray(body.refused);

export interface ReviewScenariosBody {
  action: SecurityReviewAction;
  /** Always an explicit list: the server never accepts a filter. */
  items: ScenarioReference[];
  reason?: string;
  destructiveConfirmations?: string[];
}

export function reviewScenarios(body: ReviewScenariosBody, options?: RequestOptions): Promise<ApiResult<ScenarioReviewReply>> {
  return securityLabRequest("reviewScenarios", "POST", "/scenarios/review", isReviewReply, body, options);
}
