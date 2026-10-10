import type {
  ExpectedStatus,
  JourneyResult,
  PerformanceFailureCategory,
  PerformancePlan,
  PerformanceResult,
  RequestPhase,
  RunProgress,
  StepResult,
  StepTimelinePoint,
  StoredLiveSeries,
  TimelinePoint,
} from "@apipilot/shared-domain";
import { PERFORMANCE_FINDINGS_RULESET_VERSION, REQUEST_PHASES } from "@apipilot/shared-domain";
import { compareCodeUnits } from "../../postman/ordering";
import { statusMatches } from "../plan/expectedStatuses";
import type { MetricsPoint } from "../k6/metricsStream";
import { latencyOf, type LiveParts } from "../live/buildSnapshot";
import { createLiveSeries } from "../live/liveSeries";
import type { LiveStepInfo } from "../live/liveStepInfo";
import { createRecentRing } from "../live/recentRing";
import { LatencyHistogram } from "./histogram";
import { isRunLayout, layoutFromPlan, type RunLayout } from "./runLayout";

/**
 * Streams k6's metrics into a constant-memory aggregate (specs/031-k6-performance-testing research
 * D11, D12, D14, D25). ApiPilot, not k6, decides what a failure is: a response whose status is not
 * among its step's expected codes, or a request with no response (FR-012a). Token requests carry
 * no `step` tag and never enter a step's figures (D12).
 */
const WRITE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** k6's error code for a request that timed out. Every other status-0 error code is a connection error. */
const K6_REQUEST_TIMEOUT = "1050";
/** k6's per-request phase metrics (FR-036, amended 2026-09-30). */
const PHASE_METRICS: Readonly<Record<string, RequestPhase>> = {
  http_req_blocked: "blocked",
  http_req_connecting: "connecting",
  http_req_tls_handshaking: "tls-handshaking",
  http_req_sending: "sending",
  http_req_waiting: "waiting",
  http_req_receiving: "receiving",
};

/** One step in one timeline bucket. */
interface StepBucket {
  requests: number;
  errors: number;
  histogram: LatencyHistogram;
}

interface StepStats {
  stepId: string;
  journeyId: string;
  operationKey: string;
  method: string;
  expected: ExpectedStatus[];
  requests: number;
  failures: number;
  byStatus: Map<string, number>;
  /** Every response by status, expected or not. */
  received: Map<string, number>;
  byCategory: Map<PerformanceFailureCategory, number>;
  checksPassed: number;
  checksTotal: number;
  missingData: number;
  dependencyNotAttempted: number;
  missingVariables: Set<string>;
  histogram: LatencyHistogram;
  phases: Map<RequestPhase, LatencyHistogram>;
  buckets: Map<number, StepBucket>;
  /** AP-035 FR-029: outcomes per capture name, in the step's capture order. */
  captures: Map<string, { succeeded: number; failed: number }>;
  /** AP-037 FR-034: outcomes per check, in the step's check order; empty for legacy steps. */
  checks: Map<string, { kind: string; passed: number; failed: number }>;
}

interface JourneyStats {
  requests: number;
  failures: number;
  checksPassed: number;
  checksTotal: number;
  runsCutShort: number;
  cutShortAt: Map<string, number>;
  /** AP-035 FR-029: journeys cut short per failed capture name. */
  cutShortByCapture: Map<string, number>;
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
  /** AP-037 FR-018: the Once before load step that failed, if any (research R12). */
  setupFailure(): { stepId: string; reason: string } | null;
  /** AP-045: the live dashboard's figures at `nowMs`, from memory; nothing is recomputed or stored. */
  liveParts(nowMs: number): LiveParts;
  /** AP-045 US4: the whole run's series for the finished result (at most 1,800 points). */
  storedLiveSeries(endMs: number): StoredLiveSeries;
}

export interface AggregateLiveOptions {
  /** Step id to its chain, name, method and path template (AP-045 research R5). Absent: the layout's own method, no path. */
  steps?: ReadonlyMap<string, LiveStepInfo>;
}

/**
 * Takes a legacy plan, read through `layoutFromPlan` exactly as before, or an AP-037 run layout
 * (specs/037-request-chain-performance research R19). Chain-only streams (`apipilot_setup`,
 * `apipilot_check`, `apipilot_data`, refreshes by `setup_step`) add result fields only for a layout
 * that has setup steps or data sets, so a legacy run's result is unchanged.
 */
export function createAggregate(source: PerformancePlan | RunLayout, plannedDurationMs: number, runStartMs: number, liveOptions: AggregateLiveOptions = {}): PerformanceAggregate {
  const layout = isRunLayout(source) ? source : layoutFromPlan(source);
  const steps = new Map<string, StepStats>();
  const journeys = new Map<string, JourneyStats>();
  // AP-035 FR-025: an incomplete user journey was not in the script, so it has no figures.
  for (const journey of layout.journeys) {
    journeys.set(journey.id, {
      requests: 0,
      failures: 0,
      checksPassed: 0,
      checksTotal: 0,
      runsCutShort: 0,
      cutShortAt: new Map(),
      cutShortByCapture: new Map(),
      histogram: new LatencyHistogram(),
    });
    for (const step of journey.steps) {
      steps.set(step.stepId, {
        stepId: step.stepId,
        journeyId: journey.id,
        operationKey: step.operationKey,
        method: step.method,
        expected: step.expected,
        requests: 0,
        failures: 0,
        byStatus: new Map(),
        received: new Map(),
        byCategory: new Map(),
        checksPassed: 0,
        checksTotal: 0,
        missingData: 0,
        dependencyNotAttempted: 0,
        missingVariables: new Set(),
        histogram: new LatencyHistogram(),
        phases: new Map(),
        buckets: new Map(),
        captures: new Map(step.captureNames.map((name) => [name, { succeeded: 0, failed: 0 }])),
        checks: new Map(step.checks.map((check) => [check.id, { kind: check.kind, passed: 0, failed: 0 }])),
      });
    }
  }
  const bucketMs = timelineBucketMs(plannedDurationMs);
  const buckets = new Map<number, Bucket>();
  const total = new LatencyHistogram();
  const iterationDuration = new LatencyHistogram();
  const data = { sentBytes: 0, receivedBytes: 0 };
  const writes = new Map<string, { operationKey: string; method: string; sent: number; succeeded: number }>();
  const refresh = { count: 0, failed: 0, lifetimeStated: true, buckets: new Set<number>() };
  // AP-036 FR-028, FR-029 (research R8): failures before the load, and refreshes by token source.
  const setupFailed = new Map<string, { scheme: string; capture: string }>();
  const refreshByScheme = new Map<string, { scheme: string; refreshed: number; failed: number }>();
  const firstFailure = { bucket: Number.POSITIVE_INFINITY, byStep: new Map<string, number>() };
  let firstRateLimitedBucket = Number.POSITIVE_INFINITY;
  let requests = 0;
  let failures = 0;
  let iterations = 0;
  let journeysCutShort = 0;
  let currentVirtualUsers = 0;
  let tokenRefreshesSoFar = 0;
  // AP-037 (research R12 to R14): setup steps, refreshes by setup step, and data set takes.
  const setupOutcomes = new Map<string, { outcome: "ok" | "failed"; reason: string | null; latencyMs: number | null }>();
  const refreshBySetupStep = new Map<string, { stepId: string; refreshed: number; failed: number }>();
  const dataTakes = new Map<number, { takes: number; wrapped: boolean }>();
  // AP-045: the live dashboard's bounded series and latest-requests ring, fed from the same points.
  const liveSeries = createLiveSeries({
    withVirtualUsers: true,
    groups: layout.journeys.map((journey) => ({
      id: journey.id,
      label: journey.steps.map((step) => liveOptions.steps?.get(step.stepId)?.chainName).find((label) => label !== undefined) ?? journey.id,
    })),
  });
  const liveRing = createRecentRing();
  const secondOf = (timeMs: number) => Math.max(0, Math.floor((timeMs - runStartMs) / 1000));

  const bucketIndex = (timeMs: number) => Math.max(0, Math.floor((timeMs - runStartMs) / bucketMs));
  const bucketAt = (index: number): Bucket => {
    let bucket = buckets.get(index);
    if (!bucket) {
      bucket = { virtualUsers: currentVirtualUsers, requests: 0, errors: 0, histogram: new LatencyHistogram() };
      buckets.set(index, bucket);
    }
    return bucket;
  };
  const stepBucketAt = (step: StepStats, index: number): StepBucket => {
    let bucket = step.buckets.get(index);
    if (!bucket) {
      bucket = { requests: 0, errors: 0, histogram: new LatencyHistogram() };
      step.buckets.set(index, bucket);
    }
    return bucket;
  };

  /** One latest-requests entry from a request's duration point, which carries the same `status` and `method` tags as `http_reqs` (AP-045 R5). */
  function pushRecent(step: StepStats, point: MetricsPoint): void {
    const info = liveOptions.steps?.get(step.stepId);
    const status = Number(point.tags.status ?? "0");
    const code = Number.isFinite(status) ? status : 0;
    liveRing.push({
      second: secondOf(point.timeMs),
      chain: info?.stepName ?? step.stepId,
      method: info?.method ?? step.method,
      path: info?.path ?? "",
      status: code === 0 ? null : code,
      failed: classifyFailure(code, point.tags.error_code, step.expected) !== null,
      durationMs: Math.round(point.value * 100) / 100,
    });
  }

  function ingest(point: MetricsPoint): void {
    const { metric, tags } = point;
    const index = bucketIndex(point.timeMs);
    if (metric === "vus") {
      currentVirtualUsers = point.value;
      bucketAt(index).virtualUsers = point.value;
      liveSeries.recordVirtualUsers(secondOf(point.timeMs), point.value);
      return;
    }
    if (metric === "iterations") {
      iterations += point.value;
      return;
    }
    if (metric === "iteration_duration") {
      iterationDuration.add(point.value);
      return;
    }
    if (metric === "data_sent" || metric === "data_received") {
      if (metric === "data_sent") data.sentBytes += point.value;
      else data.receivedBytes += point.value;
      return;
    }
    if (metric === "apipilot_setup" && tags.setup_step) {
      const current = setupOutcomes.get(tags.setup_step);
      setupOutcomes.set(tags.setup_step, { outcome: tags.outcome === "failed" ? "failed" : "ok", reason: tags.reason ? tags.reason : null, latencyMs: current?.latencyMs ?? null });
      return;
    }
    if (metric === "http_req_duration" && tags.apipilot_kind === "setup" && tags.setup_step) {
      const current = setupOutcomes.get(tags.setup_step) ?? { outcome: "ok" as const, reason: null, latencyMs: null };
      setupOutcomes.set(tags.setup_step, { ...current, latencyMs: Math.round(point.value * 100) / 100 });
      return;
    }
    if (metric === "apipilot_data" && tags.dataset !== undefined) {
      if (tags.outcome !== "take" && tags.outcome !== "wrap") return;
      const index = Number(tags.dataset);
      const entry = dataTakes.get(index) ?? { takes: 0, wrapped: false };
      entry.takes += point.value;
      if (tags.outcome === "wrap") entry.wrapped = true;
      dataTakes.set(index, entry);
      return;
    }
    if (metric === "apipilot_token_refresh") {
      if (tags.outcome === "no-lifetime") {
        refresh.lifetimeStated = false;
        return;
      }
      if (tags.outcome === "setup-failed") {
        const entry = { scheme: tags.scheme ?? "", capture: tags.capture ?? "" };
        setupFailed.set(JSON.stringify([entry.scheme, entry.capture]), entry);
        return;
      }
      refresh.count += 1;
      tokenRefreshesSoFar += 1;
      if (tags.outcome === "failed") refresh.failed += 1;
      refresh.buckets.add(index * bucketMs);
      if (tags.scheme) {
        const byScheme = refreshByScheme.get(tags.scheme) ?? { scheme: tags.scheme, refreshed: 0, failed: 0 };
        if (tags.outcome === "failed") byScheme.failed += 1;
        else byScheme.refreshed += 1;
        refreshByScheme.set(tags.scheme, byScheme);
      }
      if (tags.setup_step) {
        const bySetupStep = refreshBySetupStep.get(tags.setup_step) ?? { stepId: tags.setup_step, refreshed: 0, failed: 0 };
        if (tags.outcome === "failed") bySetupStep.failed += 1;
        else bySetupStep.refreshed += 1;
        refreshBySetupStep.set(tags.setup_step, bySetupStep);
      }
      return;
    }
    const step = tags.step ? steps.get(tags.step) : undefined;
    if (!step) return;
    const journey = journeys.get(step.journeyId)!;
    const phase = PHASE_METRICS[metric];
    if (phase) {
      let histogram = step.phases.get(phase);
      if (!histogram) {
        histogram = new LatencyHistogram();
        step.phases.set(phase, histogram);
      }
      histogram.add(point.value);
      return;
    }
    switch (metric) {
      case "http_reqs": {
        const status = Number(tags.status ?? "0");
        const category = classifyFailure(Number.isFinite(status) ? status : 0, tags.error_code, step.expected);
        step.requests += 1;
        journey.requests += 1;
        requests += 1;
        liveSeries.recordRequest(secondOf(point.timeMs), step.journeyId);
        const bucket = bucketAt(index);
        bucket.requests += 1;
        const stepBucket = stepBucketAt(step, index);
        stepBucket.requests += 1;
        const receivedKey = Number.isFinite(status) ? String(status) : "0";
        step.received.set(receivedKey, (step.received.get(receivedKey) ?? 0) + 1);
        if (category) {
          stepBucket.errors += 1;
          step.failures += 1;
          journey.failures += 1;
          failures += 1;
          liveSeries.recordFailure(secondOf(point.timeMs));
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
        stepBucketAt(step, index).histogram.add(point.value);
        liveSeries.recordLatency(secondOf(point.timeMs), point.value);
        pushRecent(step, point);
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
        if (tags.capture) journey.cutShortByCapture.set(tags.capture, (journey.cutShortByCapture.get(tags.capture) ?? 0) + 1);
        journeysCutShort += 1;
        return;
      case "apipilot_capture": {
        if (!tags.capture) return;
        const outcome = step.captures.get(tags.capture) ?? { succeeded: 0, failed: 0 };
        if (tags.outcome === "ok") outcome.succeeded += point.value;
        else outcome.failed += point.value;
        step.captures.set(tags.capture, outcome);
        return;
      }
      case "apipilot_check": {
        const outcome = tags.check ? step.checks.get(tags.check) : undefined;
        if (!outcome) return;
        if (tags.outcome === "passed") outcome.passed += point.value;
        else outcome.failed += point.value;
        return;
      }
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
      statusesReceived: [...step.received.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([status, count]) => ({ status, count, expected: status !== "0" && statusMatches(Number(status), step.expected) })),
      latencySummaryMs: step.histogram.summary(),
      phaseTimings: REQUEST_PHASES.flatMap((phase) => {
        const histogram = step.phases.get(phase);
        const summary = histogram?.summary();
        return histogram && summary ? [{ phase, meanMs: summary.mean, p95Ms: histogram.percentile(95)! }] : [];
      }),
      timeline: [...step.buckets.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, bucket]): StepTimelinePoint => ({ offsetMs: index * bucketMs, requests: bucket.requests, errors: bucket.errors, p95Ms: bucket.histogram.percentile(95) })),
      ...(step.captures.size > 0 ? { captures: [...step.captures.entries()].map(([name, outcome]) => ({ name, ...outcome })) } : {}),
      ...(step.checks.size > 0 ? { checks: [...step.checks.entries()].map(([checkId, outcome]) => ({ checkId, ...outcome })) } : {}),
    }));
    const journeyResults: JourneyResult[] = layout.journeys.map((journey) => {
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
        ...(stats.cutShortByCapture.size > 0 ? { cutShortByCapture: Object.fromEntries([...stats.cutShortByCapture.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) } : {}),
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
        latencySummaryMs: total.summary(),
        iterationDurationMs: iterationDuration.percentiles(),
        dataSentBytes: data.sentBytes,
        dataReceivedBytes: data.receivedBytes,
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
        // AP-036: present only when there is something to say, so earlier runs' results are unchanged.
        ...(setupFailed.size > 0
          ? { setupFailed: [...setupFailed.values()].sort((a, b) => compareCodeUnits(a.scheme, b.scheme) || compareCodeUnits(a.capture, b.capture)) }
          : {}),
        ...(refreshByScheme.size > 0 ? { byScheme: [...refreshByScheme.values()].sort((a, b) => compareCodeUnits(a.scheme, b.scheme)) } : {}),
        ...(layout.setupStepIds && refreshBySetupStep.size > 0
          ? { bySetupStep: layout.setupStepIds.flatMap((stepId) => (refreshBySetupStep.has(stepId) ? [refreshBySetupStep.get(stepId)!] : [])) }
          : {}),
      },
      ...(layout.setupStepIds
        ? { setupSteps: layout.setupStepIds.flatMap((stepId) => (setupOutcomes.has(stepId) ? [{ stepId, ...setupOutcomes.get(stepId)! }] : [])) }
        : {}),
      ...(layout.dataSets
        ? {
            dataSets: layout.dataSets.map((dataSet, index) => {
              const taken = dataTakes.get(index) ?? { takes: 0, wrapped: false };
              return { dataSetId: dataSet.id, takes: taken.takes, rowsUsed: Math.min(taken.takes, dataSet.rowCount), wrapped: taken.wrapped };
            }),
          }
        : {}),
      ...(firstFailureStep ? { firstFailure: { offsetMs: firstFailure.bucket * bucketMs, stepId: firstFailureStep } } : {}),
      ...(Number.isFinite(firstRateLimitedBucket) ? { firstRateLimitedOffsetMs: firstRateLimitedBucket * bucketMs } : {}),
      thresholdOutcomes: [],
      findings: [],
      findingsRulesetVersion: PERFORMANCE_FINDINGS_RULESET_VERSION,
      latencyPrecision: "within-1-percent",
    };
  }

  function setupFailure(): { stepId: string; reason: string } | null {
    for (const [stepId, outcome] of setupOutcomes) if (outcome.outcome === "failed") return { stepId, reason: outcome.reason ?? "unknown" };
    return null;
  }

  function liveParts(nowMs: number): LiveParts {
    const elapsedMs = Math.max(0, nowMs - runStartMs);
    const chainRows = layout.journeys.map((journey) => {
      const stats = journeys.get(journey.id)!;
      const name = journey.steps.map((step) => liveOptions.steps?.get(step.stepId)?.chainName).find((label) => label !== undefined);
      return { id: journey.id, label: name ?? journey.id, requests: stats.requests, failures: stats.failures };
    });
    return {
      elapsedMs,
      totals: { requests, failures },
      currentVirtualUsers,
      latency: latencyOf(total),
      chains: chainRows,
      series: liveSeries.view(Math.floor(elapsedMs / 1000)),
      recent: liveRing.list(),
    };
  }

  function storedLiveSeries(endMs: number): StoredLiveSeries {
    const view = liveSeries.view(Math.floor(Math.max(0, endMs - runStartMs) / 1000));
    return { bucketSeconds: view.bucketSeconds, points: view.points, ...(view.groups ? { groups: view.groups } : {}) };
  }

  return { ingest, progress, toResult, setupFailure, liveParts, storedLiveSeries };
}
