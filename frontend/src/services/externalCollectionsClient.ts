import type {
  CollectionView,
  EnvironmentTier,
  ExecutionConfirmationRequirement,
  FailureAnalysis,
  FailureAnalysisAttempt,
  FailureAnalysisInProgress,
  UploadedCollectionExecutionRun,
  UploadedCollectionSet,
} from "@apipilot/shared-domain";
import { createLogger } from "../logger";

/** One client for every endpoint in contracts/external-collections-api.md (AP-026). */

const logger = createLogger("externalCollectionsClient");

/** The list/create response shape — never `variableValues` or the raw `collection` body. */
export type UploadedCollectionSummary = Omit<UploadedCollectionSet, "variableValues" | "collection">;

export interface ErrorResult {
  ok: false;
  error: string;
  message: string;
  /** Present only for `409 confirmation_required` (gate 2, FR-013). */
  confirmation?: ExecutionConfirmationRequirement;
  /** Present only for `409 execution_in_progress`. */
  runId?: string;
}

/**
 * Builds an `ErrorResult` from a response's *already-read* body. A `Response` body stream can
 * only be read once — every call site below reads it exactly once (via `.json()` on success, or
 * passing that same parsed value here on failure) rather than this function re-reading a
 * consumed stream, which previously failed silently and always fell back to a generic
 * "unknown_error"/"Request failed with status N" message, hiding the backend's real error.
 */
function parseError(parsedBody: unknown, status: number, operation: string): ErrorResult {
  const parsed = parsedBody as Record<string, unknown> | null;
  const result: ErrorResult = {
    ok: false,
    error: (parsed?.error as string) ?? "unknown_error",
    message: (parsed?.message as string) ?? `Request failed with status ${status}`,
    ...(parsed?.environmentTier
      ? {
          confirmation: {
            environmentTier: parsed.environmentTier as EnvironmentTier,
            destructiveOperations: (parsed.destructiveOperations ??
              []) as ExecutionConfirmationRequirement["destructiveOperations"],
          },
        }
      : {}),
    ...(typeof parsed?.runId === "string" ? { runId: parsed.runId as string } : {}),
  };
  logger.error("request_failed", { operation, errorCategory: result.error, statusCode: status });
  return result;
}

async function postJson(path: string, operation: string, body?: unknown): Promise<Response | { networkError: string }> {
  try {
    return await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    logger.error("network_error", { operation, errorCategory: "network_error" });
    return { networkError: message };
  }
}

export type UploadedCollectionListResult = { ok: true; uploadedCollections: UploadedCollectionSummary[] } | ErrorResult;

export async function fetchUploadedCollections(): Promise<UploadedCollectionListResult> {
  try {
    const response = await fetch("/api/external-collections");
    const parsed = await response.json().catch(() => null);
    if (!response.ok) return parseError(parsed, response.status, "fetchUploadedCollections");
    return { ok: true, uploadedCollections: (parsed?.uploadedCollections ?? []) as UploadedCollectionSummary[] };
  } catch (err) {
    logger.error("network_error", { operation: "fetchUploadedCollections", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
}

export type UploadedCollectionInput = {
  name: string;
  tier: EnvironmentTier;
  collectionFile: File;
  environmentFile: File;
  requestDelayMs?: number;
};

export type UploadedCollectionResult = { ok: true; uploadedCollection: UploadedCollectionSummary } | ErrorResult;

/** `multipart/form-data` upload (FR-001) — mirrors the existing OpenAPI-upload route's use of `multer`. */
export async function createUploadedCollection(input: UploadedCollectionInput): Promise<UploadedCollectionResult> {
  const formData = new FormData();
  formData.set("name", input.name);
  formData.set("tier", input.tier);
  formData.set("collection", input.collectionFile);
  formData.set("environment", input.environmentFile);
  if (input.requestDelayMs) formData.set("requestDelayMs", String(input.requestDelayMs));

  let response: Response;
  try {
    response = await fetch("/api/external-collections", { method: "POST", body: formData });
  } catch (err) {
    logger.error("network_error", { operation: "createUploadedCollection", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) return parseError(parsed, response.status, "createUploadedCollection");
  return { ok: true, uploadedCollection: parsed.uploadedCollection as UploadedCollectionSummary };
}

export type RemoveResult = { ok: true } | ErrorResult;

export async function removeUploadedCollection(id: string): Promise<RemoveResult> {
  let response: Response;
  try {
    response = await fetch(`/api/external-collections/${id}`, { method: "DELETE" });
  } catch (err) {
    logger.error("network_error", { operation: "removeUploadedCollection", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
  if (!response.ok) {
    const parsed = await response.json().catch(() => null);
    return parseError(parsed, response.status, "removeUploadedCollection");
  }
  return { ok: true };
}

export type UploadedRunResult = { ok: true; run: UploadedCollectionExecutionRun } | ErrorResult;

/**
 * Starts a run (FR-005). Two independent confirmation gates apply — see
 * contracts/external-collections-api.md. `selectedRequestIds` is optional (Postman-Runner-style
 * selective run, AP-028 follow-up) — omitted, every request in the collection runs, unchanged
 * from before this parameter existed.
 */
export async function startUploadedCollectionExecution(
  id: string,
  confirmed = false,
  selectedRequestIds?: string[],
): Promise<UploadedRunResult> {
  const response = await postJson(
    `/api/external-collections/${id}/execution/start`,
    "startUploadedCollectionExecution",
    { confirmed, ...(selectedRequestIds ? { selectedRequestIds } : {}) },
  );
  if ("networkError" in response) {
    return { ok: false, error: "network_error", message: response.networkError };
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) return parseError(parsed, response.status, "startUploadedCollectionExecution");
  return { ok: true, run: parsed.run as UploadedCollectionExecutionRun };
}

export async function cancelUploadedCollectionExecution(id: string): Promise<UploadedRunResult> {
  const response = await postJson(
    `/api/external-collections/${id}/execution/cancel`,
    "cancelUploadedCollectionExecution",
  );
  if ("networkError" in response) {
    return { ok: false, error: "network_error", message: response.networkError };
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) return parseError(parsed, response.status, "cancelUploadedCollectionExecution");
  return { ok: true, run: parsed.run as UploadedCollectionExecutionRun };
}

export async function fetchUploadedCollectionRun(id: string, runId: string): Promise<UploadedRunResult> {
  try {
    const response = await fetch(`/api/external-collections/${id}/execution/runs/${runId}`);
    const parsed = await response.json().catch(() => null);
    if (!response.ok) return parseError(parsed, response.status, "fetchUploadedCollectionRun");
    return { ok: true, run: parsed.run as UploadedCollectionExecutionRun };
  } catch (err) {
    logger.error("network_error", { operation: "fetchUploadedCollectionRun", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
}

export type UploadedRunSummaryListResult =
  | { ok: true; runs: Omit<UploadedCollectionExecutionRun, "results">[] }
  | ErrorResult;

export async function fetchUploadedCollectionRuns(id: string): Promise<UploadedRunSummaryListResult> {
  try {
    const response = await fetch(`/api/external-collections/${id}/execution/runs`);
    const parsed = await response.json().catch(() => null);
    if (!response.ok) return parseError(parsed, response.status, "fetchUploadedCollectionRuns");
    return { ok: true, runs: (parsed?.runs ?? []) as Omit<UploadedCollectionExecutionRun, "results">[] };
  } catch (err) {
    logger.error("network_error", { operation: "fetchUploadedCollectionRuns", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
}

/**
 * AP-031 failure analysis (specs/030-ai-failure-analysis contracts/failure-analysis-api.md). An AI
 * outcome (`ai-failed`, `not-viable`) is a 200 `FailureAnalysisAttempt`, not an `ErrorResult`;
 * `ErrorResult` covers eligibility/state refusals and network failures only.
 */

export type FailureAnalysisErrorResult = ErrorResult & {
  /** Present for `409 failure_analysis_in_progress`: which result is being analyzed. */
  inProgressResultIndex?: number;
  /** Present for `409 result_not_failed`. */
  outcome?: string;
};

export type FailureAnalysisAttemptResult = { ok: true; attempt: FailureAnalysisAttempt } | FailureAnalysisErrorResult;

export async function requestFailureAnalysis(
  collectionId: string,
  runId: string,
  resultIndex: number,
): Promise<FailureAnalysisAttemptResult> {
  const response = await postJson(
    `/api/external-collections/${collectionId}/execution/runs/${runId}/results/${resultIndex}/failure-analysis`,
    "requestFailureAnalysis",
  );
  if ("networkError" in response) {
    return { ok: false, error: "network_error", message: response.networkError };
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) {
    const base = parseError(parsed, response.status, "requestFailureAnalysis");
    return {
      ...base,
      ...(typeof parsed?.resultIndex === "number" ? { inProgressResultIndex: parsed.resultIndex as number } : {}),
      ...(typeof parsed?.outcome === "string" ? { outcome: parsed.outcome as string } : {}),
    };
  }
  return { ok: true, attempt: parsed as FailureAnalysisAttempt };
}

export type FailureAnalysisListResult = { ok: true; analyses: FailureAnalysis[] } | ErrorResult;

export async function listFailureAnalyses(collectionId: string, runId: string): Promise<FailureAnalysisListResult> {
  try {
    const response = await fetch(`/api/external-collections/${collectionId}/execution/runs/${runId}/failure-analyses`);
    const parsed = await response.json().catch(() => null);
    if (!response.ok) return parseError(parsed, response.status, "listFailureAnalyses");
    return { ok: true, analyses: (parsed?.analyses ?? []) as FailureAnalysis[] };
  } catch (err) {
    logger.error("network_error", { operation: "listFailureAnalyses", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
}

export type FailureAnalysisInProgressResult = { ok: true; inProgress: FailureAnalysisInProgress | null } | ErrorResult;

/** `204` means nothing is in progress in this session. */
export async function getFailureAnalysisInProgress(): Promise<FailureAnalysisInProgressResult> {
  try {
    const response = await fetch("/api/failure-analysis/in-progress");
    if (response.status === 204) return { ok: true, inProgress: null };
    const parsed = await response.json().catch(() => null);
    if (!response.ok) return parseError(parsed, response.status, "getFailureAnalysisInProgress");
    return { ok: true, inProgress: (parsed?.inProgress ?? null) as FailureAnalysisInProgress | null };
  } catch (err) {
    logger.error("network_error", { operation: "getFailureAnalysisInProgress", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
}

/** One client for every endpoint in contracts/collection-editor-api.md (AP-028). */

export type CollectionViewResult = { ok: true; collectionView: CollectionView } | ErrorResult;

async function getCollectionView(response: Response, operation: string): Promise<CollectionViewResult> {
  const parsed = await response.json().catch(() => null);
  if (!response.ok) return parseError(parsed, response.status, operation);
  return { ok: true, collectionView: parsed.collectionView as CollectionView };
}

export async function fetchUploadedCollectionView(id: string): Promise<CollectionViewResult> {
  try {
    const response = await fetch(`/api/external-collections/${id}/collection`);
    return await getCollectionView(response, "fetchUploadedCollectionView");
  } catch (err) {
    logger.error("network_error", { operation: "fetchUploadedCollectionView", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
}

async function putJson(path: string, operation: string, body: unknown): Promise<CollectionViewResult> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    logger.error("network_error", { operation, errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
  return getCollectionView(response, operation);
}

/** FR-004/FR-005/FR-009/FR-018 — replaces the collection's variable values wholesale. */
export async function updateUploadedCollectionVariables(
  id: string,
  variableValues: Record<string, string>,
): Promise<CollectionViewResult> {
  return putJson(`/api/external-collections/${id}/variables`, "updateUploadedCollectionVariables", {
    variableValues,
  });
}

export interface RequestEdit {
  method: string;
  url: string;
  headers: Array<{ key: string; value: string }>;
  body?: string;
  /** Omitting leaves the request's existing test script untouched; an empty string clears it. */
  testScript?: string;
}

/** FR-007/FR-009a — edits an existing request's method/URL/headers/body. */
export async function updateUploadedCollectionRequest(
  id: string,
  requestId: string,
  edit: RequestEdit,
): Promise<CollectionViewResult> {
  return putJson(`/api/external-collections/${id}/requests/${requestId}`, "updateUploadedCollectionRequest", edit);
}

export type AddCollectionRequestResult = { ok: true; collectionView: CollectionView; newItemId: string } | ErrorResult;

/** FR-013 — adds a new request to a chosen folder (or the collection root, `parentFolderId: null`). */
export async function addUploadedCollectionRequest(
  id: string,
  input: { parentFolderId: string | null; name: string } & RequestEdit,
): Promise<AddCollectionRequestResult> {
  let response: Response;
  try {
    response = await fetch(`/api/external-collections/${id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (err) {
    logger.error("network_error", { operation: "addUploadedCollectionRequest", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) return parseError(parsed, response.status, "addUploadedCollectionRequest");
  return { ok: true, collectionView: parsed.collectionView as CollectionView, newItemId: parsed.newItemId as string };
}

/** Adds a new, empty folder to a chosen folder (or the collection root, `parentFolderId: null`) —
 * same endpoint as `addUploadedCollectionRequest`, distinguished by `kind: "folder"`. */
export async function addUploadedCollectionFolder(
  id: string,
  input: { parentFolderId: string | null; name: string },
): Promise<AddCollectionRequestResult> {
  let response: Response;
  try {
    response = await fetch(`/api/external-collections/${id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, kind: "folder" }),
    });
  } catch (err) {
    logger.error("network_error", { operation: "addUploadedCollectionFolder", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) return parseError(parsed, response.status, "addUploadedCollectionFolder");
  return { ok: true, collectionView: parsed.collectionView as CollectionView, newItemId: parsed.newItemId as string };
}

/** FR-014 — deletes an existing request or folder (and everything nested within it). */
export async function deleteUploadedCollectionItem(id: string, itemId: string): Promise<CollectionViewResult> {
  let response: Response;
  try {
    response = await fetch(`/api/external-collections/${id}/items/${itemId}`, { method: "DELETE" });
  } catch (err) {
    logger.error("network_error", { operation: "deleteUploadedCollectionItem", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
  return getCollectionView(response, "deleteUploadedCollectionItem");
}

/** FR-016 — renames an existing request or folder. */
export async function renameUploadedCollectionItem(
  id: string,
  itemId: string,
  name: string,
): Promise<CollectionViewResult> {
  return putJson(`/api/external-collections/${id}/items/${itemId}/rename`, "renameUploadedCollectionItem", {
    name,
  });
}

/** FR-015 — reorders a container's ("root" or a folder id) direct children to match `orderedIds`. */
export async function reorderUploadedCollectionContainer(
  id: string,
  containerId: string,
  orderedIds: string[],
): Promise<CollectionViewResult> {
  return putJson(
    `/api/external-collections/${id}/containers/${containerId}/order`,
    "reorderUploadedCollectionContainer",
    { orderedIds },
  );
}
