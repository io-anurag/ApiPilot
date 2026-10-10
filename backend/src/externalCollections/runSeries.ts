import type { UploadedRequestResult } from "@apipilot/shared-domain";
import { createLiveSeries, type LiveSeriesView } from "../performance/live/liveSeries";

/**
 * The per-second series of an Import & Run Collection run (AP-045 research R7, R11): requests and
 * failures per second against elapsed time, with no virtual users (the executor is sequential). A
 * pure function of the stored results, so the live dashboard, the HTML report and the PDF report
 * draw the same figures, and a run from before this feature has them too. A request counts in the
 * second it finished (its start plus its duration). A request that was not attempted was never
 * sent and is not counted. The result does not depend on the order of `results`.
 */

export function resultSecond(result: Pick<UploadedRequestResult, "startedAt" | "durationMs">, runStartMs: number): number {
  const finishedMs = Date.parse(result.startedAt) + Math.max(0, result.durationMs);
  return Number.isFinite(finishedMs) ? Math.max(0, Math.floor((finishedMs - runStartMs) / 1000)) : 0;
}

export function runSeries(results: readonly UploadedRequestResult[], runStartMs: number, elapsedMs: number): LiveSeriesView {
  const series = createLiveSeries({ withVirtualUsers: false });
  for (const result of results) {
    if (result.outcome === "not-attempted") continue;
    const second = resultSecond(result, runStartMs);
    series.recordRequest(second);
    if (result.responseStatusCode !== undefined || result.durationMs > 0) series.recordLatency(second, result.durationMs);
    if (result.outcome === "failed") series.recordFailure(second);
  }
  return series.view(Math.floor(Math.max(0, elapsedMs) / 1000));
}
