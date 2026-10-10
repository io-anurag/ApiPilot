import type { LiveRunKind, LiveRunSnapshot } from "@apipilot/shared-domain";

/**
 * AP-045 live run dashboard (specs/045-live-run-dashboard/contracts/live-run-routes.md). One read-only
 * helper over the three run kinds' `…/live` routes. Failures are returned as a typed result and never
 * thrown; `retryable` tells the poller whether the next poll may succeed (a lost connection or a
 * server fault) or not (an unknown run, a refused query).
 */

export interface LiveRunIds {
  runId: string;
  /** Required for `collection`. */
  collectionId?: string;
}

export interface LiveRunCursor {
  /** `nextSince` of the last reply; 0 on a fresh mount. */
  since: number;
  /** The `bucketSeconds` the client holds, so a thinning change returns the whole series. */
  bucket?: number;
}

export type LiveRunResult =
  | { ok: true; snapshot: LiveRunSnapshot }
  | { ok: false; error: string; message: string; retryable: boolean };

function liveRunPath(kind: LiveRunKind, ids: LiveRunIds): string | null {
  const runId = encodeURIComponent(ids.runId);
  switch (kind) {
    case "chain":
      return `/api/chain-plans/runs/${runId}/live`;
    case "user-script":
      return `/api/user-scripts/runs/${runId}/live`;
    case "collection":
      return ids.collectionId ? `/api/external-collections/${encodeURIComponent(ids.collectionId)}/execution/runs/${runId}/live` : null;
  }
}

export async function fetchLiveRun(kind: LiveRunKind, ids: LiveRunIds, cursor: LiveRunCursor): Promise<LiveRunResult> {
  const path = liveRunPath(kind, ids);
  if (!path) return { ok: false, error: "invalid_request", message: "A collection run needs its collection id.", retryable: false };
  const query = new URLSearchParams({ since: String(Math.max(0, Math.trunc(cursor.since))) });
  if (cursor.bucket !== undefined) query.set("bucket", String(cursor.bucket));

  let response: Response;
  try {
    response = await fetch(`${path}?${query.toString()}`, { cache: "no-store" });
  } catch (err) {
    return { ok: false, error: "network_error", message: err instanceof Error ? err.message : "Request failed", retryable: true };
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    return {
      ok: false,
      error: typeof body?.error === "string" ? body.error : "unknown_error",
      message: typeof body?.message === "string" ? body.message : `Request failed with status ${response.status}`,
      retryable: response.status >= 500,
    };
  }
  if (!isSnapshot(body)) {
    return { ok: false, error: "invalid_response", message: "The live figures reply was not understood.", retryable: true };
  }
  return { ok: true, snapshot: body };
}

/** The boundary check: only the fields the dashboard indexes into are verified. */
function isSnapshot(body: Record<string, unknown> | null): body is Record<string, unknown> & LiveRunSnapshot {
  if (!body) return false;
  const series = body.series as { points?: unknown; bucketSeconds?: unknown } | undefined;
  const totals = body.totals as { requests?: unknown } | undefined;
  return (
    typeof body.runId === "string" &&
    typeof body.state === "string" &&
    typeof body.nextSince === "number" &&
    typeof totals?.requests === "number" &&
    Array.isArray(series?.points) &&
    typeof series?.bucketSeconds === "number" &&
    Array.isArray(body.recent) &&
    Array.isArray(body.chains)
  );
}
