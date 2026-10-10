import { describe, expect, it } from "vitest";
import type { UploadedCollectionExecutionRun, UploadedRequestResult } from "@apipilot/shared-domain";
import { buildRunInsights, buildRunReportModel, formatReportTime, reportFileName } from "../../../src/externalCollections/runReport";
import { escapeHtml, renderRunReportHtml } from "../../../src/externalCollections/runReportHtml";
import { renderRunReportPdf, toPdfText } from "../../../src/externalCollections/runReportPdf";

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
