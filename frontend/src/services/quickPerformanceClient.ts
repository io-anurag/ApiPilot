import type { QuickPerformanceTestView } from "@apipilot/shared-domain";
import { createLogger } from "../logger";
import type { Result } from "./performanceTestingClient";

/**
 * AP-032 quick performance test (specs/032-quick-performance-test contracts/quick-performance-api.md):
 * the upload and read of the session's quick test, a seeding source for request-chain plans since
 * AP-037 phase two.
 */
const logger = createLogger("quickPerformanceClient");
const BASE = "/api/quick-performance";

async function send(operation: string, path: string, init?: RequestInit): Promise<Result<{ quickTest: QuickPerformanceTestView | null }>> {
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
    if (error === "quick_test_not_found" && operation === "fetchQuickTest") return { ok: true, quickTest: null };
    logger.error("request_failed", { operation, errorCategory: error, statusCode: response.status });
    return { ok: false, error, message: typeof parsed?.message === "string" ? parsed.message : `Request failed with status ${response.status}` };
  }
  return { ok: true, quickTest: (parsed?.quickTest as QuickPerformanceTestView | undefined) ?? null };
}

/** Uploads a specification; `409 quick_test_exists` unless `replaceExisting` (FR-021). */
export function uploadQuickTest(file: File, replaceExisting = false): Promise<Result<{ quickTest: QuickPerformanceTestView | null }>> {
  const formData = new FormData();
  formData.append("file", file);
  return send("uploadQuickTest", replaceExisting ? `${BASE}?replaceExisting=true` : BASE, { method: "POST", body: formData });
}

/** The session's quick test, or `null` when there is none. */
export function fetchQuickTest(): Promise<Result<{ quickTest: QuickPerformanceTestView | null }>> {
  return send("fetchQuickTest", BASE);
}
