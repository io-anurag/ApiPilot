import { describe, expect, it } from "vitest";
import type { ScenarioResult, SecurityFinding, SecurityOverview } from "@apipilot/shared-domain";
import { renderSecurityReportHtml, securityReportFileName } from "../../../src/securityLab/reports/renderSecurityReportHtml";
import { REPORT_LIMITS_STATEMENT, summarizeReport, type ReportInput } from "../../../src/securityLab/reports/summarizeReport";
import { listCategories } from "../../../src/securityLab/registry/categories";
import { makeFinding, makeResult, makeRun } from "../../fixtures/securityLab/builders";
import { ALL_SECRETS, assertNoSecrets } from "../../fixtures/securityLab/secretCorpus";

const NOW = "2026-03-04T05:06:07.000Z";

function overview(overrides: Partial<SecurityOverview> = {}): SecurityOverview {
  return {
    specificationLoaded: true,
    specificationRevision: "a".repeat(64),
    observationCounts: { informational: 3, "potential-risk": 1, "requires-context": 0, "not-measurable": 0 },
    scenarioCounts: { total: 4, byCategory: { authentication: 3, "input-validation": 1 }, byReviewState: { draft: 1, in_review: 0, approved: 3, rejected: 0 }, stale: 0, orphaned: 0, blocked: 0, specificationNotLoaded: 0 },
    findingCounts: { total: 1, bySeverity: { info: 0, low: 0, medium: 1, high: 0, critical: 0 }, byStatus: { open: 1, "accepted-risk": 0, "false-positive": 0, resolved: 0 }, occurrences: 2, withUnreviewedOccurrence: 0 },
    untestedHighPriority: [],
    ...overrides,
  };
}

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  const scenarios = [
    { id: "ss-1", categoryId: "authentication", assessmentLabel: "Shop API · shop.yaml", prerequisites: [] },
    { id: "ss-2", categoryId: "authentication", assessmentLabel: "Shop API · shop.yaml", prerequisites: [] },
    { id: "ss-3", categoryId: "broken-object-level-authorization", assessmentLabel: "Shop API · shop.yaml", prerequisites: [{ id: "identity:owner:bearerAuth", kind: "identity" as const, description: "d" }, { id: "ownership:GET /o:id:owner", kind: "ownership" as const, description: "d" }] },
  ];
  const results: ScenarioResult[] = [
    makeResult({ id: "r1", scenarioId: "ss-1", outcome: "passed" }),
    makeResult({ id: "r2", scenarioId: "ss-2", outcome: "failed" }),
    makeResult({ id: "r3", scenarioId: "ss-2", outcome: "blocked" }),
  ];
  return {
    generatedAt: NOW,
    overview: overview(),
    scenarios,
    runs: [makeRun({ id: "run-1" })],
    results,
    findings: [makeFinding()],
    categories: listCategories(),
    ...overrides,
  };
}

const finding = (overrides: Partial<SecurityFinding>): SecurityFinding => makeFinding(overrides);

describe("the report carries all of FR-061", () => {
  const report = summarizeReport(input());

  it("states when it was made, the specification revision, the taxonomy edition and the assessment", () => {
    expect(report).toMatchObject({ generatedAt: NOW, specificationRevision: "a".repeat(64), taxonomyEdition: "owasp-api-top10-2023", assessmentLabel: "Shop API · shop.yaml" });
  });

  it("names the profile and tier of every included run, with the target", () => {
    expect(report.runs).toEqual([{ id: "run-1", startedAt: expect.any(String), status: "in-progress", profileName: "Local sample", tier: "local", baseUrl: "http://127.0.0.1:4700" }]);
  });

  it("lists every registry category with its scenarios and the outcomes of the included runs", () => {
    expect(report.categoryCoverage.map((c) => c.categoryId)).toEqual(listCategories().map((c) => c.id));
    const authentication = report.categoryCoverage.find((c) => c.categoryId === "authentication");
    expect(authentication).toMatchObject({ scenarios: 2, outcomes: { passed: 1, failed: 1, blocked: 1, inconclusive: 0, errored: 0, not_run: 0 } });
    expect(report.categoryCoverage.find((c) => c.categoryId === "input-validation")?.scenarios).toBe(0);
  });

  it("carries the overview and the findings with their remediation and status", () => {
    expect(report.overview).toEqual(overview());
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].remediation.length).toBeGreaterThan(0);
  });

  it("says what was not covered and why: not executable, none generated, generated but never run (with the prerequisites needed)", () => {
    const reasons = Object.fromEntries(report.notCovered.map((entry) => [entry.categoryId, entry.reason]));
    expect(reasons["ssrf-unsafe-consumption"]).toMatch(/cannot be executed/);
    expect(reasons["api-inventory"]).toMatch(/cannot be executed/);
    expect(reasons["input-validation"]).toMatch(/^No scenario was generated for this category\. /);
    expect(reasons["broken-object-level-authorization"]).toBe("1 scenario exists but none was run in the included runs. They need: identity, ownership.");
    expect(reasons.authentication).toBeUndefined();
  });

  it("states the limits of what was tested, including that analysis does not prove a vulnerability", () => {
    expect(report.limitsStatement).toBe(REPORT_LIMITS_STATEMENT);
    expect(report.limitsStatement).toMatch(/does not prove runtime vulnerabilities/);
    expect(report.limitsStatement).toMatch(/not counted as passed/);
    expect(report.limitsStatement).toMatch(/passed scenario shows only/);
  });
});

describe("determinism (FR-061)", () => {
  it("gives an identical report for identical records, whatever order they arrive in", () => {
    const a = input();
    const b = input({ findings: [...a.findings].reverse(), runs: [...a.runs].reverse(), results: [...a.results].reverse(), scenarios: [...a.scenarios].reverse() });
    expect(summarizeReport(b)).toEqual(summarizeReport(a));
    expect(renderSecurityReportHtml(summarizeReport(b))).toBe(renderSecurityReportHtml(summarizeReport(a)));
  });

  it("differs only by the injected time", () => {
    const first = summarizeReport(input());
    const second = summarizeReport(input({ generatedAt: "2030-01-01T00:00:00.000Z" }));
    expect({ ...first, generatedAt: "" }).toEqual({ ...second, generatedAt: "" });
    expect(renderSecurityReportHtml(first)).not.toBe(renderSecurityReportHtml(second));
  });

  it("orders findings by severity, most severe first, then by id", () => {
    const report = summarizeReport(
      input({
        findings: [
          finding({ id: "sf-b", severity: { suggested: "low", current: "low" } }),
          finding({ id: "sf-a", severity: { suggested: "critical", current: "critical" } }),
          finding({ id: "sf-c", severity: { suggested: "low", current: "low" } }),
        ],
      }),
    );
    expect(report.findings.map((f) => f.id)).toEqual(["sf-a", "sf-b", "sf-c"]);
  });

  it("does not modify its input", () => {
    const data = input();
    const before = JSON.stringify(data);
    summarizeReport(data);
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe("with no specification loaded, or nothing run", () => {
  it("states no revision and still reports what is retained", () => {
    const report = summarizeReport(input({ overview: overview({ specificationLoaded: false, specificationRevision: undefined }) }));
    expect(report.specificationRevision).toBeUndefined();
    expect(report.findings).toHaveLength(1);
    expect(renderSecurityReportHtml(report)).toContain("no specification was loaded");
  });

  it("reports that no run is included, and every executable category as not run", () => {
    const report = summarizeReport(input({ runs: [], results: [], findings: [] }));
    expect(report.runs).toEqual([]);
    expect(report.notCovered.find((entry) => entry.categoryId === "authentication")?.reason).toBe("2 scenarios exist but none was run in the included runs.");
    const html = renderSecurityReportHtml(report);
    expect(html).toContain("No run is included in this report.");
    expect(html).toContain("No finding was recorded");
  });

  it("names several assessments rather than hiding that there are several", () => {
    const data = input();
    const report = summarizeReport(input({ scenarios: [...data.scenarios, { id: "ss-9", categoryId: "authentication", assessmentLabel: "Other API · other.yaml", prerequisites: [] }] }));
    expect(report.assessmentLabel).toBe("2 assessments: Other API · other.yaml; Shop API · shop.yaml");
  });
});

describe("the HTML (FR-062)", () => {
  const hostile = `<script>alert(1)</script><img src=x onerror=alert(2)>"'&`;

  it("escapes every interpolated value, including those that come from a specification or a target", () => {
    const base = input();
    const report = summarizeReport({
      ...base,
      scenarios: base.scenarios.map((scenario) => ({ ...scenario, assessmentLabel: hostile })),
      runs: [makeRun({ id: hostile, profileSummary: { ...makeRun().profileSummary, profileName: hostile, tier: hostile, baseUrl: hostile } })],
      findings: [
        finding({
          operationKey: hostile,
          specElementPointer: hostile,
          remediation: hostile,
          expected: { kind: "rejected", statement: hostile, basis: "product-rule", ruleId: hostile },
          confidence: { level: "high", basis: hostile },
          occurrences: [{ resultId: "r", runId: "run", at: NOW, observed: { responseHeadersSelected: {}, statement: hostile, truncated: false }, confidence: { level: "high", basis: "b" } }],
        }),
      ],
    });
    const html = renderSecurityReportHtml(report);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toMatch(/onerror=alert\(2\)>/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&quot;");
    expect(html).toContain("&#39;");
  });

  it("is one self-contained document: no script, no external resource, light and dark aware", () => {
    const html = renderSecurityReportHtml(summarizeReport(input()));
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toMatch(/<script|<link|<iframe|src=|href=/);
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain('<html lang="en">');
  });

  it("separates potential risks from findings and counts findings apart from occurrences", () => {
    const html = renderSecurityReportHtml(summarizeReport(input()));
    expect(html).toContain("Potential risks (from the specification, not proof)");
    expect(html).toContain("Findings (from requests sent)");
    expect(html).toContain("2 occurrences in total (counted apart from findings)");
  });

  it("names the file by date only, with nothing from the specification", () => {
    const report = summarizeReport(input());
    expect(securityReportFileName(report, "html")).toBe("apipilot-security-assessment-2026-03-04.html");
    expect(securityReportFileName(report, "json")).toBe("apipilot-security-assessment-2026-03-04.json");
  });
});

describe("no secret", () => {
  it("is in neither the JSON nor the HTML when the records hold none, and the report adds none", () => {
    const report = summarizeReport(input());
    assertNoSecrets("report json", JSON.stringify(report), ALL_SECRETS);
    assertNoSecrets("report html", renderSecurityReportHtml(report), ALL_SECRETS);
  });
});
