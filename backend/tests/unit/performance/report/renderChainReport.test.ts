import { describe, expect, it } from "vitest";
import { analyzeChainPlan, type ChainPlan, type ChainRun, type PerformanceResult } from "@apipilot/shared-domain";
import { chainRunSnapshot } from "../../../../src/performance/chain/runSnapshot";
import { planFingerprint, stepContentDigest } from "../../../../src/performance/chain/savePlan";
import { renderChainReport } from "../../../../src/performance/report/renderChainReport";
import { customerLifecyclePlan } from "../../../fixtures/chain/chainPlans";

/** AP-037 (specs/037-request-chain-performance tasks T027; FR-033, FR-034, research R20). */

function runOf(plan: ChainPlan, result?: Partial<PerformanceResult>, overrides: Partial<ChainRun> = {}): ChainRun {
  const fingerprinted = { ...plan, fingerprint: planFingerprint(plan) };
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    planSource: "chain",
    planId: plan.id,
    status: "completed",
    environment: { id: "e1", name: "Local stub", tier: "local", baseUrl: "http://127.0.0.1:4600" },
    snapshot: chainRunSnapshot(fingerprinted, analyzeChainPlan(fingerprinted, { environmentValueNames: null })),
    scriptSha256: "f".repeat(64),
    k6Version: "1.2.0",
    plannedDurationMs: 60_000,
    startedAt: "2026-10-03T10:00:00.000Z",
    endedAt: "2026-10-03T10:01:00.000Z",
    cancelRequested: false,
    ...(result
      ? {
          result: {
            totals: { requests: 6, errors: 1, errorRatePercent: 16.67, iterations: 1, journeysCutShort: 0, throughputPerSecond: 0.1, latencyMs: { p50: 10, p90: 20, p95: 25, p99: 30 } },
            journeys: [{ journeyId: "c1", requests: 6, latencyMs: null, throughputPerSecond: 0.1, errorRatePercent: 16.67, checkPassRatePercent: null, runsCutShort: 2, cutShortAtStepId: "s2", cutShortByCapture: { customer_id: 2 } }],
            steps: [
              {
                stepId: "s5",
                operationKey: "s5",
                method: "GET",
                expectedStatuses: [{ code: "200", source: "user" }],
                requests: 1,
                latencyMs: null,
                throughputPerSecond: 0,
                errorRatePercent: 0,
                errorsByStatus: [],
                errorsByCategory: [],
                checkPassRatePercent: null,
                notAttempted: { missingData: 0, dependencyNotAttempted: 0 },
                missingVariables: [],
                checks: [{ checkId: "k3", kind: "field-equals", passed: 9, failed: 1 }],
              },
            ],
            timeline: { bucketMs: 5000, points: [] },
            writeRequests: [{ operationKey: "s2", method: "POST", sent: 3, succeeded: 3 }],
            tokenRefreshes: { count: 0, failed: 0, lifetimeStated: true, bucketOffsetsMs: [] },
            setupSteps: [{ stepId: "s1", outcome: "ok", reason: null, latencyMs: 31.5 }],
            thresholdOutcomes: [],
            findings: [],
            findingsRulesetVersion: 2,
            latencyPrecision: "within-1-percent",
            ...result,
          } as PerformanceResult,
        }
      : {}),
    ...overrides,
  };
}

describe("renderChainReport", () => {
  it("names each step by name, method and URL template, with its source, runs setting, checks and extractors", () => {
    const plan = customerLifecyclePlan();
    plan.chains[0].steps[1] = { ...plan.chains[0].steps[1], source: { kind: "operation", operationKey: "POST /customers", label: "POST /customers", passwordFields: [] }, seedDigest: stepContentDigest(plan.chains[0].steps[1]), changed: true };
    const html = renderChainReport(runOf(plan, {}));
    expect(html).toContain("Performance report · Customer lifecycle");
    expect(html).toContain("Steps are authored by the engineer and not verified by ApiPilot.");
    expect(html).toContain("Seeded from operation POST /customers · Changed");
    expect(html).toContain("Added by you");
    expect(html).toContain("<code>{{baseUrl}}/api/v1/customers/{{customer_id}}</code>");
    expect(html).toContain("Field id equals {{customer_id}} · passed × 9, failed × 1");
    expect(html).toContain("Cut short here");
    expect(html).toContain("customer_id × 2");
  });

  it("shows Once before load steps with outcome and latency apart from the load", () => {
    const html = renderChainReport(runOf(customerLifecyclePlan(), {}));
    expect(html).toContain("<h2>Once before load</h2>");
    expect(html).toContain("31.5");
    expect(html).toContain("Once before load steps not included");
  });

  it("never contains request content: no header value, body or query value of any step", () => {
    const html = renderChainReport(runOf(customerLifecyclePlan(), {}));
    for (const content of ["Bearer {{token}}", '{"name":"Replaced"}', "{{client_secret}}", "page=1", "size=20"]) expect(html).not.toContain(content);
  });

  it("renders a run without measurements, naming the failure", () => {
    const html = renderChainReport(runOf(customerLifecyclePlan(), undefined, { status: "failed", failure: { category: "setup-step-failed" } }));
    expect(html).toContain("Failed · a Once before load step failed");
    expect(html).toContain("This run recorded no measurements");
  });

  it("labels checks by kind and path, never with a literal expected value or body text (US3)", () => {
    const plan = customerLifecyclePlan();
    plan.chains[0].steps[4] = {
      ...plan.chains[0].steps[4],
      checks: [
        { id: "k3", kind: "field-equals", path: "status", expected: { type: "text", value: "LITERAL-EXPECTED-7c1" } },
        { id: "k4", kind: "body-contains", text: "BODY-TEXT-7c1" },
        { id: "k5", kind: "time-at-most", maxMs: 500 },
      ],
    };
    const html = renderChainReport(runOf(plan, { steps: [] }));
    expect(html).toContain("Field status equals a value (set in the plan)");
    expect(html).toContain("Body contains a text (set in the plan)");
    expect(html).toContain("Response time at most 500 ms");
    expect(html).not.toContain("LITERAL-EXPECTED-7c1");
    expect(html).not.toContain("BODY-TEXT-7c1");
  });
});

describe("renderChainReport per-second chart (AP-045 US4)", () => {
  const liveSeries = {
    bucketSeconds: 1,
    points: [
      { second: 0, requests: 4, failures: 0, virtualUsers: 2 },
      { second: 1, requests: 8, failures: 2, virtualUsers: 5 },
      { second: 2, requests: 6, failures: 0, virtualUsers: 5 },
    ],
  };

  it("draws requests/s, failed/s and virtual users from the stored series, distinguishable without colour", () => {
    const html = renderChainReport(runOf(customerLifecyclePlan(), { liveSeries }));
    expect(html).toContain('id="live-series"');
    expect(html).toContain("Requests/s (solid line) · peak 8");
    expect(html).toContain("Failed/s (dashed line)");
    expect(html).toContain("l-fail d2");
    expect(html).toContain("Virtual users · peak 5");
    expect(html).toContain("1 of 3 seconds had failures");
    expect(html).toContain("<details");
    expect(html).toContain("8 requests, 2 failed");
  });

  it("is absent, and the report is unchanged, when the run has no series or no points", () => {
    const plain = renderChainReport(runOf(customerLifecyclePlan(), {}));
    expect(plain).not.toContain("live-series");
    expect(renderChainReport(runOf(customerLifecyclePlan(), { liveSeries: { bucketSeconds: 1, points: [] } }))).toBe(plain);
  });

  it("says points are merged into wider steps and plots requests divided by the step width", () => {
    const html = renderChainReport(runOf(customerLifecyclePlan(), { liveSeries: { bucketSeconds: 2, points: [{ second: 0, requests: 10, failures: 0, virtualUsers: null }, { second: 2, requests: 20, failures: 4, virtualUsers: null }] } }));
    expect(html).toContain("merged into wider steps of 2 seconds");
    expect(html).toContain("Requests/s (solid line) · peak 10");
    expect(html).not.toContain("Virtual users · peak");
  });
});
