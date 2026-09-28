import type { Environment, EnvironmentTier } from "@apipilot/shared-domain";
import { createLogger } from "../logger";

/**
 * The session's environments (AP-017 contracts/execution-api.md), shared by the guided workflow's
 * performance stage and AP-032's quick performance test, which keep their user-supplied values in
 * environments (AP-029 FR-013, AP-032 FR-017). The routes open once Postman generation is complete
 * or the session has a quick performance test (AP-032 FR-016 to FR-018).
 */

const logger = createLogger("environmentsClient");
const BASE = "/api/test-generation-workflow/environments";

export interface EnvironmentInput {
  name: string;
  tier: EnvironmentTier;
  baseUrl: string;
  variableValues: Record<string, string>;
  requestDelayMs: number;
}

export type EnvironmentErrorResult = { ok: false; error: string; message: string };
export type EnvironmentResult = { ok: true; environment: Environment } | EnvironmentErrorResult;
export type EnvironmentListResult = { ok: true; environments: Environment[] } | EnvironmentErrorResult;

async function send(operation: string, path: string, init?: RequestInit): Promise<{ ok: true; body: Record<string, unknown> } | EnvironmentErrorResult> {
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
    return { ok: false, error, message: typeof parsed?.message === "string" ? parsed.message : `Request failed with status ${response.status}` };
  }
  return { ok: true, body: parsed ?? {} };
}

export async function fetchEnvironments(): Promise<EnvironmentListResult> {
  const result = await send("fetchEnvironments", BASE);
  return result.ok ? { ok: true, environments: (result.body.environments ?? []) as Environment[] } : result;
}

export async function createEnvironment(input: EnvironmentInput): Promise<EnvironmentResult> {
  const result = await send("createEnvironment", BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return result.ok ? { ok: true, environment: result.body.environment as Environment } : result;
}

export async function updateEnvironment(environmentId: string, input: EnvironmentInput): Promise<EnvironmentResult> {
  const result = await send("updateEnvironment", `${BASE}/${encodeURIComponent(environmentId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return result.ok ? { ok: true, environment: result.body.environment as Environment } : result;
}
