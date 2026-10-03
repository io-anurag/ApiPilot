import type { PerformanceRunSummary } from "@apipilot/shared-domain";
import { fetchReportFrom, request, type PerformanceRunsClient, type Result } from "./performanceTestingClient";

/**
 * Runs recorded from the plans retired by AP-037 phase two (specs/037-request-chain-performance
 * FR-037): the guided, quick and collection plans. Their runs stay listable and reportable under
 * their old bases, read only; nothing here starts, repeats or restores a run.
 */
export type LegacySource = "guided" | "quick" | "collection";

export const LEGACY_SOURCES: readonly { source: LegacySource; label: string; base: string }[] = [
  { source: "guided", label: "Guided workflow", base: "/api/test-generation-workflow/performance" },
  { source: "quick", label: "Quick performance test", base: "/api/quick-performance" },
  { source: "collection", label: "Collection performance test", base: "/api/collection-performance" },
];

export type LegacyRunSummary = PerformanceRunSummary & { source: LegacySource };

/** Every legacy run of the session, newest first. */
export async function fetchLegacyRuns(): Promise<Result<{ runs: LegacyRunSummary[] }>> {
  const results = await Promise.all(
    LEGACY_SOURCES.map(({ source, base }) =>
      request("fetchLegacyRuns", `${base}/runs`, undefined, (body) => ({ runs: ((body.runs ?? []) as PerformanceRunSummary[]).map((run) => ({ ...run, source })) })),
    ),
  );
  const failed = results.find((result) => !result.ok);
  if (failed && !failed.ok) return failed;
  const runs = results.flatMap((result) => (result.ok ? result.runs : []));
  return { ok: true, runs: runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0)) };
}

/** The report of one legacy run, for `PerformanceReportFrame`. */
export function legacyReportClient(source: LegacySource): Pick<PerformanceRunsClient, "fetchReport" | "reportDownloadUrl"> {
  const base = LEGACY_SOURCES.find((entry) => entry.source === source)!.base;
  return {
    fetchReport: (runId) => fetchReportFrom(base, runId),
    reportDownloadUrl: (runId) => `${base}/runs/${encodeURIComponent(runId)}/report?download=true`,
  };
}
