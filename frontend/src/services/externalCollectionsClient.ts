import type {
  EnvironmentTier,
  ExecutionConfirmationRequirement,
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
  /** Present only for `400 missing_variable_values`. */
  missing?: string[];
  /** Present only for `409 confirmation_required` (gate 2, FR-013). */
  confirmation?: ExecutionConfirmationRequirement;
  /** Present only for `409 execution_in_progress`. */
  runId?: string;
}

async function parseError(response: Response, operation: string): Promise<ErrorResult> {
  const parsed = await response.json().catch(() => null);
  const result: ErrorResult = {
    ok: false,
    error: (parsed?.error as string) ?? "unknown_error",
    message: (parsed?.message as string) ?? `Request failed with status ${response.status}`,
    ...(Array.isArray(parsed?.missing) ? { missing: parsed.missing as string[] } : {}),
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
  logger.error("request_failed", { operation, errorCategory: result.error, statusCode: response.status });
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
    if (!response.ok) return parseError(response, "fetchUploadedCollections");
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
  if (!response.ok) return parseError(response, "createUploadedCollection");
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
  if (!response.ok) return parseError(response, "removeUploadedCollection");
  return { ok: true };
}

export type UploadedRunResult = { ok: true; run: UploadedCollectionExecutionRun } | ErrorResult;

/** Starts a run (FR-005). Two independent confirmation gates apply — see contracts/external-collections-api.md. */
export async function startUploadedCollectionExecution(
  id: string,
  confirmed = false,
): Promise<UploadedRunResult> {
  const response = await postJson(
    `/api/external-collections/${id}/execution/start`,
    "startUploadedCollectionExecution",
    { confirmed },
  );
  if ("networkError" in response) {
    return { ok: false, error: "network_error", message: response.networkError };
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) return parseError(response, "startUploadedCollectionExecution");
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
  if (!response.ok) return parseError(response, "cancelUploadedCollectionExecution");
  return { ok: true, run: parsed.run as UploadedCollectionExecutionRun };
}

export async function fetchUploadedCollectionRun(id: string, runId: string): Promise<UploadedRunResult> {
  try {
    const response = await fetch(`/api/external-collections/${id}/execution/runs/${runId}`);
    const parsed = await response.json().catch(() => null);
    if (!response.ok) return parseError(response, "fetchUploadedCollectionRun");
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
    if (!response.ok) return parseError(response, "fetchUploadedCollectionRuns");
    return { ok: true, runs: (parsed?.runs ?? []) as Omit<UploadedCollectionExecutionRun, "results">[] };
  } catch (err) {
    logger.error("network_error", { operation: "fetchUploadedCollectionRuns", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
}
