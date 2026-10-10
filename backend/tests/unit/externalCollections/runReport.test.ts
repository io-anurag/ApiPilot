import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { UploadedCollectionExecutionRun, UploadedRequestResult } from "@apipilot/shared-domain";
import { buildRunInsights, buildRunReportModel, formatReportTime, reportFileName } from "../../../src/externalCollections/runReport";
import { CHART_BOX, escapeHtml, renderRunReportHtml } from "../../../src/externalCollections/runReportHtml";
import { pdfChartBox, renderRunReportPdf, toPdfText } from "../../../src/externalCollections/runReportPdf";
import { NO_REQUESTS_NOTE, buildSeriesChart, layoutSeriesChart } from "../../../src/externalCollections/runSeriesChart";

function result(overrides: Partial<UploadedRequestResult> = {}): UploadedRequestResult {
  return {
    requestName: "Get widget",
    requestMethod: "get",
    outcome: "passed",
    startedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 12,
    responseStatusCode: 200,
    testOutcomes: [{ name: "Status is 200", outcome: "passed" }],
    ...overrides,
  };
}

function run(results: UploadedRequestResult[], overrides: Partial<UploadedCollectionExecutionRun> = {}): UploadedCollectionExecutionRun {
  const failed = results.filter((entry) => entry.outcome === "failed").length;
  const notAttempted = results.filter((entry) => entry.outcome === "not-attempted").length;
  return {
    id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    source: "uploaded",
    uploadedCollectionSetId: "uc-1",
    uploadedCollectionSnapshot: { name: "My collection", tier: "local" },
    status: "completed",
    startedAt: "2026-01-01T10:00:00.000Z",
    completedAt: "2026-01-01T10:00:02.000Z",
    summary: { total: results.length, passed: results.length - failed - notAttempted, failed, notAttempted, durationMs: 2000 },
    results,
    cancelRequested: false,
    ...overrides,
  };
}

/** The width of a card's content in the PDF (A4 595 less 48 margins and 12 padding on each side). */
const CONTENT_WIDTH_PDF = 595 - 96 - 24;
const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page(?!s)/g) ?? []).length;

describe("buildRunReportModel", () => {
  it("states every outcome as a word, with the reason for a failure or a skipped request", () => {
    const model = buildRunReportModel(
      run([
        result(),
        result({ requestName: "Bad", outcome: "failed", failureCategory: "assertion-failed", responseStatusCode: 500, testOutcomes: [{ name: "Is ok", outcome: "failed", detail: "expected 500 to equal 200\nat line 3" }] }),
        result({ requestName: "Skipped", outcome: "not-attempted", notAttemptedReason: "cancelled", durationMs: 0, responseStatusCode: undefined, testOutcomes: [] }),
      ]),
    );
    expect(model.rows.map((row) => [row.position, row.method, row.outcome, row.reason])).toEqual([
      [1, "GET", "Passed", undefined],
      [2, "GET", "Failed", "Assertion failed"],
      [3, "GET", "Not attempted", "Cancelled"],
    ]);
    expect(model.rows[1].failedTests).toEqual([{ name: "Is ok", detail: "expected 500 to equal 200" }]);
    expect(model.rows[0].passedTestCount).toBe(1);
    expect(model.statusLabel).toBe("Completed");
  });

  it("never carries request or response headers or bodies, or anything beyond the recorded names", () => {
    const secret = "SECRET-BEARER-TOKEN-123";
    const model = buildRunReportModel(
      run([
        result({
          rawCapture: {
            requestUrl: "https://x.test/a",
            requestHeaders: [{ key: "Authorization", value: `Bearer ${secret}` }],
            requestBody: `{"password":"${secret}"}`,
            responseHeaders: [{ key: "Set-Cookie", value: secret }],
            responseBody: secret,
          } as UploadedRequestResult["rawCapture"],
        }),
      ]),
    );
    expect(JSON.stringify(model)).not.toContain(secret);
    expect(JSON.stringify(model)).not.toContain("Authorization");
  });

  it("flags an edited request and truncates a very long failure message to one line", () => {
    const long = "x".repeat(500);
    const model = buildRunReportModel(
      run([result({ wasEdited: true, outcome: "failed", failureCategory: "assertion-failed", testOutcomes: [{ name: "t", outcome: "failed", detail: long }] })]),
    );
    expect(model.rows[0].edited).toBe(true);
    expect(model.rows[0].failedTests[0].detail?.length).toBeLessThanOrEqual(240);
    expect(model.rows[0].failedTests[0].detail?.endsWith("…")).toBe(true);
  });
});

describe("report helpers", () => {
  it("formats times in a fixed zone and names the file in ASCII", () => {
    expect(formatReportTime("2026-10-10T14:25:19.123Z")).toBe("2026-10-10 14:25:19 UTC");
    expect(reportFileName({ collectionName: "Mon café / API", runId: "0f8fad5b-d9cb" })).toBe("apipilot-run-report-Mon-cafe-API-0f8fad5b.pdf");
    expect(reportFileName({ collectionName: "日本語", runId: "abcdef123456" })).toBe("apipilot-run-report-collection-abcdef12.pdf");
  });

  it("replaces text the PDF font cannot draw with ? instead of dropping it", () => {
    expect(toPdfText("café 日本")).toBe("café ??");
    expect(toPdfText("a\nb\tc")).toBe("a b c");
  });

  it("keeps the typographic dashes, quotes and bullet the standard fonts can draw, as request names use them", () => {
    expect(toPdfText("GET /health — positive")).toBe("GET /health — positive");
    expect(toPdfText("a – b “q” • …")).toBe("a – b “q” • …");
  });
});

describe("renderRunReportPdf", () => {
  it("produces a PDF, and the same bytes for the same run", async () => {
    const model = buildRunReportModel(run([result(), result({ requestName: "Second" })]));
    const first = await renderRunReportPdf(model);
    const second = await renderRunReportPdf(model);
    expect(first.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(first.equals(second)).toBe(true);
    // The cards of the redesigned report move whole, so even a short run can take a second page.
    expect(pageCount(first)).toBeLessThanOrEqual(2);
  });

  it("renders a run with no requests, and a cancelled run", async () => {
    const empty = await renderRunReportPdf(buildRunReportModel(run([], { status: "cancelled", completedAt: undefined })));
    expect(empty.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("continues onto more pages for a long run, without splitting a row", async () => {
    const many = Array.from({ length: 120 }, (_, index) => result({ requestName: `Request number ${index + 1} with a reasonably long descriptive name`, requestMethod: "post" }));
    const pdf = await renderRunReportPdf(buildRunReportModel(run(many)));
    expect(pageCount(pdf)).toBeGreaterThan(2);
  });

  it("draws failures and long text without error", async () => {
    const failing = result({ requestName: "N".repeat(300), outcome: "failed", failureCategory: "connectivity-failure", testOutcomes: [{ name: "t", outcome: "failed", detail: "boom" }] });
    const pdf = await renderRunReportPdf(buildRunReportModel(run([failing, result()])));
    expect(pdf.length).toBeGreaterThan(1000);
  });
});

describe("buildRunInsights", () => {
  const failing = (name: string, message: string, extra: Partial<UploadedRequestResult> = {}) =>
    result({ requestName: name, outcome: "failed", failureCategory: "assertion-failed", testOutcomes: [{ name: "t", outcome: "failed", detail: message }], ...extra });

  it("computes the pass rate and the test totals", () => {
    const insights = buildRunInsights(buildRunReportModel(run([result(), result(), failing("x", "boom"), result({ outcome: "not-attempted", notAttemptedReason: "cancelled", durationMs: 0, testOutcomes: [] })])));
    expect(insights.passRate).toBe(50);
    expect(insights.tests).toEqual({ passed: 2, failed: 1 });
    expect(buildRunInsights(buildRunReportModel(run([]))).passRate).toBeNull();
  });

  it("groups failures with the same reason and message, ignoring numbers and quoted values", () => {
    const insights = buildRunInsights(
      buildRunReportModel(
        run([
          failing("A", "expected 500 to equal 200"),
          failing("B", "expected 404 to equal 200"),
          failing("C", "expected 'abc' to be 'xyz'"),
          failing("D", "expected 'q' to be 'r'"),
          failing("E", "something else", { failureCategory: "connectivity-failure" }),
        ]),
      ),
    );
    expect(insights.clusters.map((cluster) => [cluster.reason, cluster.count, cluster.requests.map((entry) => entry.name)])).toEqual([
      ["Assertion failed", 2, ["A", "B"]],
      ["Assertion failed", 2, ["C", "D"]],
      ["Connectivity failure", 1, ["E"]],
    ]);
  });

  it("lists the five slowest requests that were sent, and orders the methods", () => {
    const rows = [30, 90, 10, 70, 50, 60, 20].map((durationMs, index) => result({ requestName: `r${index}`, durationMs, requestMethod: index % 2 ? "post" : "get" }));
    rows.push(result({ requestName: "skipped", outcome: "not-attempted", durationMs: 0, requestMethod: "delete", testOutcomes: [] }));
    const insights = buildRunInsights(buildRunReportModel(run(rows)));
    expect(insights.slowest.map((row) => row.durationMs)).toEqual([90, 70, 60, 50, 30]);
    expect(insights.methods.map((entry) => entry.method)).toEqual(["GET", "POST", "DELETE"]);
    expect(insights.methods[2]).toMatchObject({ total: 1, notAttempted: 1 });
  });
});

describe("renderRunReportHtml", () => {
  const model = buildRunReportModel(
    run([
      result({ requestName: "Get widget" }),
      result({ requestName: "Bad", outcome: "failed", failureCategory: "assertion-failed", responseStatusCode: 500, testOutcomes: [{ name: "Is ok", outcome: "failed", detail: "expected 500 to equal 200" }] }),
    ]),
  );

  it("is a complete page with the sections, the figures and the failure", () => {
    const html = renderRunReportHtml(model);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    for (const heading of ["Needs attention", "Failure clusters", "Slowest requests", "By method", "Run details", "All requests"]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain("My collection");
    expect(html).toContain(">50%<");
    expect(html).toContain("expected 500 to equal 200");
    expect(html).toContain("Assertion failed");
  });

  it("escapes everything that came from the uploaded collection", () => {
    const hostile = buildRunReportModel(
      run([result({ requestName: '<script>alert("x")</script><img src=x onerror=alert(1)>', outcome: "failed", failureCategory: "assertion-failed", testOutcomes: [{ name: "<b>t</b>", outcome: "failed", detail: "</style><script>boom()</script>" }] })], {
        uploadedCollectionSnapshot: { name: "</title><script>steal()</script>", tier: "local" },
      }),
    );
    const html = renderRunReportHtml(hostile);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<script>steal");
    expect(html).not.toContain("<script>boom");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    // The only script in the file is the report's own.
    expect(html.match(/<script>/g)).toHaveLength(1);
  });

  it("is self-contained: no external resources, a policy that blocks the network, and nothing from headers or bodies", () => {
    const withCapture = buildRunReportModel(
      run([result({ rawCapture: { requestUrl: "https://x.test", requestHeaders: [{ key: "Authorization", value: "Bearer SECRET-1" }], responseHeaders: [], responseBody: "SECRET-1" } as UploadedRequestResult["rawCapture"] })]),
    );
    const html = renderRunReportHtml(withCapture);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<link\b|<script[^>]*\ssrc=|@import|url\(/i);
    expect(html).not.toContain("SECRET-1");
    expect(html).not.toContain("Authorization");
  });

  it("renders the same bytes for the same run, and copes with an empty run", () => {
    expect(renderRunReportHtml(model)).toBe(renderRunReportHtml(model));
    const empty = renderRunReportHtml(buildRunReportModel(run([], { status: "cancelled", completedAt: undefined })));
    expect(empty).toContain("No requests were recorded");
    expect(empty).toContain("Not completed");
  });

  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });
});

describe("per-second graph of the reports (AP-045 US4, FR-014)", () => {
  // Finished at 10:00:00.4, .9 (second 0), 10:00:01.5 (second 1; failed), none in second 2, 10:00:03.2 (second 3).
  const at = (offsetMs: number, durationMs: number, extra: Partial<UploadedRequestResult> = {}) =>
    result({ startedAt: new Date(Date.parse("2026-01-01T10:00:00.000Z") + offsetMs).toISOString(), durationMs, ...extra });
  const results = [
    at(0, 400),
    at(300, 600),
    at(1200, 300, { outcome: "failed", failureCategory: "assertion-failed", testOutcomes: [] }),
    at(3000, 200),
    at(3500, 0, { outcome: "not-attempted", notAttemptedReason: "run-ended-before-reached", testOutcomes: [] }),
  ];
  const model = buildRunReportModel(run(results));

  /** Every path the PDF drew with at least three points, as steps from its first point, in each content stream. */
  function pdfPaths(pdf: Buffer): [number, number][][] {
    const raw = pdf.toString("latin1");
    const paths: [number, number][][] = [];
    for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      let content: string;
      try {
        content = inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
      } catch {
        continue;
      }
      let current: [number, number][] = [];
      for (const line of content.split("\n")) {
        const move = /^(-?[\d.]+) (-?[\d.]+) ([ml])$/.exec(line.trim());
        if (move) {
          if (move[3] === "m") {
            if (current.length >= 3) paths.push(current);
            current = [];
          }
          current.push([Number(move[1]), Number(move[2])]);
        }
      }
      if (current.length >= 3) paths.push(current);
    }
    return paths.map((path) => path.map(([px, py]) => [px - path[0][0], py - path[0][1]] as [number, number]));
  }

  it("adds the per-second series to the model, deriving the duration from the run only", () => {
    expect(model.series.bucketSeconds).toBe(1);
    expect(model.series.points.map((point) => [point.second, point.requests, point.failures, point.virtualUsers])).toEqual([
      [0, 2, 0, null],
      [1, 1, 1, null],
      [2, 0, 0, null],
      [3, 1, 0, null],
    ]);
    // Without a completion time the axis ends at the last result's end (3.2 s), not at the clock.
    const open = buildRunReportModel(run(results, { status: "in-progress", completedAt: undefined }));
    expect(open.series.points).toHaveLength(4);
    expect(buildRunReportModel(run(results))).toEqual(model);
  });

  it("builds the plotted figures once: rates, axis ticks and a summary that state the series", () => {
    const chart = buildSeriesChart(model.series)!;
    expect(chart.points.map((point) => point.requestsPerSecond)).toEqual([2, 1, 0, 1]);
    expect(chart.points.map((point) => point.failuresPerSecond)).toEqual([0, 1, 0, 0]);
    expect(chart.axisMax).toBe(2);
    expect(chart.yTicks.map((tick) => tick.label)).toEqual(["0", "1", "2"]);
    expect(chart.summary).toContain("4 requests, 1 failed; peak 2 requests per second; 1 of 4 seconds had failures");
    // Merged steps: the rate is the step's requests divided by its width, and the note says so.
    const merged = buildSeriesChart({ bucketSeconds: 4, points: [{ second: 0, requests: 8, failures: 4, virtualUsers: null }, { second: 4, requests: 2, failures: 0, virtualUsers: null }] })!;
    expect(merged.points.map((point) => [point.requestsPerSecond, point.failuresPerSecond])).toEqual([[2, 1], [0.5, 0]]);
    expect(merged.note).toContain("merged into wider steps of 4 seconds");
  });

  it("draws the same figures in the HTML and the PDF", async () => {
    const chart = buildSeriesChart(model.series)!;
    const layout = layoutSeriesChart(chart, CHART_BOX);
    const html = renderRunReportHtml(model);
    const points = (line: readonly (readonly [number, number])[]) => line.map(([px, py]) => `${px},${py}`).join(" ");
    expect(html).toContain(`<polyline class="req" points="${points(layout.requestsLine)}"></polyline>`);
    expect(html).toContain(`<polyline class="fl" points="${points(layout.failuresLine)}"></polyline>`);
    expect(html).toContain(`aria-label="${escapeHtml(chart.summary)}"`);
    for (const mark of [...layout.yMarks.map((entry) => entry.label), ...layout.xMarks.map((entry) => entry.label)]) expect(html).toContain(`>${mark}</text>`);
    // Non-colour cues: dashed line, square markers where there were failures, and a text table.
    expect(html).toContain("dasharray");
    expect(html).toContain('class="mk"');
    expect(html).toContain("<details><summary>Figures per second</summary>");

    // The PDF draws paths with the same shape from the same layout (its own box), to the rounding of 0.1.
    const pdfLayout = layoutSeriesChart(chart, pdfChartBox(0, 0, CONTENT_WIDTH_PDF));
    const drawn = pdfPaths(await renderRunReportPdf(model));
    const stepsOf = (line: readonly (readonly [number, number])[]) => line.map(([px, py]) => [px - line[0][0], py - line[0][1]] as [number, number]);
    const drawsLike = (line: readonly (readonly [number, number])[]) => {
      const expected = stepsOf(line);
      return drawn.some((path) => path.length === expected.length && path.every(([px, py], index) => Math.abs(px - expected[index][0]) < 0.25 && Math.abs(py - expected[index][1]) < 0.25));
    };
    expect(drawsLike(pdfLayout.requestsLine)).toBe(true);
    expect(drawsLike(pdfLayout.failuresLine)).toBe(true);
    // The two lines differ, so one cannot stand in for the other.
    expect(stepsOf(pdfLayout.requestsLine)).not.toEqual(stepsOf(pdfLayout.failuresLine));
  });

  it("renders the same bytes for the same run, and an older run (nothing extra stored) still has the graph", async () => {
    expect(renderRunReportHtml(model)).toBe(renderRunReportHtml(buildRunReportModel(run(results))));
    const first = await renderRunReportPdf(model);
    expect(first.equals(await renderRunReportPdf(buildRunReportModel(run(results))))).toBe(true);
    const html = renderRunReportHtml(model);
    expect(html).toContain('<h2 id="series-h">Requests per second</h2>');
    expect(html).toContain("<svg viewBox");
    expect(html).not.toContain(NO_REQUESTS_NOTE);
  });

  it("states that no requests were sent instead of drawing an empty graph", async () => {
    const none = buildRunReportModel(run([result({ outcome: "not-attempted", notAttemptedReason: "cancelled", durationMs: 0, responseStatusCode: undefined, testOutcomes: [] })]));
    const html = renderRunReportHtml(none);
    expect(html).toContain(NO_REQUESTS_NOTE);
    expect(html).not.toContain('class="req"');
    expect(buildSeriesChart(none.series)).toBeNull();
    expect((await renderRunReportPdf(none)).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
