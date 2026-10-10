import type { CoverageFilter, CoverageSnapshot } from "@apipilot/shared-domain";
import { createLogger } from "../logger";

/**
 * AP-046 coverage client (specs/046-api-test-coverage-intelligence/contracts/coverage-routes.md).
 * Read-only. Failures are returned as a typed result and never thrown, and the caller can tell a
 * missing specification (`no_active_workflow`) from a real failure, so an error is never shown as
 * empty coverage (FR-039).
 */

const logger = createLogger("coverageClient");

export interface CoverageQueryParams extends CoverageFilter {
  runId?: string;
}

export type CoverageResult =
  | { ok: true; snapshot: CoverageSnapshot }
  | { ok: false; error: string; message: string };

/** Serializes a filter into the route's query string, omitting every unset value. */
export function coverageQueryString(query: CoverageQueryParams, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const method of query.methods ?? []) params.append("method", method);
  if (query.q?.trim()) params.set("q", query.q.trim());
  for (const state of query.states ?? []) params.append("state", state);
  if (query.category) params.set("category", query.category);
  for (const priority of query.priorities ?? []) params.append("priority", priority);
  if (query.gapKind) params.set("gapKind", query.gapKind);
  if (query.sort) params.set("sort", query.sort);
  if (query.order) params.set("order", query.order);
  if (query.runId) params.set("runId", query.runId);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export async function fetchCoverage(query: CoverageQueryParams, signal?: AbortSignal): Promise<CoverageResult> {
  let response: Response;
  try {
    response = await fetch(`/api/coverage${coverageQueryString(query)}`, { cache: "no-store", signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    logger.error("request_failed", { operation: "fetchCoverage", errorCategory: "network_error" });
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "The coverage service is unreachable." };
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const error = typeof body?.error === "string" ? body.error : "unknown_error";
    logger.error("request_failed", { operation: "fetchCoverage", errorCategory: error, statusCode: response.status });
    return {
      ok: false,
      error,
      message: typeof body?.message === "string" ? body.message : `Request failed with status ${response.status}`,
    };
  }
  if (!isSnapshot(body)) {
    logger.error("request_failed", { operation: "fetchCoverage", errorCategory: "invalid_response" });
    return { ok: false, error: "invalid_response", message: "The coverage reply was not understood." };
  }
  return { ok: true, snapshot: body };
}

/** The boundary check: only the fields the view indexes into are verified. */
function isSnapshot(body: Record<string, unknown> | null): body is Record<string, unknown> & CoverageSnapshot {
  return (
    body !== null &&
    Array.isArray(body.metrics) &&
    Array.isArray(body.operations) &&
    Array.isArray(body.requirements) &&
    Array.isArray(body.gaps) &&
    Array.isArray(body.scenarios) &&
    Array.isArray(body.categoryCoverage) &&
    typeof body.operationCounts === "object" &&
    body.operationCounts !== null &&
    typeof body.specification === "object" &&
    body.specification !== null &&
    typeof body.execution === "object" &&
    body.execution !== null &&
    typeof body.totals === "object" &&
    body.totals !== null
  );
}

/** The download address of an export; the server answers with `Content-Disposition: attachment`. */
export function coverageExportUrl(query: CoverageQueryParams, format: "html" | "json", scope: "filtered" | "all"): string {
  return `/api/coverage/export${coverageQueryString(query, { format, scope })}`;
}
