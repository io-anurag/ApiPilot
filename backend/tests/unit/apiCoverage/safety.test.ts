import type { ApiModel, TestScenario } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { calculateCoverage } from "../../../src/apiCoverage/calculateCoverage";
import { filterSnapshot } from "../../../src/apiCoverage/filterSnapshot";
import { asCoverageScenarios, baseInput, findScenario, guidedRun, ordersApiModel, ordersScenarios, scenariosOf, uploadedRun } from "../../fixtures/apiCoverage/coverageFixtures";

const all = ordersScenarios();

describe("coverage records never carry sensitive content (FR-036)", () => {
  it("excludes headers, bodies, URLs and raw captures from the snapshot", () => {
    const run = uploadedRun(all);
    for (const result of run.results) {
      result.rawCapture = {
        requestUrl: "https://internal.example/orders?api_key=SECRET-KEY-123",
        requestHeaders: [{ name: "Authorization", value: "Bearer SECRET-TOKEN-456" }],
        requestBody: '{"password":"SECRET-PASSWORD-789"}',
        responseHeaders: [{ name: "Set-Cookie", value: "session=SECRET-COOKIE-000" }],
        responseBody: '{"ssn":"SECRET-BODY-111"}',
      };
      result.testOutcomes = result.testOutcomes.map((t) => ({ ...t, detail: "expected SECRET-DETAIL-222 to equal 201" }));
    }
    const snapshot = calculateCoverage(baseInput({ uploadedRuns: [run] }));
    const serialized = JSON.stringify(filterSnapshot(snapshot, {}));
    expect(serialized).not.toMatch(/SECRET/);
  });

  it("does not echo generated request values", () => {
    const withSecretValue: TestScenario[] = all.map((s) => ({
      ...s,
      request: { ...s.request, headers: { Authorization: "Bearer SECRET-GENERATED" } },
    }));
    const snapshot = calculateCoverage(baseInput({ scenarios: asCoverageScenarios(withSecretValue), uploadedRuns: [uploadedRun(withSecretValue)] }));
    expect(JSON.stringify(snapshot)).not.toMatch(/SECRET/);
  });
});

describe("refined records stay free of sensitive content and deterministic (SC-005, FR-036)", () => {
  const posts = scenariosOf({ method: "POST", path: "/orders" }, all);
  const deletes = scenariosOf({ method: "DELETE", path: "/orders/{id}" }, all);
  const mixedInput = () => {
    const happy = findScenario(all, "POST", "/orders", "positive-scenario");
    const target = findScenario(all, "DELETE", "/orders/{id}", "positive-scenario");
    return baseInput({
      uploadedRuns: [
        uploadedRun(posts, { id: "a", startedAt: "2026-10-10T09:00:00.000Z", schemaFailing: new Set([happy.id]), timeout: new Set([posts[1].id]), edited: new Set([posts[2].id]) }),
        uploadedRun(posts, { id: "b", startedAt: "2026-10-10T10:00:00.000Z", collection: { name: "Elsewhere", tier: "production" } }),
      ],
      guidedRuns: [guidedRun([target], { id: "g", startedAt: "2026-10-10T11:00:00.000Z", notAttempted: new Map([[target.id, "dependency-not-met"]]) })],
    });
  };

  it("never carries a base URL, headers, bodies or tokens in causes, runs, environments or scenarios", () => {
    const snapshot = calculateCoverage(mixedInput());
    const serialized = JSON.stringify(filterSnapshot(snapshot, {}));
    expect(serialized).not.toMatch(/example\.test|https?:\/\/|SECRET|Bearer\s|rawCapture|api_key/);
    expect(snapshot.execution.environments.every((e) => Object.keys(e).sort().join() === "name,tier")).toBe(true);
    expect(snapshot.scenarios.every((s) => !("request" in s))).toBe(true);
  });

  it("gives byte-identical output for identical input apart from the calculation time", () => {
    const strip = (s: ReturnType<typeof calculateCoverage>) => JSON.stringify({ ...s, calculatedAt: "" });
    const first = calculateCoverage(mixedInput());
    expect(strip(calculateCoverage(mixedInput()))).toBe(strip(first));
    expect(strip(filterSnapshot(first, { category: "negative" }))).toBe(strip(filterSnapshot(first, { category: "negative" })));
    expect(deletes.length).toBeGreaterThan(0);
  });
});

describe("coverage at scale (SC-006)", () => {
  const big: ApiModel = {
    ...ordersApiModel,
    operations: Array.from({ length: 500 }, (_, i) => ({
      ...structuredClone(ordersApiModel.operations[0]),
      path: `/resource-${i}`,
      method: i % 2 === 0 ? "POST" : "PUT",
    })),
    summary: { ...ordersApiModel.summary, operationCount: 500 },
  };

  it("calculates 500 operations with their scenarios and runs well inside the budget", () => {
    const scenarios = ordersScenarios(big);
    expect(scenarios.length).toBeGreaterThan(5000);
    const started = performance.now();
    const snapshot = calculateCoverage(baseInput({ apiModel: big, scenarios: asCoverageScenarios(scenarios), uploadedRuns: [uploadedRun(scenarios)] }));
    const elapsed = performance.now() - started;
    expect(snapshot.operations).toHaveLength(500);
    expect(elapsed).toBeLessThan(3000);
  });

  it("filters and sorts the large snapshot quickly", () => {
    const scenarios = ordersScenarios(big);
    const snapshot = calculateCoverage(baseInput({ apiModel: big, scenarios: asCoverageScenarios(scenarios) }));
    const started = performance.now();
    filterSnapshot(snapshot, { methods: ["POST"], sort: "path", order: "desc" });
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
