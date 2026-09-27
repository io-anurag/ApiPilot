import type { PerformanceResult, PerformanceRun, PerformanceThreshold } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { deriveFindings } from "../../../src/performance/report/findings";
import { escapeHtml, formatCount, renderHtmlReport, REPORT_CSP } from "../../../src/performance/report/renderHtmlReport";
import { evaluateThresholds } from "../../../src/performance/report/thresholds";
import { withReportFields } from "../../../src/performance/runPerformanceTest";
import { journeyFixture, planFixture, runFixture, SEEDED_CLIENT_SECRET, stepFixture } from "../../fixtures/performance/builders";

/** FR-035 to FR-040 (research D15 to D17; tasks T071 to T073). */

const create = stepFixture({
  id: "s-create",
  operationKey: "POST /orders",
  method: "POST",
  path: "/orders",
  scenarioDescription: "Create order",
  scenarioChoice: "rule-generated",
  produces: ["orderId"],
  variableBindings: [{ variable: "orderId", role: "produces", field: "orderId" }],
  dependency: { relationshipIds: ["r".repeat(64)], confidence: "CONFIRMED" },
  expectedStatuses: [{ code: "201", source: "specification" }],
  auth: { kind: "oauth2-client-credentials", schemeName: "OrdersAuth" },
});
const evil = stepFixture({ id: "s-evil", operationKey: "GET /x/<img src=x onerror=alert(1)>", path: "/x/<img src=x onerror=alert(1)>", expectedStatuses: [{ code: "200", source: "user" }] });

function result(overrides: Partial<PerformanceResult> = {}): PerformanceResult {
  return {
    totals: { requests: 120, errors: 6, errorRatePercent: 5, iterations: 60, journeysCutShort: 3, throughputPerSecond: 2, latencyMs: { p50: 40, p90: 80, p95: 95, p99: 140 } },
    journeys: [
      { journeyId: "j1", requests: 60, latencyMs: { p50: 50, p90: 90, p95: 110, p99: 150 }, throughputPerSecond: 1, errorRatePercent: 10, checkPassRatePercent: 90, runsCutShort: 3, cutShortAtStepId: "s-create" },
      { journeyId: "j2", requests: 60, latencyMs: { p50: 30, p90: 60, p95: 70, p99: 90 }, throughputPerSecond: 1, errorRatePercent: 0, checkPassRatePercent: 100, runsCutShort: 0 },
    ],
    steps: [
      { stepId: "s-create", operationKey: "POST /orders", method: "POST", expectedStatuses: create.expectedStatuses, requests: 60, latencyMs: { p50: 50, p90: 90, p95: 110, p99: 150 }, throughputPerSecond: 1, errorRatePercent: 10, errorsByStatus: [{ status: "429", count: 4 }, { status: "401", count: 2 }], errorsByCategory: [{ category: "authentication", count: 2 }, { category: "rate-limited", count: 4 }], checkPassRatePercent: 90, notAttempted: { missingData: 0, dependencyNotAttempted: 0 }, missingVariables: [] },
      { stepId: "s-evil", operationKey: evil.operationKey, method: "GET", expectedStatuses: evil.expectedStatuses, requests: 60, latencyMs: { p50: 30, p90: 60, p95: 70, p99: 90 }, throughputPerSecond: 1, errorRatePercent: 0, errorsByStatus: [], errorsByCategory: [], checkPassRatePercent: 100, notAttempted: { missingData: 5, dependencyNotAttempted: 0 }, missingVariables: ["warehouseId"] },
    ],
    timeline: { bucketMs: 5_000, points: [{ offsetMs: 0, virtualUsers: 2, requests: 60, errors: 0, p95Ms: 90 }, { offsetMs: 5_000, virtualUsers: 2, requests: 60, errors: 6, p95Ms: 100 }] },
    writeRequests: [{ operationKey: "POST /orders", method: "POST", sent: 60, succeeded: 54 }],
    tokenRefreshes: { count: 4, failed: 1, lifetimeStated: true, bucketOffsetsMs: [5_000] },
    firstFailure: { offsetMs: 5_000, stepId: "s-create" },
    firstRateLimitedOffsetMs: 5_000,
    thresholdOutcomes: [],
    findings: [],
    findingsRulesetVersion: 1,
    latencyPrecision: "within-1-percent",
    ...overrides,
  };
}

const thresholds: PerformanceThreshold[] = [
  { id: "t-run-p95", scope: { kind: "run" }, metric: "p95", comparator: "<=", limit: 95 },
  { id: "t-run-err", scope: { kind: "run" }, metric: "error-rate", comparator: "<=", limit: 1 },
  { id: "t-step", scope: { kind: "step", stepId: "s-create" }, metric: "p99", comparator: "<=", limit: 200 },
];
const plan = planFixture({ journeys: [journeyFixture({ id: "j1", steps: [create] }), journeyFixture({ id: "j2", steps: [evil] })], thresholds });

function completedRun(overrides: Partial<PerformanceRun> = {}): PerformanceRun {
  const base = runFixture({ status: "completed", planSnapshot: plan, endedAt: "2026-09-27T12:01:00.000Z" });
  return { ...base, result: withReportFields(result(), base), ...overrides };
}

describe("thresholds (D15)", () => {
  it("evaluates each threshold with <=, the boundary passing", () => {
    expect(evaluateThresholds(thresholds, result())).toEqual([
      { thresholdId: "t-run-p95", measured: 95, passed: true },
      { thresholdId: "t-run-err", measured: 5, passed: false },
      { thresholdId: "t-step", measured: 150, passed: true },
    ]);
    expect(evaluateThresholds([], result())).toEqual([]);
  });

  it("does not pass a threshold with nothing measured", () => {
    const empty = result({ steps: [{ ...result().steps[0], requests: 0, latencyMs: null }] });
    expect(evaluateThresholds([thresholds[2]], empty)).toEqual([{ thresholdId: "t-step", measured: null, passed: false }]);
  });
});

describe("findings (FR-038, D16)", () => {
  it("applies the rules in their fixed order, and the same data gives the same findings (SC-011)", () => {
    const withOutcomes = { ...result(), thresholdOutcomes: evaluateThresholds(thresholds, result()) };
    const findings = deriveFindings(withOutcomes, plan);
    expect(findings.map((finding) => finding.ruleId)).toEqual([
      "threshold-failed",
      "slowest-step",
      "failures-start",
      "cut-short-journeys",
      "missing-data",
      "rate-limited",
      "authentication-after-expiry",
      "refreshes",
    ]);
    expect(deriveFindings(withOutcomes, plan)).toEqual(findings);
    expect(findings[0].message).toBe("Run failure rate is 5%, above your 1% threshold.");
    expect(findings[1].message).toBe("POST /orders has the highest p95 latency: 110 ms.");
    expect(findings[4].message).toContain("warehouseId");
  });

  it("produces nothing for a rule that does not apply", () => {
    const quiet = result({ tokenRefreshes: { count: 0, failed: 0, lifetimeStated: true, bucketOffsetsMs: [] }, firstFailure: undefined, firstRateLimitedOffsetMs: undefined });
    const clean = { ...quiet, journeys: quiet.journeys.map((j) => ({ ...j, runsCutShort: 0 })), steps: quiet.steps.map((s) => ({ ...s, errorsByCategory: [], notAttempted: { missingData: 0, dependencyNotAttempted: 0 } })) };
    expect(deriveFindings(clean, plan).map((f) => f.ruleId)).toEqual(["slowest-step"]);
  });

  it("reports connection errors and an unrefreshable token", () => {
    const failing = result({
      tokenRefreshes: { count: 0, failed: 0, lifetimeStated: false, bucketOffsetsMs: [] },
      steps: result().steps.map((step, i) => (i === 0 ? { ...step, errorsByCategory: [{ category: "authentication" as const, count: 3 }, { category: "connection-error" as const, count: 2 }, { category: "timeout" as const, count: 1 }] } : step)),
    });
    const findings = deriveFindings(failing, plan);
    expect(findings.find((f) => f.ruleId === "authentication-after-expiry")?.message).toContain("no stated lifetime");
    expect(findings.find((f) => f.ruleId === "connection-errors")?.values).toEqual({ count: 3 });
  });
});

describe("HTML report (D17)", () => {
  it("is a complete, deterministic document that can load nothing (SC-010)", () => {
    const run = completedRun();
    const html = renderHtmlReport(run);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">`);
    expect(REPORT_CSP).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    expect(html).not.toMatch(/<script|<link|<iframe|<img /i);
    expect(html).not.toMatch(/(src|href)=["'](https?:|\/\/|[./])/i);
    expect(renderHtmlReport(run)).toBe(html);
  });

  it("escapes every string from the specification", () => {
    const html = renderHtmlReport(completedRun());
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain(escapeHtml("/x/<img src=x onerror=alert(1)>"));
  });

  it("shows every metric, the thresholds and findings, the timeline and provenance (FR-036 to FR-039, SC-004)", () => {
    const html = renderHtmlReport(completedRun());
    for (const text of ["p50", "p90", "p95", "p99", "Req/s", "Failure rate", "Checks passed", "429 × 4", "rate-limited × 4", "within 1%", "<svg", "Run p95 ≤ 95 ms", "Passed", "Failed", "Write operation", "60", "54", "Token refreshes", "OAuth2 client credentials", "rule-generated", "201 (from specification)", "200 (set by you)", "orderId ← response field orderId", "CONFIRMED", "perf-local", "Tier: local", "http://127.0.0.1:4600", "v1.2.0", "Missing data (warehouseId)"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("says when no thresholds were set, and never contains a secret (FR-037, FR-040)", () => {
    const run = completedRun({ planSnapshot: { ...plan, thresholds: [] } });
    const html = renderHtmlReport({ ...run, result: withReportFields(result(), run) });
    expect(html).toContain("No thresholds were set, so the report gives no pass/fail verdict.");
    expect(html).not.toContain(SEEDED_CLIENT_SECRET);
  });

  it("renders a failed run with no measurements", () => {
    const html = renderHtmlReport(runFixture({ status: "failed", failure: { category: "k6-unavailable" }, planSnapshot: plan }));
    expect(html).toContain("Failed · k6-unavailable");
    expect(html).toContain("This run recorded no measurements (failure: k6-unavailable).");
    expect(html).toContain("Provenance");
  });

  it("formats numbers without the locale", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(1234.5)).toBe("1,234.5");
  });
});
