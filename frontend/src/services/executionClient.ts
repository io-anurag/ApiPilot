import type {
  Environment,
  EnvironmentTier,
  ExecutionConfirmationRequirement,
  ExecutionRun,
} from "@apipilot/shared-domain";
import { createLogger } from "../logger";

/** One client for every endpoint in contracts/execution-api.md (AP-017). */

const logger = createLogger("executionClient");

export interface ErrorResult {
  ok: false;
  error: string;
  message: string;
  /** Present only for `400 missing_variable_values`. */
  missing?: string[];
  /** Present only for `409 confirmation_required`. */
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
            destructiveOperations: (parsed.destructiveOperations ?? []) as ExecutionConfirmationRequirement["destructiveOperations"],
          },
        }
      : {}),
    ...(typeof parsed?.runId === "string" ? { runId: parsed.runId as string } : {}),
  };
  logger.error("request_failed", {
    operation,
    errorCategory: result.error,
    statusCode: response.status,
  });
  return result;
}

async function postJson(
  path: string,
  operation: string,
  body?: unknown,
): Promise<Response | { networkError: string }> {
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

export type EnvironmentInput = {
  name: string;
  tier: EnvironmentTier;
  baseUrl: string;
  variableValues: Record<string, string>;
  requestDelayMs: number;
};

export type EnvironmentResult = { ok: true; environment: Environment } | ErrorResult;
export type EnvironmentListResult = { ok: true; environments: Environment[] } | ErrorResult;

export async function fetchEnvironments(): Promise<EnvironmentListResult> {
  try {
    const response = await fetch("/api/test-generation-workflow/environments");
    const parsed = await response.json().catch(() => null);
    if (!response.ok) return parseError(response, "fetchEnvironments");
    return { ok: true, environments: (parsed?.environments ?? []) as Environment[] };
  } catch (err) {
    logger.error("network_error", { operation: "fetchEnvironments", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
}

export async function createEnvironment(input: EnvironmentInput): Promise<EnvironmentResult> {
  const response = await postJson("/api/test-generation-workflow/environments", "createEnvironment", input);
  if ("networkError" in response) {
    return { ok: false, error: "network_error", message: response.networkError };
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) return parseError(response, "createEnvironment");
  return { ok: true, environment: parsed.environment as Environment };
}

export async function updateEnvironment(
  environmentId: string,
  input: EnvironmentInput,
): Promise<EnvironmentResult> {
  const response = await fetch(`/api/test-generation-workflow/environments/${environmentId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).catch((err) => {
    logger.error("network_error", { operation: "updateEnvironment", errorCategory: "network_error" });
    return { networkError: err instanceof Error ? err.message : "Request failed" } as const;
  });
  if ("networkError" in response) {
    return { ok: false, error: "network_error", message: response.networkError };
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) return parseError(response, "updateEnvironment");
  return { ok: true, environment: parsed.environment as Environment };
}

export type RunResult = { ok: true; run: ExecutionRun } | ErrorResult;

/**
 * Starts a new execution run (FR-006). Returns as soon as the run is registered — it does not
 * wait for the run to finish (research.md D4); poll `fetchRun` for progress and the eventual
 * terminal state.
 */
export async function startExecution(environmentId: string, confirmed = false): Promise<RunResult> {
  const response = await postJson("/api/test-generation-workflow/execution/start", "startExecution", {
    environmentId,
    confirmed,
  });
  if ("networkError" in response) {
    return { ok: false, error: "network_error", message: response.networkError };
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) return parseError(response, "startExecution");
  return { ok: true, run: parsed.run as ExecutionRun };
}

/** Cancels the session's in-progress run (FR-015). Resolves once accepted (202), not once settled. */
export async function cancelExecution(): Promise<RunResult> {
  const response = await postJson("/api/test-generation-workflow/execution/cancel", "cancelExecution");
  if ("networkError" in response) {
    return { ok: false, error: "network_error", message: response.networkError };
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) return parseError(response, "cancelExecution");
  return { ok: true, run: parsed.run as ExecutionRun };
}

export async function fetchRun(runId: string): Promise<RunResult> {
  try {
    const response = await fetch(`/api/test-generation-workflow/execution/runs/${runId}`);
    const parsed = await response.json().catch(() => null);
    if (!response.ok) return parseError(response, "fetchRun");
    return { ok: true, run: parsed.run as ExecutionRun };
  } catch (err) {
    logger.error("network_error", { operation: "fetchRun", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
}

export type RunSummaryListResult =
  | { ok: true; runs: Omit<ExecutionRun, "results">[] }
  | ErrorResult;

export async function fetchRuns(): Promise<RunSummaryListResult> {
  try {
    const response = await fetch("/api/test-generation-workflow/execution/runs");
    const parsed = await response.json().catch(() => null);
    if (!response.ok) return parseError(response, "fetchRuns");
    return { ok: true, runs: (parsed?.runs ?? []) as Omit<ExecutionRun, "results">[] };
  } catch (err) {
    logger.error("network_error", { operation: "fetchRuns", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed" };
  }
}
