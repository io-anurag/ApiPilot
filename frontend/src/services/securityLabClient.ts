import type {
  CredentialStatus,
  FindingEvidenceReply,
  FindingListReply,
  FindingStatus,
  RetainedDataSummary,
  SecurityFinding,
  SecurityExportReply,
  SecurityOverview,
  SecurityReport,
  SuggestReply,
  ExecutionStatus,
  GenerationReply,
  ProfileCheck,
  ProfileView,
  RunDetail,
  RunPreview,
  RunRequestInput,
  SecurityProfileInput,
  SecurityRunView,
  StartRunInput,
  TargetEnvironment,
  TargetEnvironmentInput,
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
  /** Judge each scenario's prerequisites and executability against this profile (session data). */
  profileId?: string;
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
    ["profileId", filters.profileId],
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

// --- AI suggestions (US8) ------------------------------------------------------------------------

const isSuggestReply = (body: unknown): body is SuggestReply =>
  isRecord(body) && Array.isArray(body.accepted) && Array.isArray(body.rejected) && typeof body.model === "string" && typeof body.ignored === "number";

export interface SuggestRequestBody {
  operationKeys?: string[];
  categories?: string[];
}

/**
 * Asks the local AI provider for scenario suggestions. Accepted ones are stored as drafts marked as AI-origin;
 * rejected ones come back with their reasons. 503 `ai_unavailable` carries the readiness reason, and nothing else in
 * Security Lab depends on this call.
 */
export function suggestScenarios(body: SuggestRequestBody = {}, options?: RequestOptions): Promise<ApiResult<SuggestReply>> {
  return securityLabRequest("suggestScenarios", "POST", "/scenarios/suggest", isSuggestReply, body, options);
}

// --- Target environments (US6) -------------------------------------------------------------------

const isEnvironment = (value: unknown): value is TargetEnvironment =>
  isRecord(value) && typeof value.id === "string" && typeof value.name === "string" && typeof value.tier === "string" && typeof value.baseUrl === "string";

const isEnvironmentsReply = (body: unknown): body is { environments: TargetEnvironment[] } =>
  isRecord(body) && Array.isArray(body.environments) && body.environments.every(isEnvironment);

const isEnvironmentReply = (body: unknown): body is { environment: TargetEnvironment } => isRecord(body) && isEnvironment(body.environment);

export function listEnvironments(options?: RequestOptions): Promise<ApiResult<{ environments: TargetEnvironment[] }>> {
  return securityLabRequest("listEnvironments", "GET", "/environments", isEnvironmentsReply, undefined, options);
}

/** Name, tier and base URL only: these routes never carry variables. */
export function createEnvironment(input: TargetEnvironmentInput, options?: RequestOptions): Promise<ApiResult<{ environment: TargetEnvironment }>> {
  return securityLabRequest("createEnvironment", "POST", "/environments", isEnvironmentReply, input, options);
}

export function updateEnvironment(id: string, input: TargetEnvironmentInput, options?: RequestOptions): Promise<ApiResult<{ environment: TargetEnvironment }>> {
  return securityLabRequest("updateEnvironment", "PUT", `/environments/${encodeURIComponent(id)}`, isEnvironmentReply, input, options);
}

// --- Profiles (US6) ------------------------------------------------------------------------------

const isProfileView = (value: unknown): value is ProfileView =>
  isRecord(value) && isRecord(value.profile) && Array.isArray(value.credentialStatus) && typeof value.valid === "boolean" && Array.isArray(value.problems);

const isProfilesReply = (body: unknown): body is { profiles: ProfileView[] } => isRecord(body) && Array.isArray(body.profiles) && body.profiles.every(isProfileView);

export function listProfiles(options?: RequestOptions): Promise<ApiResult<{ profiles: ProfileView[] }>> {
  return securityLabRequest("listProfiles", "GET", "/profiles", isProfilesReply, undefined, options);
}

export function createProfile(input: SecurityProfileInput, options?: RequestOptions): Promise<ApiResult<ProfileView>> {
  return securityLabRequest("createProfile", "POST", "/profiles", isProfileView, input, options);
}

export function updateProfile(id: string, input: SecurityProfileInput, options?: RequestOptions): Promise<ApiResult<ProfileView>> {
  return securityLabRequest("updateProfile", "PUT", `/profiles/${encodeURIComponent(id)}`, isProfileView, input, options);
}

/** A 204: the reply has no body, so it validates as an empty object. */
export function deleteProfile(id: string, options?: RequestOptions): Promise<ApiResult<Record<string, unknown>>> {
  return securityLabRequest("deleteProfile", "DELETE", `/profiles/${encodeURIComponent(id)}`, isRecord, undefined, options);
}

const isProfileCheck = (body: unknown): body is ProfileCheck => isRecord(body) && typeof body.valid === "boolean" && Array.isArray(body.problems);

/** Re-validates the profile and resolves its host under the destination policy. Sends no request to the target. */
export function checkProfile(id: string, options?: RequestOptions): Promise<ApiResult<ProfileCheck>> {
  return securityLabRequest("checkProfile", "POST", `/profiles/${encodeURIComponent(id)}/check`, isProfileCheck, undefined, options);
}

export interface CredentialInput {
  identity: string;
  scheme: string;
  kind: "active" | "expired";
  /** Write-only. An empty string clears the credential. It is sent once and never read back, kept or logged. */
  value: string;
}

/** A 204. The value goes to the server and nothing returns it; the only read path is `fetchCredentialStatus`. */
export function setCredential(profileId: string, input: CredentialInput, options?: RequestOptions): Promise<ApiResult<Record<string, unknown>>> {
  return securityLabRequest("setCredential", "PUT", `/profiles/${encodeURIComponent(profileId)}/credentials`, isRecord, input, options);
}

const isCredentialStatusReply = (body: unknown): body is { credentialStatus: CredentialStatus[] } => isRecord(body) && Array.isArray(body.credentialStatus);

export function fetchCredentialStatus(profileId: string, options?: RequestOptions): Promise<ApiResult<{ credentialStatus: CredentialStatus[] }>> {
  return securityLabRequest("fetchCredentialStatus", "GET", `/profiles/${encodeURIComponent(profileId)}/credentials`, isCredentialStatusReply, undefined, options);
}

// --- Runs (US3) ----------------------------------------------------------------------------------

const isRunPreview = (body: unknown): body is RunPreview =>
  isRecord(body) && isRecord(body.summary) && Array.isArray(body.scenarios) && typeof body.planDigest === "string" && Array.isArray(body.problems);

/** Judges everything a run would and sends nothing to the target. */
export function previewRun(body: RunRequestInput, options?: RequestOptions): Promise<ApiResult<RunPreview>> {
  return securityLabRequest("previewRun", "POST", "/runs/preview", isRunPreview, body, options);
}

const isRunView = (value: unknown): value is SecurityRunView =>
  isRecord(value) && typeof value.id === "string" && typeof value.status === "string" && Array.isArray(value.plan);

const isRunReply = (body: unknown): body is { run: SecurityRunView } => isRecord(body) && isRunView(body.run);

/** The only way a run starts: a confirmed plan, with the digest the preview returned. */
export function startRun(body: StartRunInput, options?: RequestOptions): Promise<ApiResult<{ run: SecurityRunView }>> {
  return securityLabRequest("startRun", "POST", "/runs", isRunReply, body, options);
}

const isRunsReply = (body: unknown): body is { runs: SecurityRunView[] } => isRecord(body) && Array.isArray(body.runs) && body.runs.every(isRunView);

export function listRuns(options?: RequestOptions): Promise<ApiResult<{ runs: SecurityRunView[] }>> {
  return securityLabRequest("listRuns", "GET", "/runs", isRunsReply, undefined, options);
}

const isRunDetail = (body: unknown): body is RunDetail =>
  isRecord(body) && isRunView(body.run) && Array.isArray(body.results) && isRecord(body.progress);

export function fetchRun(id: string, options?: RequestOptions): Promise<ApiResult<RunDetail>> {
  return securityLabRequest("fetchRun", "GET", `/runs/${encodeURIComponent(id)}`, isRunDetail, undefined, options);
}

export function cancelRun(id: string, options?: RequestOptions): Promise<ApiResult<{ run: SecurityRunView }>> {
  return securityLabRequest("cancelRun", "POST", `/runs/${encodeURIComponent(id)}/cancel`, isRunReply, undefined, options);
}

// --- Findings (US4) ------------------------------------------------------------------------------

/** The filters of a finding list. An absent field is not applied. */
export interface FindingFilterQuery {
  severity?: Severity;
  status?: FindingStatus;
  category?: string;
  operation?: string;
  /** A scenario id. */
  scenario?: string;
  /** True: only findings with an occurrence not yet reviewed. */
  unreviewed?: boolean;
  assessment?: string;
}

/** The query string for a finding list: only fields that are set, in a fixed order so the address is stable. */
export function findingQueryString(filters: FindingFilterQuery, paging: ScenarioPaging = {}): string {
  const params = new URLSearchParams();
  const entries: Array<[string, string | number | boolean | undefined]> = [
    ["severity", filters.severity],
    ["status", filters.status],
    ["category", filters.category],
    ["operation", filters.operation],
    ["scenario", filters.scenario],
    ["unreviewed", filters.unreviewed],
    ["assessment", filters.assessment],
    ["page", paging.page],
    ["pageSize", paging.pageSize],
  ];
  for (const [key, value] of entries) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

const isFinding = (value: unknown): value is SecurityFinding =>
  isRecord(value) &&
  typeof value.id === "string" &&
  isRecord(value.severity) &&
  Array.isArray(value.occurrences) &&
  typeof value.occurrenceCount === "number" &&
  typeof value.status === "string";

const isFindingListReply = (body: unknown): body is FindingListReply =>
  isRecord(body) && Array.isArray(body.items) && body.items.every(isFinding) && isNumber(body.total) && isNumber(body.page) && isNumber(body.pageSize) && isRecord(body.counts);

export function listFindings(filters: FindingFilterQuery, paging: ScenarioPaging = {}, options?: RequestOptions): Promise<ApiResult<FindingListReply>> {
  return securityLabRequest("listFindings", "GET", `/findings${findingQueryString(filters, paging)}`, isFindingListReply, undefined, options);
}

export function fetchFinding(id: string, options?: RequestOptions): Promise<ApiResult<SecurityFinding>> {
  return securityLabRequest("fetchFinding", "GET", `/findings/${encodeURIComponent(id)}`, isFinding, undefined, options);
}

const isEvidenceReply = (body: unknown): body is FindingEvidenceReply => isRecord(body) && typeof body.available === "boolean" && Array.isArray(body.records);

/** The redacted evidence behind one occurrence. Session data: `available: false` once the session that held it has ended. */
export function fetchFindingEvidence(findingId: string, resultId: string, options?: RequestOptions): Promise<ApiResult<FindingEvidenceReply>> {
  return securityLabRequest(
    "fetchFindingEvidence",
    "GET",
    `/findings/${encodeURIComponent(findingId)}/occurrences/${encodeURIComponent(resultId)}/evidence`,
    isEvidenceReply,
    undefined,
    options,
  );
}

export interface FindingPatchBody {
  status?: FindingStatus;
  severity?: Severity;
  /** Required by the server for a status or a severity change. */
  note?: string;
  acknowledgeOccurrences?: boolean;
}

export function patchFinding(id: string, body: FindingPatchBody, options?: RequestOptions): Promise<ApiResult<SecurityFinding>> {
  return securityLabRequest("patchFinding", "PATCH", `/findings/${encodeURIComponent(id)}`, isFinding, body, options);
}

// --- Overview, report, retained data (US5) ---------------------------------------------------------

const isOverview = (body: unknown): body is SecurityOverview =>
  isRecord(body) &&
  typeof body.specificationLoaded === "boolean" &&
  isRecord(body.observationCounts) &&
  isRecord(body.scenarioCounts) &&
  isRecord(body.findingCounts) &&
  Array.isArray(body.untestedHighPriority);

export function fetchOverview(options?: RequestOptions): Promise<ApiResult<SecurityOverview>> {
  return securityLabRequest("fetchOverview", "GET", "/overview", isOverview, undefined, options);
}

const isReport = (body: unknown): body is SecurityReport =>
  isRecord(body) && typeof body.generatedAt === "string" && isRecord(body.overview) && Array.isArray(body.categoryCoverage) && Array.isArray(body.findings) && Array.isArray(body.runs) && typeof body.limitsStatement === "string";

const reportPath = (format: "html" | "json", runIds: readonly string[] | undefined): string => {
  const params = new URLSearchParams({ format });
  if (runIds && runIds.length > 0) params.set("runIds", runIds.join(","));
  return `/report?${params.toString()}`;
};

/** The report as data, to show on screen. Built from retained work, so it needs no specification. 409 `nothing_to_report` when there is nothing yet. */
export function fetchReport(runIds?: readonly string[], options?: RequestOptions): Promise<ApiResult<SecurityReport>> {
  return securityLabRequest("fetchReport", "GET", reportPath("json", runIds), isReport, undefined, options);
}

export interface ReportFile {
  blob: Blob;
  fileName: string;
}

const FILE_NAME = /filename="([^"]+)"/;

/**
 * The report as a file to save (HTML is one self-contained file). The download is requested here, with the same error
 * handling as every call, so a refusal such as `nothing_to_report` arrives as a message and not as a broken download.
 */
export async function downloadReport(format: "html" | "json", runIds?: readonly string[], options: RequestOptions = {}): Promise<ApiResult<ReportFile>> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${reportPath(format, runIds)}`, { method: "GET", cache: "no-store", signal: options.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return networkFailure("downloadReport", err);
  }
  if (!response.ok) return httpFailure("downloadReport", response.status, await response.json().catch(() => null));
  const blob = await response.blob();
  const fileName = FILE_NAME.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? `security-report.${format}`;
  return { ok: true, data: { blob, fileName } };
}

// --- Postman export of approved scenarios (US7) ---------------------------------------------------

const isExportReply = (body: unknown): body is SecurityExportReply =>
  isRecord(body) &&
  isRecord(body.collection) &&
  isRecord(body.environment) &&
  typeof body.readme === "string" &&
  Array.isArray(body.limitations) &&
  isRecord(body.summary) &&
  Array.isArray(body.excluded);

/**
 * `GET /export/postman`: the approved scenarios, at their approved versions, as a collection, an environment and a README.
 * Credentials are empty variables in the environment. 409 `no_approved_scenarios` and 422 `export_failed` arrive as
 * messages, with the generator's problems in `details`. Needs a loaded specification (409 `no_specification`).
 */
export function exportSecurityPostman(baseUrl?: string, options?: RequestOptions): Promise<ApiResult<SecurityExportReply>> {
  const query = baseUrl && baseUrl.trim() !== "" ? `?${new URLSearchParams({ baseUrl: baseUrl.trim() }).toString()}` : "";
  return securityLabRequest("exportSecurityPostman", "GET", `/export/postman${query}`, isExportReply, undefined, options);
}

const isRetainedData = (body: unknown): body is RetainedDataSummary =>
  isRecord(body) && Array.isArray(body.assessments) && isRecord(body.totals) && isRecord(body.caps) && Array.isArray(body.removedWithSession) && Array.isArray(body.retained);

export function fetchRetainedData(options?: RequestOptions): Promise<ApiResult<RetainedDataSummary>> {
  return securityLabRequest("fetchRetainedData", "GET", "/data", isRetainedData, undefined, options);
}

/** A 204. `confirm` must be the assessment's label, typed back; the server refuses anything else. */
export function deleteAssessment(assessmentKey: string, confirm: string, options?: RequestOptions): Promise<ApiResult<Record<string, unknown>>> {
  return securityLabRequest("deleteAssessment", "DELETE", `/assessments/${encodeURIComponent(assessmentKey)}`, isRecord, { confirm }, options);
}

/** A 204. `confirm` must be `DELETE ALL`. */
export function deleteAllRetainedData(confirm: string, options?: RequestOptions): Promise<ApiResult<Record<string, unknown>>> {
  return securityLabRequest("deleteAllRetainedData", "DELETE", "/data", isRecord, { confirm }, options);
}
