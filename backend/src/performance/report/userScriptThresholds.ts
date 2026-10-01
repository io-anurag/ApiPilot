import type { RequestGroupMetrics, UserScriptResult, UserScriptThreshold } from "@apipilot/shared-domain";
import { OTHER_REQUESTS } from "./userScriptAggregate";

/**
 * ApiPilot's thresholds for a user script's run, evaluated from the measurements and never written
 * into the script (specs/034-run-user-k6-script FR-018, FR-028, FR-035; research R15). A threshold
 * with nothing measured is not passed, as in AP-029.
 */
function metricsFor(threshold: UserScriptThreshold, result: UserScriptResult): RequestGroupMetrics | null {
  if (threshold.scope.kind === "run") return result.totals;
  const { name } = threshold.scope;
  const group = result.requestGroups.find((candidate) => candidate.displayName === name);
  if (group) return group;
  return name === OTHER_REQUESTS ? result.otherRequests : null;
}

function measure(threshold: UserScriptThreshold, result: UserScriptResult): number | null {
  const metrics = metricsFor(threshold, result);
  if (!metrics || metrics.requests === 0) return null;
  if (threshold.metric === "error-rate") return metrics.failureRatePercent;
  return metrics.latencyMs ? metrics.latencyMs[threshold.metric] : null;
}

export function evaluateUserScriptThresholds(thresholds: readonly UserScriptThreshold[], result: UserScriptResult): UserScriptResult["apiPilotThresholds"] {
  return thresholds.map((threshold) => {
    const measured = measure(threshold, result);
    return { thresholdId: threshold.id, measured, passed: measured !== null && measured <= threshold.limit };
  });
}

/** k6's own verdict on the thresholds the script defines: exit code 99 means at least one was crossed. */
export function scriptThresholdsOutcome(exitCode: number | null, result: UserScriptResult): UserScriptResult["scriptThresholdsOutcome"] {
  if (result.scriptThresholds.length === 0) return "none-defined";
  if (exitCode === null) return "not-evaluated";
  return exitCode === 99 ? "crossed" : "not-crossed";
}
