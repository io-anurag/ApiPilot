import type {
  ExpectedStatus,
  JourneyResult,
  PerformanceFailureCategory,
  PerformancePlan,
  PerformanceResult,
  RunProgress,
  StepResult,
  TimelinePoint,
} from "@apipilot/shared-domain";
import { PERFORMANCE_FINDINGS_RULESET_VERSION } from "@apipilot/shared-domain";
import { statusMatches } from "../plan/expectedStatuses";
import type { MetricsPoint } from "../k6/metricsStream";
import { LatencyHistogram } from "./histogram";

/**
 * Streams k6's metrics into a constant-memory aggregate (specs/031-k6-performance-testing research
 * D11, D12, D14, D25). ApiPilot, not k6, decides what a failure is: a response whose status is not
 * among its step's expected codes, or a request with no response (FR-012a). Token requests carry
 * no `step` tag and never enter a step's figures (D12).
 */
const WRITE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** k6's error code for a request that timed out. Every other status-0 error code is a connection error. */
const K6_REQUEST_TIMEOUT = "1050";

interface StepStats {
  stepId: string;
  journeyId: string;
  operationKey: string;
  method: string;
  expected: ExpectedStatus[];
  requests: number;
  failures: number;
  byStatus: Map<string, number>;
  byCategory: Map<PerformanceFailureCategory, number>;
  checksPassed: number;
  checksTotal: number;
  missingData: number;
  dependencyNotAttempted: number;
  missingVariables: Set<string>;
  histogram: LatencyHistogram;
}

interface JourneyStats {
  requests: number;
  failures: number;
  checksPassed: number;
  checksTotal: number;
  runsCutShort: number;
  cutShortAt: Map<string, number>;
  histogram: LatencyHistogram;
}

interface Bucket {
  virtualUsers: number;
  requests: number;
  errors: number;
  histogram: LatencyHistogram;
}

export function classifyFailure(status: number, errorCode: string | undefined, expected: readonly ExpectedStatus[]): PerformanceFailureCategory | null {
  if (status !== 0 && statusMatches(status, expected)) return null;
  if (status === 0) return errorCode === K6_REQUEST_TIMEOUT ? "timeout" : "connection-error";
  if (status === 401 || status === 403) return "authentication";
  if (status === 429) return "rate-limited";
  return "unexpected-status";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : round2((part / whole) * 100);
}

export function timelineBucketMs(plannedDurationMs: number): number {
  return Math.max(5_000, Math.ceil(plannedDurationMs / 200));
}

export interface PerformanceAggregate {
  ingest(point: MetricsPoint): void;
  progress(nowMs: number): RunProgress;
  toResult(endMs: number): PerformanceResult;
}

export function createAggregate(plan: PerformancePlan, plannedDurationMs: number, runStartMs: number): PerformanceAggregate {
  const steps = new Map<string, StepStats>();
  const journeys = new Map<string, JourneyStats>();
  for (const journey of plan.journeys) {
    journeys.set(journey.id, { requests: 0, failures: 0, checksPassed: 0, checksTotal: 0, runsCutShort: 0, cutShortAt: new Map(), histogram: new LatencyHistogram() });
    for (const step of journey.steps) {
      steps.set(step.id, {
        stepId: step.id,
        journeyId: journey.id,
        operationKey: step.operationKey,
        method: step.method,
        expected: step.expectedStatuses,
        requests: 0,
        failures: 0,
        byStatus: new Map(),
        byCategory: new Map(),
        checksPassed: 0,
        checksTotal: 0,
        missingData: 0,
        dependencyNotAttempted: 0,
        missingVariables: new Set(),
        histogram: new LatencyHistogram(),
      });
    }
  }
  const bucketMs = timelineBucketMs(plannedDurationMs);
  const buckets = new Map<number, Bucket>();
  const total = new LatencyHistogram();
  const writes = new Map<string, { operationKey: string; method: string; sent: number; succeeded: number }>();
  const refresh = { count: 0, failed: 0, lifetimeStated: true, buckets: new Set<number>() };
  const firstFailure = { bucket: Number.POSITIVE_INFINITY, byStep: new Map<string, number>() };
  let firstRateLimitedBucket = Number.POSITIVE_INFINITY;
  let requests = 0;
  let failures = 0;
  let iterations = 0;
  let journeysCutShort = 0;
  let currentVirtualUsers = 0;
  let tokenRefreshesSoFar = 0;

  const bucketIndex = (timeMs: number) => Math.max(0, Math.floor((timeMs - runStartMs) / bucketMs));
  const bucketAt = (index: number): Bucket => {
    let bucket = buckets.get(index);
    if (!bucket) {
      bucket = { virtualUsers: currentVirtualUsers, requests: 0, errors: 0, histogram: new LatencyHistogram() };
      buckets.set(index, bucket);
    }
    return bucket;
  };

  function ingest(point: MetricsPoint): void {
    const { metric, tags } = point;
    const index = bucketIndex(point.timeMs);
    if (metric === "vus") {
      currentVirtualUsers = point.value;
      bucketAt(index).virtualUsers = point.value;
      return;
    }
    if (metric === "iterations") {
      iterations += point.value;
      return;
    }
    if (metric === "apipilot_token_refresh") {
      if (tags.outcome === "no-lifetime") {
        refresh.lifetimeStated = false;
        return;
      }
      refresh.count += 1;
      tokenRefreshesSoFar += 1;
      if (tags.outcome === "failed") refresh.failed += 1;
      refresh.buckets.add(index * bucketMs);
      return;
    }
    const step = tags.step ? steps.get(tags.step) : undefined;
    if (!step) return;
    const journey = journeys.get(step.journeyId)!;
    switch (metric) {
      case "http_reqs": {
        const status = Number(tags.status ?? "0");
        const category = classifyFailure(Number.isFinite(status) ? status : 0, tags.error_code, step.expected);
        step.requests += 1;
        journey.requests += 1;
        requests += 1;
        const bucket = bucketAt(index);
        bucket.requests += 1;
        if (category) {
          step.failures += 1;
          journey.failures += 1;
          failures += 1;
          bucket.errors += 1;
          const statusKey = Number.isFinite(status) ? String(status) : "0";
          step.byStatus.set(statusKey, (step.byStatus.get(statusKey) ?? 0) + 1);
          step.byCategory.set(category, (step.byCategory.get(category) ?? 0) + 1);
          if (index < firstFailure.bucket) {
            firstFailure.bucket = index;
            firstFailure.byStep = new Map();
          }
          if (index === firstFailure.bucket) firstFailure.byStep.set(step.stepId, (firstFailure.byStep.get(step.stepId) ?? 0) + 1);
          if (category === "rate-limited") firstRateLimitedBucket = Math.min(firstRateLimitedBucket, index);
        }
        if (WRITE_METHODS.has(step.method)) {
          const key = `${step.operationKey} ${step.method}`;
          const entry = writes.get(key) ?? { operationKey: step.operationKey, method: step.method, sent: 0, succeeded: 0 };
          entry.sent += 1;
          if (!category) entry.succeeded += 1;
          writes.set(key, entry);
        }
        return;
      }
      case "http_req_duration":
        step.histogram.add(point.value);
        journey.histogram.add(point.value);
        total.add(point.value);
        bucketAt(index).histogram.add(point.value);
        return;
      case "checks":
        step.checksTotal += 1;
        journey.checksTotal += 1;
        if (point.value > 0) {
          step.checksPassed += 1;
          journey.checksPassed += 1;
        } else if (tags.check === "extraction") {
          step.byCategory.set("extraction-failed", (step.byCategory.get("extraction-failed") ?? 0) + 1);
        }
        return;
      case "apipilot_missing_data":
        step.missingData += 1;
        if (tags.variable) step.missingVariables.add(tags.variable);
        return;
      case "apipilot_not_attempted":
        step.dependencyNotAttempted += 1;
        return;
      case "apipilot_cut_short":
        journey.runsCutShort += 1;
        journey.cutShortAt.set(step.stepId, (journey.cutShortAt.get(step.stepId) ?? 0) + 1);
        journeysCutShort += 1;
        return;
      default:
        return;
    }
  }

  function progress(nowMs: number): RunProgress {
    return {
      elapsedMs: Math.max(0, nowMs - runStartMs),
      currentVirtualUsers,
      requestsSoFar: requests,
      failuresSoFar: failures,
      journeysCutShortSoFar: journeysCutShort,
      tokenRefreshesSoFar,
      steps: [...steps.values()].map((step) => ({
        stepId: step.stepId,
        requests: step.requests,
        failures: step.failures,
        notSent: { missingData: step.missingData, dependencyNotAttempted: step.dependencyNotAttempted },
      })),
    };
  }

  function toResult(endMs: number): PerformanceResult {
    const seconds = Math.max(1, endMs - runStartMs) / 1000;
    const stepResults: StepResult[] = [...steps.values()].map((step) => ({
      stepId: step.stepId,
      operationKey: step.operationKey,
      method: step.method,
      expectedStatuses: step.expected,
      requests: step.requests,
      latencyMs: step.histogram.percentiles(),
      throughputPerSecond: round2(step.requests / seconds),
      errorRatePercent: percent(step.failures, step.requests),
      errorsByStatus: [...step.byStatus.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([status, count]) => ({ status, count })),
      errorsByCategory: [...step.byCategory.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([category, count]) => ({ category, count })),
      checkPassRatePercent: step.checksTotal === 0 ? null : percent(step.checksPassed, step.checksTotal),
      notAttempted: { missingData: step.missingData, dependencyNotAttempted: step.dependencyNotAttempted },
      missingVariables: [...step.missingVariables].sort(),
    }));
    const journeyResults: JourneyResult[] = plan.journeys.map((journey) => {
      const stats = journeys.get(journey.id)!;
      const cutShortAt = [...stats.cutShortAt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      return {
        journeyId: journey.id,
        requests: stats.requests,
        latencyMs: stats.histogram.percentiles(),
        throughputPerSecond: round2(stats.requests / seconds),
        errorRatePercent: percent(stats.failures, stats.requests),
        checkPassRatePercent: stats.checksTotal === 0 ? null : percent(stats.checksPassed, stats.checksTotal),
        runsCutShort: stats.runsCutShort,
        ...(cutShortAt ? { cutShortAtStepId: cutShortAt } : {}),
      };
    });
    const points: TimelinePoint[] = [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, bucket]) => ({
        offsetMs: index * bucketMs,
        virtualUsers: bucket.virtualUsers,
        requests: bucket.requests,
        errors: bucket.errors,
        p95Ms: bucket.histogram.percentile(95),
      }));
    const stepOrder = new Map([...steps.keys()].map((id, index) => [id, index]));
    const firstFailureStep = [...firstFailure.byStep.entries()].sort((a, b) => b[1] - a[1] || stepOrder.get(a[0])! - stepOrder.get(b[0])!)[0]?.[0];
    return {
      totals: {
        requests,
        errors: failures,
        errorRatePercent: percent(failures, requests),
        iterations,
        journeysCutShort,
        throughputPerSecond: round2(requests / seconds),
        latencyMs: total.percentiles(),
      },
      journeys: journeyResults,
      steps: stepResults,
      timeline: { bucketMs, points },
      writeRequests: [...writes.values()],
      tokenRefreshes: {
        count: refresh.count,
        failed: refresh.failed,
        lifetimeStated: refresh.lifetimeStated,
        bucketOffsetsMs: [...refresh.buckets].sort((a, b) => a - b),
      },
      ...(firstFailureStep ? { firstFailure: { offsetMs: firstFailure.bucket * bucketMs, stepId: firstFailureStep } } : {}),
      ...(Number.isFinite(firstRateLimitedBucket) ? { firstRateLimitedOffsetMs: firstRateLimitedBucket * bucketMs } : {}),
      thresholdOutcomes: [],
      findings: [],
      findingsRulesetVersion: PERFORMANCE_FINDINGS_RULESET_VERSION,
      latencyPrecision: "within-1-percent",
    };
  }

  return { ingest, progress, toResult };
}
