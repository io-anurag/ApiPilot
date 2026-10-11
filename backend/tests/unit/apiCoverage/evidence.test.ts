import { describe, expect, it } from "vitest";
import { collectEvidence, type EvidenceInput } from "../../../src/apiCoverage/evidence";
import { itemIdForOAuth2TokenFetch } from "../../../src/postman/identifiers";
import { findScenario, guidedRun, ordersScenarios, uploadedRun } from "../../fixtures/apiCoverage/coverageFixtures";

const scenarios = ordersScenarios();
const positive = findScenario(scenarios, "POST", "/orders", "positive-scenario");
const negative = findScenario(scenarios, "POST", "/orders", "required-field-missing", "sku");

function input(over: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    scenarios: new Map(scenarios.map((s) => [s.id, s])),
    uploadedRuns: [],
    guidedRuns: [],
    workflowId: "wf-1",
    infrastructureItemIds: new Set(),
    ...over,
  };
}

describe("collectEvidence (uploaded runs)", () => {
  it("joins results to scenarios by item id and recovers each assertion from the test names", () => {
    const result = collectEvidence(input({ uploadedRuns: [uploadedRun([positive])] }));
    const evidence = result.byScenario.get(positive.id);
    expect(evidence?.runKind).toBe("uploaded");
    expect(evidence?.checks).toEqual([
      { kind: "status-code", expectedStatusCode: "201", outcome: "passed" },
      { kind: "schema-conformance", outcome: "passed" },
    ]);
    expect(result.unattributedResults).toBe(0);
  });

  it("records a failed test as a failed check", () => {
    const result = collectEvidence(input({ uploadedRuns: [uploadedRun([positive], { failing: new Set([positive.id]) })] }));
    const evidence = result.byScenario.get(positive.id);
    expect(evidence?.outcome).toBe("failed");
    expect(evidence?.checks[0].outcome).toBe("failed");
  });

  it("does not treat a not-attempted result as evidence", () => {
    const result = collectEvidence(input({ uploadedRuns: [uploadedRun([positive], { notAttempted: new Set([positive.id]) })] }));
    expect(result.byScenario.size).toBe(0);
    expect(result.runIds).toEqual([]);
  });

  it("marks tests that produced no result as not evaluated", () => {
    const result = collectEvidence(input({ uploadedRuns: [uploadedRun([positive], { noTests: new Set([positive.id]) })] }));
    expect(result.byScenario.get(positive.id)?.checks.every((c) => c.outcome === "not-evaluated")).toBe(true);
  });

  it("flags an edited request and a missing response", () => {
    const edited = collectEvidence(input({ uploadedRuns: [uploadedRun([positive], { edited: new Set([positive.id]) })] }));
    expect(edited.byScenario.get(positive.id)?.edited).toBe(true);
    expect(edited.editedResults).toBe(1);
    const offline = collectEvidence(input({ uploadedRuns: [uploadedRun([positive], { noResponse: new Set([positive.id]) })] }));
    expect(offline.byScenario.get(positive.id)?.noResponse).toBe(true);
  });

  it("counts results that join to no current scenario instead of using them", () => {
    const other = { ...positive, id: "from-an-earlier-specification" };
    const result = collectEvidence(input({ uploadedRuns: [uploadedRun([other, positive])] }));
    expect(result.unattributedResults).toBe(1);
    expect([...result.byScenario.keys()]).toEqual([positive.id]);
  });

  it("does not count generated infrastructure requests as unattributed", () => {
    const run = uploadedRun([positive]);
    run.results.push({ ...run.results[0], itemId: itemIdForOAuth2TokenFetch("bearer") });
    const result = collectEvidence(input({ uploadedRuns: [run], infrastructureItemIds: new Set([itemIdForOAuth2TokenFetch("bearer")]) }));
    expect(result.unattributedResults).toBe(0);
  });

  it("uses the latest qualifying result per scenario across runs, not the sum", () => {
    const early = uploadedRun([positive], { id: "run-a", startedAt: "2026-10-10T09:00:00.000Z", failing: new Set([positive.id]) });
    const late = uploadedRun([positive], { id: "run-b", startedAt: "2026-10-10T10:00:00.000Z" });
    const result = collectEvidence(input({ uploadedRuns: [early, late] }));
    expect(result.byScenario.size).toBe(1);
    expect(result.byScenario.get(positive.id)?.runId).toBe("run-b");
    expect(result.runIds).toEqual(["run-b"]);
    expect(result.evidenceByRun).toEqual([{ runId: "run-b", scenarios: 1 }]);
  });

  it("evaluates one selected run when asked", () => {
    const early = uploadedRun([positive], { id: "run-a", startedAt: "2026-10-10T09:00:00.000Z", failing: new Set([positive.id]) });
    const late = uploadedRun([positive], { id: "run-b", startedAt: "2026-10-10T10:00:00.000Z" });
    const result = collectEvidence(input({ uploadedRuns: [early, late], runId: "run-a" }));
    expect(result.byScenario.get(positive.id)?.runId).toBe("run-a");
    expect(result.selectedRunId).toBe("run-a");
  });

  it("carries no request or response content", () => {
    const run = uploadedRun([positive]);
    run.results[0].rawCapture = {
      requestUrl: "https://secret.example/?token=abc",
      requestHeaders: [{ name: "Authorization", value: "Bearer abc" }],
      responseHeaders: [],
      responseBody: "super-secret",
    };
    const result = collectEvidence(input({ uploadedRuns: [run] }));
    expect(JSON.stringify([...result.byScenario.values()])).not.toMatch(/secret|Bearer|abc/);
  });
});

describe("collectEvidence (guided runs)", () => {
  it("joins by scenario id and keeps the assertion type and expected code by index", () => {
    const result = collectEvidence(input({ guidedRuns: [guidedRun([positive, negative], { failing: new Set([negative.id]) })] }));
    expect(result.byScenario.get(positive.id)?.checks[0]).toEqual({ kind: "status-code", expectedStatusCode: "201", outcome: "passed" });
    expect(result.byScenario.get(negative.id)?.checks[0].outcome).toBe("failed");
    // Name and tier only: the base URL is never carried into coverage output (FR-036).
    expect(result.environment).toEqual({ name: "Staging", tier: "staging" });
  });

  it("ignores runs of another workflow", () => {
    const run = { ...guidedRun([positive]), workflowId: "someone-else" };
    expect(collectEvidence(input({ guidedRuns: [run] })).byScenario.size).toBe(0);
  });

  it("counts an unknown scenario id as unattributed", () => {
    const run = guidedRun([{ ...positive, id: "unknown" }]);
    expect(collectEvidence(input({ guidedRuns: [run] })).unattributedResults).toBe(1);
  });
});
