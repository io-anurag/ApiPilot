import { describe, expect, it } from "vitest";
import { calculateCoverage } from "../../../src/apiCoverage/calculateCoverage";
import { filterSnapshot } from "../../../src/apiCoverage/filterSnapshot";
import { renderCoverageHtml } from "../../../src/apiCoverage/renderCoverageHtml";
import { baseInput, findScenario, ordersScenarios, scenariosOf, uploadedRun } from "../../fixtures/apiCoverage/coverageFixtures";

const all = ordersScenarios();
const posts = scenariosOf({ method: "POST", path: "/orders" }, all);
const deletes = scenariosOf({ method: "DELETE", path: "/orders/{id}" }, all);

describe("renderCoverageHtml (refined export)", () => {
  const failing = new Set([findScenario(all, "POST", "/orders", "positive-scenario").id]);
  const snapshot = calculateCoverage(
    baseInput({
      uploadedRuns: [
        uploadedRun(deletes, { id: "run-new", startedAt: "2026-10-10T11:00:00.000Z" }),
        uploadedRun(posts, { id: "run-prod", startedAt: "2026-10-10T10:00:00.000Z", failing, collection: { name: "Orders collection", tier: "production" } }),
      ],
    }),
  );
  const html = renderCoverageHtml(snapshot, "All operations (no filter applied)");

  it("states the evidence mode, contributing runs, environment and excluded runs", () => {
    expect(html).toContain("latest qualifying result per scenario from run run-new");
    expect(html).toContain("Environment: Orders collection (local)");
    expect(html).toContain("Excluded: run run-prod (different environment");
    expect(html).toContain("Unattributed results: 0");
  });

  it("includes operation-level counts, category coverage, requirement states and scenario verdicts", () => {
    expect(html).toContain("with passing verification");
    expect(html).toContain("with execution failures");
    expect(html).toContain("Coverage by scenario category");
    expect(html).toContain("Unavailable: No scenario category identifies authorization intent");
    expect(html).toContain("Unclassified (in no category denominator)");
    expect(html).toContain("not executed");
  });

  it("matches the filtered snapshot figures for the chosen scope and escapes text", () => {
    const filtered = filterSnapshot(snapshot, { methods: ["DELETE"] });
    const out = renderCoverageHtml(filtered, "Filtered: method DELETE <script>");
    expect(out).toContain(`Eligible ${filtered.operationCounts.eligible};`);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("POST /orders</td>");
  });

  it("is a single-run export when a run is selected", () => {
    const single = calculateCoverage(baseInput({ uploadedRuns: [uploadedRun(deletes, { id: "only" })], runId: "only" }));
    expect(renderCoverageHtml(single, "x")).toContain("single run only");
  });

  it("carries no request or response content", () => {
    expect(html).not.toMatch(/https?:\/\/|rawCapture|Bearer\s+\S+/);
  });
});
