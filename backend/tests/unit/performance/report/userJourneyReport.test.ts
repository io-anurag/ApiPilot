import type { PerformanceJourney, PerformanceResult } from "@apipilot/shared-domain";
import { PERFORMANCE_FINDINGS_RULESET_VERSION } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { parseMetricsLine, type MetricsPoint } from "../../../../src/performance/k6/metricsStream";
import { createAggregate } from "../../../../src/performance/report/aggregate";
import { deriveFindings } from "../../../../src/performance/report/findings";
import { renderHtmlReport } from "../../../../src/performance/report/renderHtmlReport";
import { bindingFixture, captureFixture, planFixture, runFixture, SEEDED_CAPTURED_ID, stepFixture } from "../../../fixtures/performance/builders";
import { counter, httpReq, STREAM_START_MS } from "../../../fixtures/performance/ndjson";

/** AP-035 FR-025, FR-029 (specs/035-user-defined-journeys research R13; tasks T021). */

const create = stepFixture({
  id: "s-create",
  operationKey: "POST /api/v1/customers",
  method: "POST",
  path: "/api/v1/customers",
  expectedStatuses: [{ code: "201", source: "specification" }],
  produces: ["customer_id"],
  captures: [captureFixture(), captureFixture({ name: "customer_url", source: { kind: "header", name: "location" }, documented: null })],
  userDefined: true,
});
const replace = stepFixture({
  id: "s-replace",
  operationKey: "PUT /api/v1/customers/{id}",
  method: "PUT",
  path: "/api/v1/customers/{id}",
  consumes: ["customer_id"],
  variableBindings: [{ variable: "customer_id", role: "consumes", field: "id", location: "path", producerStepId: "s-create" }],
  bindings: [bindingFixture({ captureStepId: "s-create" })],
  userDefined: true,
});
const lifecycle: PerformanceJourney = { id: "j-user", source: { kind: "user", userJourneyId: "j-user", name: "Customer lifecycle" }, steps: [create, replace] };
const incomplete: PerformanceJourney = {
  id: "j-incomplete",
  source: { kind: "user", userJourneyId: "j-incomplete", name: "Half" },
  steps: [stepFixture({ id: "s-half", userDefined: true })],
  incompleteReason: { missingOperationKeys: ["DELETE /api/v1/customers/{id}"] },
};
const plan = planFixture({ journeys: [lifecycle, incomplete] });

function points(lines: string[]): MetricsPoint[] {
  return lines.flatMap((line) => {
    const parsed = parseMetricsLine(line);
    return parsed.kind === "point" ? [parsed.point] : [];
  });
}

function aggregateOf(lines: string[]): PerformanceResult {
  const aggregate = createAggregate(plan, 60_000, STREAM_START_MS);
  for (const point of points(lines)) aggregate.ingest(point);
  return aggregate.toResult(STREAM_START_MS + 60_000);
}

const capture = (name: string, outcome: "ok" | "failed", atMs: number) => counter("apipilot_capture", { step: "s-create", journey: "j-user", capture: name, outcome }, atMs);
const cutShort = (name: string, atMs: number) => counter("apipilot_cut_short", { step: "s-create", journey: "j-user", capture: name }, atMs);

describe("aggregating captures", () => {
  const result = aggregateOf([
    ...httpReq({ step: "s-create", journey: "j-user", status: 201, method: "POST", durationMs: 10, atMs: 1000 }),
    capture("customer_id", "ok", 1000),
    capture("customer_url", "ok", 1000),
    capture("customer_id", "failed", 2000),
    capture("customer_url", "ok", 2000),
    cutShort("customer_id", 2000),
    capture("customer_url", "failed", 3000),
    cutShort("customer_url", 3000),
    capture("customer_id", "failed", 4000),
    cutShort("customer_id", 4000),
  ]);

  it("counts each capture's successes and failures, in the step's capture order", () => {
    expect(result.steps.find((step) => step.stepId === "s-create")!.captures).toEqual([
      { name: "customer_id", succeeded: 1, failed: 2 },
      { name: "customer_url", succeeded: 2, failed: 1 },
    ]);
    expect(result.steps.find((step) => step.stepId === "s-replace")!.captures).toBeUndefined();
  });

  it("counts journeys cut short per capture, and leaves an incomplete journey out of the result (FR-025)", () => {
    expect(result.journeys.map((journey) => journey.journeyId)).toEqual(["j-user"]);
    expect(result.journeys[0]).toMatchObject({ runsCutShort: 3, cutShortByCapture: { customer_id: 2, customer_url: 1 } });
    expect(result.steps.some((step) => step.stepId === "s-half")).toBe(false);
  });

  it("names the capture that cut the most journeys short, ties by name, under ruleset 2 (FR-029)", () => {
    expect(PERFORMANCE_FINDINGS_RULESET_VERSION).toBe(2);
    const [finding] = deriveFindings(result, plan).filter((entry) => entry.ruleId === "cut-short-journeys");
    expect(finding.values.capture).toBe("customer_id");
    expect(finding.message).toContain("returned no value for customer_id to pass on");
    const tie = { ...result, journeys: [{ ...result.journeys[0], cutShortByCapture: { zeta: 1, alpha: 1 } }] };
    expect(deriveFindings(tie, plan).find((entry) => entry.ruleId === "cut-short-journeys")!.values.capture).toBe("alpha");
  });

  it("keeps the message of a run recorded before AP-035", () => {
    const older = { ...result, journeys: [{ ...result.journeys[0], cutShortByCapture: undefined }] };
    const [finding] = deriveFindings(older, plan).filter((entry) => entry.ruleId === "cut-short-journeys");
    expect(finding.message).toContain("returned no value to pass on.");
    expect(finding.values.capture).toBeUndefined();
  });
});

describe("the report of a plan with a user-defined journey", () => {
  const result = aggregateOf([...httpReq({ step: "s-create", journey: "j-user", status: 201, method: "POST", durationMs: 10, atMs: 1000 }), capture("customer_id", "ok", 1000)]);
  const html = renderHtmlReport(runFixture({ status: "completed", planSnapshot: plan, result: { ...result, findings: deriveFindings(result, plan) } }));

  it("states each bound value's capture, producing step and source, and each capture's counts", () => {
    expect(html).toContain("path id ← captured customer_id, from POST /api/v1/customers (response field id)");
    expect(html).toContain("customer_id ← response field id (captured × 1, failed × 0)");
    expect(html).toContain("customer_url ← response header location");
  });

  it("says the step is in a journey defined by you, and has no step of the incomplete journey", () => {
    expect(html).toContain("In a journey defined by you: Customer lifecycle");
    expect(html).not.toContain("s-half");
  });

  it("never contains a captured value", () => {
    expect(html).not.toContain(SEEDED_CAPTURED_ID);
  });
});
