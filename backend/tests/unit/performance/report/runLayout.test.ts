import { describe, expect, it } from "vitest";
import { analyzeChainPlan, type ChainPlan, type ChainRun } from "@apipilot/shared-domain";
import { createAggregate } from "../../../../src/performance/report/aggregate";
import { deriveFindings } from "../../../../src/performance/report/findings";
import { layoutFromChainSnapshot } from "../../../../src/performance/report/runLayout";
import { chainRunSnapshot } from "../../../../src/performance/chain/runSnapshot";
import { planFingerprint } from "../../../../src/performance/chain/savePlan";
import { parseMetricsLine } from "../../../../src/performance/k6/metricsStream";
import { counter, httpReq, sample, STREAM_START_MS, vus } from "../../../fixtures/performance/ndjson";
import { customerLifecyclePlan } from "../../../fixtures/chain/chainPlans";

/** AP-037 (specs/037-request-chain-performance tasks T026; research R19). */

function snapshotOf(plan: ChainPlan) {
  const fingerprinted = { ...plan, fingerprint: planFingerprint(plan) };
  return chainRunSnapshot(fingerprinted, analyzeChainPlan(fingerprinted, { environmentValueNames: null }));
}

function aggregateOf(plan: ChainPlan, lines: string[]) {
  const aggregate = createAggregate(layoutFromChainSnapshot(snapshotOf(plan)), 60_000, STREAM_START_MS);
  for (const line of lines.flat()) {
    const parsed = parseMetricsLine(line);
    if (parsed.kind === "point") aggregate.ingest(parsed.point);
  }
  return aggregate;
}

describe("layoutFromChainSnapshot", () => {
  it("maps chains to journeys with their iteration steps, and lists setup steps, data sets and labels apart", () => {
    const plan = customerLifecyclePlan({ dataSets: [{ id: "d1", name: "c", mode: "row-per-iteration", columns: [{ name: "x", secret: false }], rowCount: 50, sizeBytes: 1, sha256: "a" }] });
    const layout = layoutFromChainSnapshot(snapshotOf(plan));
    expect(layout.journeys.map((journey) => [journey.id, journey.steps.map((step) => step.stepId)])).toEqual([["c1", ["s2", "s3", "s4", "s5", "s6", "s7"]]]);
    expect(layout.journeys[0].steps[0]).toMatchObject({ operationKey: "s2", method: "POST", expected: [{ code: "201", source: "user" }], captureNames: ["customer_id"] });
    expect(layout.journeys[0].steps[3].checks).toEqual([{ id: "k3", kind: "field-equals" }]);
    expect(layout.setupStepIds).toEqual(["s1"]);
    expect(layout.dataSets).toEqual([{ id: "d1", rowCount: 50 }]);
    expect(layout.stepLabels?.s2).toBe("POST Create a customer");
  });
});

describe("createAggregate with a chain layout", () => {
  it("keeps setup and refresh requests out of the load, and records setup outcome, extractors, checks, cut short, refreshes and data takes", () => {
    const plan = customerLifecyclePlan({ dataSets: [{ id: "d1", name: "c", mode: "row-per-iteration", columns: [{ name: "x", secret: false }], rowCount: 2, sizeBytes: 1, sha256: "a" }] });
    const aggregate = aggregateOf(plan, [
      vus(1, 0),
      sample("http_reqs", 1, { apipilot_kind: "setup", setup_step: "s1", status: "200", method: "POST" }, 10),
      sample("http_req_duration", 25.555, { apipilot_kind: "setup", setup_step: "s1", status: "200", method: "POST" }, 10),
      counter("apipilot_setup", { setup_step: "s1", outcome: "ok", reason: "" }, 20),
      ...httpReq({ step: "s2", journey: "c1", status: 201, method: "POST", durationMs: 40, atMs: 6_000 }),
      counter("apipilot_capture", { step: "s2", journey: "c1", capture: "customer_id", outcome: "failed" }, 6_010),
      counter("apipilot_cut_short", { step: "s2", journey: "c1", capture: "customer_id" }, 6_010),
      ...httpReq({ step: "s5", journey: "c1", status: 200, method: "GET", durationMs: 10, atMs: 7_000 }),
      counter("apipilot_check", { step: "s5", journey: "c1", check: "k3", outcome: "failed" }, 7_010),
      counter("apipilot_check", { step: "s5", journey: "c1", check: "k3", outcome: "passed" }, 7_020),
      sample("http_reqs", 1, { apipilot_kind: "token-refresh", setup_step: "s1", status: "200", method: "POST" }, 8_000),
      counter("apipilot_token_refresh", { setup_step: "s1", outcome: "ok" }, 8_000),
      counter("apipilot_data", { dataset: "0", outcome: "take" }, 6_000),
      counter("apipilot_data", { dataset: "0", outcome: "take" }, 6_000),
      counter("apipilot_data", { dataset: "0", outcome: "wrap" }, 6_000),
    ]);
    const result = aggregate.toResult(STREAM_START_MS + 60_000);
    expect(result.totals.requests).toBe(2);
    expect(result.setupSteps).toEqual([{ stepId: "s1", outcome: "ok", reason: null, latencyMs: 25.56 }]);
    expect(result.steps[0].captures).toEqual([{ name: "customer_id", succeeded: 0, failed: 1 }]);
    expect(result.steps[3].checks).toEqual([{ checkId: "k3", kind: "field-equals", passed: 1, failed: 1 }]);
    expect(result.journeys[0]).toMatchObject({ journeyId: "c1", runsCutShort: 1, cutShortAtStepId: "s2", cutShortByCapture: { customer_id: 1 } });
    expect(result.tokenRefreshes).toMatchObject({ count: 1, failed: 0, bySetupStep: [{ stepId: "s1", refreshed: 1, failed: 0 }] });
    expect(result.dataSets).toEqual([{ dataSetId: "d1", takes: 3, rowsUsed: 2, wrapped: true }]);
    expect(aggregate.setupFailure()).toBeNull();
  });

  it("reports the first failed setup step, and adds no chain field for a plan without setup steps or data sets", () => {
    const failing = aggregateOf(customerLifecyclePlan(), [counter("apipilot_setup", { setup_step: "s1", outcome: "failed", reason: "extractor:token" }, 10)]);
    expect(failing.setupFailure()).toEqual({ stepId: "s1", reason: "extractor:token" });
    const plain = customerLifecyclePlan();
    plain.chains[0].steps = plain.chains[0].steps.slice(1).map((step) => ({ ...step, headers: [] }));
    const result = aggregateOf(plain, [vus(1, 0)]).toResult(STREAM_START_MS + 60_000);
    expect(result.setupSteps).toEqual([]);
    expect(result.dataSets).toEqual([]);
    expect(result.tokenRefreshes).not.toHaveProperty("bySetupStep");
  });

  it("names chain steps in findings by method and name", () => {
    const plan = customerLifecyclePlan({ thresholds: [{ id: "t1", scope: { kind: "step", stepId: "s5" }, metric: "p95", comparator: "<=", limit: 5 }] });
    const layout = layoutFromChainSnapshot(snapshotOf(plan));
    const result = aggregateOf(plan, [...httpReq({ step: "s5", journey: "c1", status: 200, method: "GET", durationMs: 50, atMs: 1_000 })]).toResult(STREAM_START_MS + 60_000);
    const findings = deriveFindings({ ...result, thresholdOutcomes: [{ thresholdId: "t1", measured: 50, passed: false }] }, layout);
    expect(findings[0].message).toContain("GET Get the customer");
  });
});

describe("ChainRun type", () => {
  it("is what the snapshot builder produces for the US1 plan", () => {
    const snapshot: ChainRun["snapshot"] = snapshotOf(customerLifecyclePlan());
    expect(snapshot.chains[0].steps[4].checks).toEqual([{ id: "k3", kind: "field-equals", path: "id", maxMs: null, reference: "customer_id" }]);
    expect(snapshot.chains[0].steps[0].source).toEqual({ kind: "added", label: null });
    expect(snapshot.hosts).toEqual(["{{baseUrl}}"]);
  });
});
