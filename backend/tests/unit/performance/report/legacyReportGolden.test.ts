import { readFileSync } from "node:fs";
import path from "node:path";
import type { PerformanceRun } from "@apipilot/shared-domain";
import { describe, expect, it } from "vitest";
import { renderHtmlReport } from "../../../../src/performance/report/renderHtmlReport";

/**
 * AP-037 (specs/037-request-chain-performance tasks T094; FR-037, SC-007): a run recorded before
 * request-chain plans keeps its report exactly as rendered before. The stored runs were captured on
 * 2026-10-03 (version 19.18.1) by completing a guided, a quick, a user-journey (AP-035) and a
 * collection (AP-036) run through the legacy routes with the fake runner, before phase two removed
 * those plans; each golden is the HTML the report route served for that run.
 */
const FIXTURES = path.join(__dirname, "..", "..", "..", "fixtures", "performance");

describe.each(["guided", "quick", "user-journeys", "collection"])("legacy %s report", (name) => {
  it("renders byte-identical to the report served before phase two", () => {
    const run = JSON.parse(readFileSync(path.join(FIXTURES, "legacy-runs", `${name}.json`), "utf-8")) as PerformanceRun;
    expect(renderHtmlReport(run)).toBe(readFileSync(path.join(FIXTURES, "golden", "reports", `${name}.html`), "utf-8"));
  });
});
