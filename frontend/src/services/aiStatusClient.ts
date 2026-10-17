import type { AIProviderMode, ReadinessState } from "@apipilot/shared-domain";
import { createLogger } from "../logger";

const logger = createLogger("aiStatusClient");

/**
 * What the interface may show of the AI provider (AP-054 Home): its live readiness state, which
 * provider is configured and, when it is unavailable, why. The endpoint also reports a model
 * identifier, accelerator flags, a last-known readiness and benchmark data; none of that is read
 * here, so none of it can reach the screen.
 */
export interface AiStatus {
  readonly state: ReadinessState["state"];
  readonly provider: AIProviderMode;
  readonly reason: string | null;
}

export type AiStatusResult = { ok: true; status: AiStatus } | { ok: false; message: string };

const STATES: readonly ReadinessState["state"][] = ["not-loaded", "loading", "ready", "unavailable"];
const PROVIDERS: readonly AIProviderMode[] = ["local", "mock"];

/** `GET /api/ai/status` (existing endpoint, unchanged). Never throws. */
export async function fetchAiStatus(signal?: AbortSignal): Promise<AiStatusResult> {
  try {
    const response = await fetch("/api/ai/status", { signal });
    if (!response.ok) {
      logger.error("request_failed", { operation: "fetchAiStatus", errorCategory: "non_2xx_response", statusCode: response.status });
      return { ok: false, message: `Request failed with status ${response.status}` };
    }
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const state = STATES.find((candidate) => candidate === body?.state);
    const provider = PROVIDERS.find((candidate) => candidate === body?.provider);
    if (state === undefined || provider === undefined) {
      logger.error("request_failed", { operation: "fetchAiStatus", errorCategory: "unexpected_payload" });
      return { ok: false, message: "The AI status response was not understood." };
    }
    return { ok: true, status: { state, provider, reason: typeof body?.reason === "string" && body.reason !== "" ? body.reason : null } };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return { ok: false, message: "Cancelled." };
    logger.error("network_error", { operation: "fetchAiStatus", errorCategory: "network_error" });
    return { ok: false, message: err instanceof Error ? err.message : "Request failed" };
  }
}
