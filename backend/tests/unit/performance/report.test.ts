import type { PerformanceResult, PerformanceRun, PerformanceThreshold } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { deriveFindings } from "../../../src/performance/report/findings";
import { planSnapshotForRun } from "../../../src/performance/plan/runSnapshot";
import { BODY_EDITED_MARKER, bodyEditProvenance, escapeHtml, formatCount, QUICK_PLAN_PROVENANCE, renderHtmlReport, REPORT_CSP } from "../../../src/performance/report/renderHtmlReport";
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

  it("states that a quick plan's scenarios were generated and not reviewed, and nothing of the kind for a guided plan (AP-032 FR-013)", () => {
    const quick = completedRun({ planSnapshot: { ...plan, source: "quick" }, planSource: "quick" });
    const quickHtml = renderHtmlReport({ ...quick, result: withReportFields(result(), quick) });
    expect(quickHtml).toContain(QUICK_PLAN_PROVENANCE);
    expect(renderHtmlReport({ ...quick, result: withReportFields(result(), quick) })).toBe(quickHtml);

    const guided = completedRun({ planSnapshot: { ...plan, source: "guided" } });
    expect(renderHtmlReport({ ...guided, result: withReportFields(result(), guided) })).not.toContain(QUICK_PLAN_PROVENANCE);

    // A snapshot recorded before AP-032 has no source and is a guided plan.
    const legacyPlan: Partial<typeof plan> = { ...plan };
    delete legacyPlan.source;
    const legacy = completedRun({ planSnapshot: legacyPlan as typeof plan });
    expect(renderHtmlReport({ ...legacy, result: withReportFields(result(), legacy) })).not.toContain(QUICK_PLAN_PROVENANCE);
  });

  it("formats numbers without the locale", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(1234.5)).toBe("1,234.5");
  });
});

/** AP-033 FR-014 (specs/033-edit-step-request-body research R11; tasks T020). */
describe("runs and reports of a plan with body edits", () => {
  const BODY_MARKER = "EDITED-BODY-MARKER-4c1e";
  const editedCreate = { ...create, bodyEdited: true as const };
  const editedPlan = planFixture({
    journeys: [journeyFixture({ id: "j1", steps: [editedCreate, evil] })],
    bodyEdits: [{ stepId: "s-create", operationKey: "POST /orders", scenarioId: "sc-create", kind: "json", json: { note: BODY_MARKER } }],
    discardedBodyEdits: ["GET /gone"],
  });

  it("stores a snapshot without body content, keeping which steps were edited", () => {
    const snapshot = planSnapshotForRun(editedPlan);
    expect(snapshot.bodyEdits).toEqual([]);
    expect(snapshot.discardedBodyEdits).toEqual([]);
    expect(snapshot.journeys[0].steps[0].bodyEdited).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain(BODY_MARKER);
    expect(editedPlan.bodyEdits).toHaveLength(1);
  });

  it("marks each edited step and counts them in provenance, with no body content", () => {
    const run = completedRun({ planSnapshot: planSnapshotForRun(editedPlan) });
    const html = renderHtmlReport({ ...run, result: withReportFields(result(), run) });
    expect(html).toContain(BODY_EDITED_MARKER);
    expect(html).toContain(escapeHtml(bodyEditProvenance(1)));
    expect(bodyEditProvenance(1)).toBe("1 step sent a body written by the engineer, not generated from the specification.");
    expect(bodyEditProvenance(3)).toBe("3 steps sent a body written by the engineer, not generated from the specification.");
    expect(html).not.toContain(BODY_MARKER);
  });

  it("adds nothing to the report of a plan without edits", () => {
    const html = renderHtmlReport(completedRun());
    expect(html).not.toContain(BODY_EDITED_MARKER);
    expect(html).not.toContain("written by the engineer");
  });
});

/** FR-036 (amended 2026-09-30): readable timeline, every status received, latency detail, request and response per step. */
describe("report detail per step", () => {
  function amended(): PerformanceResult {
    const base = result();
    return {
      ...base,
      totals: { ...base.totals, latencySummaryMs: { min: 3.2, mean: 48.1, max: 910 }, iterationDurationMs: { p50: 150, p90: 200, p95: 220, p99: 260 }, dataSentBytes: 2_048, dataReceivedBytes: 3_145_728 },
      timeline: { bucketMs: 5_000, points: [{ offsetMs: 0, virtualUsers: 2, requests: 60, errors: 0, p95Ms: 2 }, { offsetMs: 5_000, virtualUsers: 2, requests: 60, errors: 6, p95Ms: 900 }] },
      steps: [
        {
          ...base.steps[0],
          statusesReceived: [{ status: "201", count: 54, expected: true }, { status: "401", count: 2, expected: false }, { status: "429", count: 4, expected: false }],
          latencySummaryMs: { min: 3.2, mean: 60.4, max: 910 },
          phaseTimings: [{ phase: "connecting", meanMs: 0.4, p95Ms: 1.1 }, { phase: "waiting", meanMs: 55.2, p95Ms: 101.3 }],
          timeline: [{ offsetMs: 0, requests: 30, errors: 0, p95Ms: 2 }, { offsetMs: 5_000, requests: 30, errors: 6, p95Ms: 900 }],
        },
        { ...base.steps[1], statusesReceived: [{ status: "200", count: 60, expected: true }], latencySummaryMs: { min: 4, mean: 30, max: 95 }, phaseTimings: [], timeline: [{ offsetMs: 0, requests: 60, errors: 0, p95Ms: 70 }] },
      ],
    };
  }
  const render = (value: PerformanceResult, planSnapshot = plan) => {
    const run = completedRun({ planSnapshot });
    return renderHtmlReport({ ...run, result: withReportFields(value, run) });
  };

  it("draws the timeline as three panels, each with its own scale and legend, never one shared axis", () => {
    const html = render(amended());
    for (const text of ["Virtual users", "p95 latency, all steps", "Requests as expected", "Failed requests", "ms, log scale", 'class="vus-line"', 'class="p95"', 'class="bar-fail"', "<title>00:05–00:10 · 2 VUs · p95 900 ms · 60 requests, 6 failed</title>", "Timeline as a table"]) {
      expect(html).toContain(text);
    }
    // Only latency within 20× of itself stays linear.
    expect(render({ ...amended(), timeline: { bucketMs: 5_000, points: [{ offsetMs: 0, virtualUsers: 1, requests: 1, errors: 0, p95Ms: 40 }] } })).not.toContain("log scale");
  });

  it("shows each step's latency per interval on one scale, hatching intervals with failures", () => {
    const html = render(amended());
    expect(html).toContain("By step over time");
    expect(html).toContain("Hatched: had failures");
    expect(html).toMatch(/class="cell h\d fail" title="POST \/orders · 00:05–00:10 · 30 requests · p95 900 ms · 6 failed"/);
    expect(html).toContain("2 ms – ");
  });

  it("lists every status received, marked expected or unexpected, with min and max latency", () => {
    const html = render(amended());
    expect(html).toContain("<th>Received</th>");
    expect(html).toMatch(/201 × 54<\/span> <span class="badge ok">expected<\/span>/);
    expect(html).toMatch(/429 × 4<\/span> <span class="badge bad">unexpected<\/span>/);
    expect(html).toContain("min 3.2 ms · mean 60.4 ms · max 910 ms");
    expect(html).toContain("3 MiB");
    expect(html).toContain("p95 220 ms each");
  });

  it("splits each step into a request block from the plan and a response block from the measurements, with no body", () => {
    const html = render(amended());
    for (const text of ["<h3>Request</h3>", "<h3>Response</h3>", "path template; the resolved URL is not recorded", "Waiting (time to first byte)", "55.2 ms", "orderId ← response field orderId", "Not recorded", "Why in this journey"]) {
      expect(html).toContain(text);
    }
    // The failing step is open; the step without failures is not.
    expect(html).toMatch(/<details open><summary><span class="method">POST<\/span> <code>\/orders<\/code>/);
    expect(html).toMatch(/<details><summary><span class="method">GET<\/span>/);
  });

  it("reports a run recorded before the amendment without inventing what it did not record", () => {
    const html = render(result());
    expect(html).toContain("Failures only; this run predates recording every status.");
    expect(html).toContain("This run was recorded before per-step timelines were kept.");
    expect(html).not.toContain("Request phases");
    expect(html).not.toContain("Data received");
    expect(html).not.toContain("badge ok\">expected");
  });

  it("is deterministic and escapes path templates in hover text", () => {
    const html = render(amended());
    expect(render(amended())).toBe(html);
    const evilTimeline = { ...amended(), steps: [amended().steps[0], { ...amended().steps[1], timeline: [{ offsetMs: 0, requests: 1, errors: 1, p95Ms: 5 }] }] };
    const evilHtml = render(evilTimeline);
    expect(evilHtml).not.toContain("<img src=x onerror=alert(1)>");
    expect(evilHtml).not.toMatch(/<script|<link|<iframe|<img /i);
  });
});
