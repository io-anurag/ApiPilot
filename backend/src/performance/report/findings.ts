import type { PerformanceFinding, PerformancePlan, PerformanceResult, PerformanceThreshold } from "@apipilot/shared-domain";
import { isRunLayout, type RunLayout } from "./runLayout";

/**
 * Plain-language findings from fixed rules over the measured data (FR-038; research D16, ruleset
 * version 1). Each rule is pure, rules run in a fixed order, ties are broken by step order, and a
 * rule that does not apply produces nothing. No rule claims anything about the API's quality
 * beyond the measurement. Messages are fixed text built from `values`, so the same data always
 * gives the same findings (SC-011).
 */
function clock(offsetMs: number): string {
  const totalSeconds = Math.floor(offsetMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function describeThreshold(threshold: PerformanceThreshold, operationKeyOf: (stepId: string) => string): { label: string; unit: string } {
  const where = threshold.scope.kind === "run" ? "Run" : operationKeyOf(threshold.scope.stepId);
  if (threshold.metric === "error-rate") return { label: `${where} failure rate`, unit: "%" };
  return { label: `${where} ${threshold.metric} latency`, unit: " ms" };
}

/** AP-037 (research R19): a legacy plan, or a run layout whose step labels name each step. */
export function deriveFindings(result: PerformanceResult, plan: PerformancePlan | RunLayout): PerformanceFinding[] {
  const findings: PerformanceFinding[] = [];
  const stepOrder = isRunLayout(plan)
    ? plan.journeys.flatMap((journey) => journey.steps.map((step) => step.stepId))
    : plan.journeys.flatMap((journey) => journey.steps.map((step) => step.id));
  const labels = isRunLayout(plan) ? plan.stepLabels : undefined;
  const operationKeyOf = (stepId: string) => labels?.[stepId] ?? result.steps.find((step) => step.stepId === stepId)?.operationKey ?? stepId;
  const inStepOrder = <T extends { stepId: string }>(items: T[]) =>
    [...items].sort((a, b) => stepOrder.indexOf(a.stepId) - stepOrder.indexOf(b.stepId));
  const categoryCount = (category: string) =>
    result.steps.reduce((sum, step) => sum + (step.errorsByCategory.find((entry) => entry.category === category)?.count ?? 0), 0);

  // 1. threshold-failed
  for (const outcome of result.thresholdOutcomes) {
    if (outcome.passed) continue;
    const threshold = plan.thresholds.find((candidate) => candidate.id === outcome.thresholdId);
    if (!threshold) continue;
    const { label, unit } = describeThreshold(threshold, operationKeyOf);
    findings.push({
      ruleId: "threshold-failed",
      stepIds: threshold.scope.kind === "step" ? [threshold.scope.stepId] : [],
      message:
        outcome.measured === null
          ? `${label} was not measured, so your ${threshold.limit}${unit} threshold is not met.`
          : `${label} is ${outcome.measured}${unit}, above your ${threshold.limit}${unit} threshold.`,
      values: { thresholdId: threshold.id, limit: threshold.limit, ...(outcome.measured === null ? {} : { measured: outcome.measured }) },
    });
  }

  // 2. slowest-step
  const measured = inStepOrder(result.steps.filter((step) => step.latencyMs !== null));
  const slowest = measured.reduce<(typeof measured)[number] | undefined>(
    (best, step) => (!best || step.latencyMs!.p95 > best.latencyMs!.p95 ? step : best),
    undefined,
  );
  if (slowest) {
    findings.push({
      ruleId: "slowest-step",
      stepIds: [slowest.stepId],
      message: `${operationKeyOf(slowest.stepId)} has the highest p95 latency: ${slowest.latencyMs!.p95} ms.`,
      values: { p95Ms: slowest.latencyMs!.p95 },
    });
  }

  // 3. failures-start
  if (result.firstFailure) {
    const { offsetMs, stepId } = result.firstFailure;
    findings.push({
      ruleId: "failures-start",
      stepIds: [stepId],
      message: `The first failures are in the ${clock(offsetMs)} bucket, mostly on ${operationKeyOf(stepId)}.`,
      values: { offsetMs },
    });
  }

  // 4. cut-short-journeys
  for (const journey of result.journeys) {
    if (journey.runsCutShort === 0) continue;
    const at = journey.cutShortAtStepId;
    // AP-035 FR-029 (ruleset 2): the capture that cut the most runs short, ties by name. A run
    // recorded before AP-035 names no capture and keeps the message it had.
    const capture = Object.entries(journey.cutShortByCapture ?? {}).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0]?.[0];
    findings.push({
      ruleId: "cut-short-journeys",
      stepIds: at ? [at] : [],
      message:
        capture === undefined
          ? `${journey.runsCutShort} runs of a journey stopped early because ${at ? operationKeyOf(at) : "a step"} returned no value to pass on.`
          : `${journey.runsCutShort} runs of a journey stopped early because ${at ? operationKeyOf(at) : "a step"} returned no value for ${capture} to pass on.`,
      values: { journeyId: journey.journeyId, runsCutShort: journey.runsCutShort, ...(capture === undefined ? {} : { capture }) },
    });
  }

  // 5. missing-data
  for (const step of inStepOrder(result.steps.filter((candidate) => candidate.notAttempted.missingData > 0))) {
    findings.push({
      ruleId: "missing-data",
      stepIds: [step.stepId],
      message: `${operationKeyOf(step.stepId)} was not sent ${step.notAttempted.missingData} times: ${step.missingVariables.join(", ")} missing in the environment.`,
      values: { count: step.notAttempted.missingData, variables: step.missingVariables.join(",") },
    });
  }

  // 6. rate-limited
  const rateLimited = categoryCount("rate-limited");
  if (rateLimited > 0) {
    const firstOffset = result.firstRateLimitedOffsetMs ?? 0;
    findings.push({
      ruleId: "rate-limited",
      stepIds: inStepOrder(result.steps.filter((step) => step.errorsByCategory.some((entry) => entry.category === "rate-limited"))).map((step) => step.stepId),
      message: `The target rate-limited ${rateLimited} requests (429), first in the ${clock(firstOffset)} bucket.`,
      values: { count: rateLimited, offsetMs: firstOffset },
    });
  }

  // 7. authentication-after-expiry
  const authentication = categoryCount("authentication");
  if (authentication > 0 && (!result.tokenRefreshes.lifetimeStated || result.tokenRefreshes.failed > 0)) {
    findings.push({
      ruleId: "authentication-after-expiry",
      stepIds: [],
      message: result.tokenRefreshes.lifetimeStated
        ? `${authentication} requests failed authentication after ${result.tokenRefreshes.failed} token refreshes failed.`
        : `${authentication} requests failed authentication. The token had no stated lifetime, so it was not refreshed.`,
      values: { count: authentication, failedRefreshes: result.tokenRefreshes.failed },
    });
  }

  // 8. connection-errors
  const connection = categoryCount("connection-error") + categoryCount("timeout");
  if (connection > 0) {
    findings.push({
      ruleId: "connection-errors",
      stepIds: [],
      message: `${connection} requests got no response (connection error or timeout).`,
      values: { count: connection },
    });
  }

  // 9. refreshes
  if (result.tokenRefreshes.count > 0) {
    findings.push({
      ruleId: "refreshes",
      stepIds: [],
      message: `Tokens were refreshed ${result.tokenRefreshes.count} times by the virtual users; ${result.tokenRefreshes.failed} failed.`,
      values: { count: result.tokenRefreshes.count, failed: result.tokenRefreshes.failed },
    });
  }

  return findings;
}
