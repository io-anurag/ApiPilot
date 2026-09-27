import type { LatencyPercentiles, PerformanceResult, PerformanceThreshold, ThresholdOutcome } from "@apipilot/shared-domain";

/**
 * Evaluates the user's thresholds from the aggregate after the run (FR-018, FR-037; research D15).
 * They are never written as k6 thresholds, so they never abort a run, and the verdict is computed
 * from the same numbers the report shows. A threshold with nothing measured is not passed.
 */
function measure(threshold: PerformanceThreshold, result: PerformanceResult): number | null {
  const source =
    threshold.scope.kind === "run"
      ? { latency: result.totals.latencyMs, errorRate: result.totals.requests > 0 ? result.totals.errorRatePercent : null }
      : (() => {
          const stepId = threshold.scope.stepId;
          const step = result.steps.find((candidate) => candidate.stepId === stepId);
          return { latency: step?.latencyMs ?? null, errorRate: step && step.requests > 0 ? step.errorRatePercent : null };
        })();
  if (threshold.metric === "error-rate") return source.errorRate;
  return source.latency ? source.latency[threshold.metric as keyof LatencyPercentiles] : null;
}

export function evaluateThresholds(thresholds: readonly PerformanceThreshold[], result: PerformanceResult): ThresholdOutcome[] {
  return thresholds.map((threshold) => {
    const measured = measure(threshold, result);
    return { thresholdId: threshold.id, measured, passed: measured !== null && measured <= threshold.limit };
  });
}
