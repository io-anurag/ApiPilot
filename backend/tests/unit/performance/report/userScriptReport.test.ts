import { describe, expect, it } from "vitest";
import type { UserScriptRun, UserScriptThreshold } from "@apipilot/shared-domain";
import { parseMetricsLine } from "../../../../src/performance/k6/metricsStream";
import { renderUserScriptReport, USER_SCRIPT_PROVENANCE } from "../../../../src/performance/report/renderUserScriptReport";
import { createUserScriptAggregate } from "../../../../src/performance/report/userScriptAggregate";
import { deriveUserScriptFindings, withUserScriptReportFields } from "../../../../src/performance/report/userScriptFindings";
import { evaluateUserScriptThresholds, scriptThresholdsOutcome } from "../../../../src/performance/report/userScriptThresholds";
import { basicLines, unnamedManyLines, USER_STREAM_START_MS } from "../../../fixtures/userScripts/ndjsonBuilder";

/** AP-034 FR-028, FR-030 to FR-036 (research R15, R16; tasks T024, T048). */

const THRESHOLDS: UserScriptThreshold[] = [
  { id: "t_run_p95", scope: { kind: "run" }, metric: "p95", comparator: "<=", limit: 1_000 },
  { id: "t_post_err", scope: { kind: "request-name", name: "POST /orders" }, metric: "error-rate", comparator: "<=", limit: 5 },
  { id: "t_missing", scope: { kind: "request-name", name: "GET /nothing" }, metric: "p50", comparator: "<=", limit: 10 },
];

function runWith(lines: string[], overrides: Partial<UserScriptRun> = {}, exitCode: number | null = 99): UserScriptRun {
  const aggregator = createUserScriptAggregate({ plannedDurationMs: null, startedAtMs: USER_STREAM_START_MS });
  for (const line of lines) aggregator.add(parseMetricsLine(line, { acceptAllMetrics: true }));
  const base: UserScriptRun = {
    id: "0f1e2d3c-0000-4000-8000-000000000001",
    source: "user-script",
    status: "completed",
    environment: { id: "e1", name: "Local stub", tier: "local", baseUrl: "http://127.0.0.1:4600" },
    snapshot: {
      scriptId: "s1",
      scriptName: "Orders <script>",
      scriptSha256: "a".repeat(64),
      load: { kind: "script" },
      mapping: [
        { name: "BASE_URL", source: { kind: "base-url" } },
        { name: "API_KEY", source: { kind: "environment-value", valueName: "API_KEY" } },
      ],
      thresholds: THRESHOLDS,
      hostsFound: [],
    },
    k6Version: "1.2.0",
    k6ExitCode: exitCode,
    exitMeaning: exitCode === 99 ? "script-thresholds-crossed" : "completed",
    plannedDurationMs: null,
    startedAt: new Date(USER_STREAM_START_MS).toISOString(),
    endedAt: new Date(USER_STREAM_START_MS + 10_000).toISOString(),
    cancelRequested: false,
    ...overrides,
  };
  return { ...base, result: withUserScriptReportFields(aggregator.toResult(USER_STREAM_START_MS + 10_000), base, exitCode) };
}

describe("ApiPilot and script thresholds (FR-028, FR-035)", () => {
  it("evaluates run and request-name thresholds, and fails one with nothing measured", () => {
    const run = runWith(basicLines());
    expect(evaluateUserScriptThresholds(THRESHOLDS, run.result!)).toEqual([
      { thresholdId: "t_run_p95", measured: expect.any(Number), passed: true },
      { thresholdId: "t_post_err", measured: 20, passed: false },
      { thresholdId: "t_missing", measured: null, passed: false },
    ]);
  });

  it("gives k6's outcome for the script's own thresholds", () => {
    const result = runWith(basicLines()).result!;
    expect(scriptThresholdsOutcome(99, result)).toBe("crossed");
    expect(scriptThresholdsOutcome(0, result)).toBe("not-crossed");
    expect(scriptThresholdsOutcome(null, result)).toBe("not-evaluated");
    expect(scriptThresholdsOutcome(99, { ...result, scriptThresholds: [] })).toBe("none-defined");
  });
});

describe("findings (FR-036)", () => {
  it("covers each rule in a fixed order, and gives the same findings for the same data", () => {
    const run = runWith(unnamedManyLines().concat(basicLines()), { exitMeaning: "aborted-by-script" });
    const ids = run.result!.findings.map((finding) => finding.ruleId);
    expect(ids).toEqual(["apipilot-threshold-failed", "script-thresholds-crossed", "slowest-request", "failures-start", "most-frequent-failing-status", "names-combined", "hosts-outside-environment", "script-ended-run"]);
    expect(JSON.stringify(deriveUserScriptFindings(run.result!, run))).toBe(JSON.stringify(deriveUserScriptFindings(run.result!, run)));
  });
});

describe("renderUserScriptReport (FR-030 to FR-036)", () => {
  it("states provenance, configuration and every measured section", () => {
    const html = renderUserScriptReport(runWith(basicLines()));
    for (const text of [
      USER_SCRIPT_PROVENANCE,
      "Load was generated from the machine running the ApiPilot backend.",
      "a".repeat(64),
      "Local stub",
      "Tier: local",
      "http://127.0.0.1:4600",
      "v1.2.0",
      "The script&#39;s own load settings",
      "BASE_URL",
      "environment base URL",
      "API_KEY",
      "Hosts that received requests",
      "203.0.113.10",
      "(address; named requests)",
      "What the run changed on the target",
      "list is 200",
      "::orders",
      "order_latency",
      "Thresholds defined in the script",
      "p(95)&lt;500",
      "Crossed",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("Orders &lt;script&gt;");
  });

  it("is self-contained and byte-identical when rendered twice", () => {
    const run = runWith(basicLines());
    const html = renderUserScriptReport(run);
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<(link|img|iframe)\b/i);
    expect(html).not.toMatch(/(src|href)="https?:/i);
    expect(renderUserScriptReport(run)).toBe(html);
  });

  it("shows no journey, step, scenario or expected-status wording (FR-031)", () => {
    const html = renderUserScriptReport(runWith(basicLines())).toLowerCase();
    for (const word of ["journey", "scenario", "expected status", "by step"]) expect(html).not.toContain(word);
  });

  it("combines names beyond 100 with the naming hint, and never shows a query string or user info", () => {
    const html = renderUserScriptReport(runWith(unnamedManyLines(), {}, 0));
    expect(html).toContain("30 request names beyond the first 100");
    expect(html).toContain("tags: { name:");
    for (const fragment of ["token=abc", "user:pw", "#frag"]) expect(html).not.toContain(fragment);
  });

  it("renders a failed run with no measurements without its k6 message", () => {
    const html = renderUserScriptReport({ ...runWith([]), status: "failed", failure: { category: "k6-exited-with-error", k6Message: "SECRET-k6-text" }, result: undefined });
    expect(html).toContain("recorded no request measurements");
    expect(html).not.toContain("SECRET-k6-text");
  });

  it("adds the per-second chart (and its own styles) only when the run has a stored series (AP-045 US4)", () => {
    const base = runWith(basicLines());
    const plain = renderUserScriptReport(base);
    expect(plain).not.toContain("live-series");
    const series = { bucketSeconds: 1, points: [{ second: 0, requests: 3, failures: 0, virtualUsers: 1 }, { second: 1, requests: 5, failures: 1, virtualUsers: 2 }] };
    const html = renderUserScriptReport({ ...base, result: { ...base.result!, liveSeries: series } });
    expect(html).toContain('class="live-series"');
    expect(html).toContain("Requests/s (solid line) · peak 5");
    expect(html).toContain("1 of 2 seconds had failures");
    // The figures drawn are the stored ones: hover text and the table carry each point's counts.
    expect(html).toContain("00:00–00:01 · 3 requests, 0 failed");
    expect(html).toContain("00:01–00:02 · 5 requests, 1 failed");
    expect(html).toContain('<td class="num">00:01</td><td class="num">5</td><td class="num">1</td><td class="num">5</td><td class="num">2</td>');
    expect(html.match(/\.live-series\{--ls-rate/g)).toHaveLength(2);
  });
});
