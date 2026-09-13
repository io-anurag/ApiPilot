import type { HealthStatus } from "@apipilot/shared-domain";
import { createLogger } from "../logger";

const logger = createLogger("healthClient");

export type HealthCheckResult =
  | { ok: true; data: HealthStatus }
  | { ok: false; error: string };

export async function fetchHealth(): Promise<HealthCheckResult> {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) {
      logger.error("request_failed", {
        operation: "fetchHealth",
        errorCategory: "non_2xx_response",
        statusCode: response.status,
      });
      return { ok: false, error: `Backend returned status ${response.status}` };
    }
    const data = (await response.json()) as HealthStatus;
    return { ok: true, data };
  } catch (err) {
    logger.error("network_error", { operation: "fetchHealth", errorCategory: "network_error" });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Backend is unreachable",
    };
  }
}
