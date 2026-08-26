import type { HealthStatus } from "@apipilot/shared-domain";

export type HealthCheckResult =
  | { ok: true; data: HealthStatus }
  | { ok: false; error: string };

export async function fetchHealth(): Promise<HealthCheckResult> {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) {
      return { ok: false, error: `Backend returned status ${response.status}` };
    }
    const data = (await response.json()) as HealthStatus;
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Backend is unreachable",
    };
  }
}
