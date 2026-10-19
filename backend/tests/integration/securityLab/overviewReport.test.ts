import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { settleActiveRuns } from "../../../src/securityLab/execution/runService";
import { forceExpireForTest } from "../../../src/session/sessionRegistry";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { ALICE_TOKEN } from "../../fixtures/securityLab/runFixtures";
import { approve, generateAll, profileBody, scenarioIds, startHarness, startRun, waitForRun, type Harness, type ScenarioRef } from "../../fixtures/securityLab/runHarness";
import { ALL_SECRETS, assertNoSecrets } from "../../fixtures/securityLab/secretCorpus";

const BASE = "/api/security-lab";
const FIXTURES = path.resolve(__dirname, "../../fixtures/securityLab");
const harnesses: Harness[] = [];

afterEach(async () => {
  await settleActiveRuns();
  await Promise.all(harnesses.splice(0).map((harness) => harness.stop()));
});

async function setup(options: Parameters<typeof startHarness>[0] = {}) {
  const h = await startHarness(options);
  harnesses.push(h);
  await generateAll(h);
  const items = await scenarioIds(h, `operation=${encodeURIComponent("GET /orders")}&category=authentication`);
  return { h, items };
}

const overview = async (h: Harness) => (await h.agent.get(`${BASE}/overview`)).body;
const total = async (h: Harness, query: string) => (await h.agent.get(`${BASE}/scenarios?pageSize=1&${query}`)).body.total as number;

async function uploadOther(h: Harness, file: string): Promise<void> {
  // A new upload replaces the guided workflow, which has to be cleared first.
  resetStore();
  const res = await h.agent.post("/api/test-generation-workflow").attach("file", readFileSync(path.join(FIXTURES, file)), file);
  expect(res.status).toBe(200);
}

async function runAll(h: Harness, items: ScenarioRef[]) {
  const started = await startRun(h, items);
  expect(started.status).toBe(202);
  return waitForRun(h, started.body.run.id);
}

describe("GET /overview: every count opens a list with the same total (SC-012)", () => {
  it("reconciles scenarios by category and by review status, including rejected ones", async () => {
    const { h, items } = await setup();
    await approve(h, items.slice(0, 2));
    const [rejectMe] = await scenarioIds(h, `operation=${encodeURIComponent("GET /orders")}&category=authorization`);
    const other = (await scenarioIds(h, "reviewState=draft")).find((item) => item.id !== rejectMe?.id) as ScenarioRef;
    await h.agent.post(`${BASE}/scenarios/review`).send({ action: "reject", items: [other], reason: "Not needed" });

    const o = await overview(h);
    const listed = await total(h, "");
    expect(o.scenarioCounts.total).toBe(listed);
    for (const [category, count] of Object.entries(o.scenarioCounts.byCategory as Record<string, number>)) expect(await total(h, `category=${category}`), category).toBe(count);
    expect(Object.values(o.scenarioCounts.byCategory as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(listed);
    for (const state of ["draft", "in_review", "approved", "rejected"]) expect(await total(h, `reviewState=${state}`), state).toBe(o.scenarioCounts.byReviewState[state]);
    expect(o.scenarioCounts.byReviewState.approved).toBe(2);
    expect(o.scenarioCounts.byReviewState.rejected).toBe(1);
    expect(Object.values(o.scenarioCounts.byReviewState as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(listed);
  });

  it("reconciles the derived flags with their filters when the specification changes, and when none is loaded", async () => {
    const { h } = await setup();
    let o = await overview(h);
    expect(o).toMatchObject({ scenarioCounts: { stale: 0, orphaned: 0, specificationNotLoaded: 0 } });

    await uploadOther(h, "no-security.yaml");
    o = await overview(h);
    expect(o.scenarioCounts.orphaned).toBeGreaterThan(0);
    expect(o.scenarioCounts.orphaned).toBe(await total(h, "flag=orphaned"));
    expect(o.scenarioCounts.stale).toBe(await total(h, "flag=stale"));
    expect(o.scenarioCounts.blocked).toBe(await total(h, "flag=blocked"));

    resetStore();
    o = await overview(h);
    expect(o.specificationLoaded).toBe(false);
    expect(o.scenarioCounts.specificationNotLoaded).toBe(o.scenarioCounts.total);
    expect(o.scenarioCounts.specificationNotLoaded).toBe(await total(h, "flag=specification_not_loaded"));
    expect(o.scenarioCounts.stale).toBe(0);
    expect(o.scenarioCounts.orphaned).toBe(0);
  });

  it("counts findings, not occurrences, and reconciles with the findings list", async () => {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    await approve(h, items);
    await runAll(h, items);
    await runAll(h, items);
    const o = await overview(h);
    const list = (await h.agent.get(`${BASE}/findings?pageSize=100`)).body;
    expect(o.findingCounts.total).toBe(list.total);
    expect(o.findingCounts.occurrences).toBe(list.counts.occurrences);
    expect(o.findingCounts.occurrences).toBe(list.total * 2);
    expect(Object.values(o.findingCounts.bySeverity as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(list.total);
    expect(Object.values(o.findingCounts.byStatus as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(list.total);
    for (const [severity, count] of Object.entries(o.findingCounts.bySeverity as Record<string, number>)) {
      expect((await h.agent.get(`${BASE}/findings?severity=${severity}`)).body.total, severity).toBe(count);
    }
    expect(o.findingCounts.withUnreviewedOccurrence).toBe((await h.agent.get(`${BASE}/findings?unreviewed=true`)).body.total);
  });

  it("keeps potential risks and findings apart: observations are not findings, and neither contains the other", async () => {
    const { h } = await setup();
    const o = await overview(h);
    const analysis = (await h.agent.get(`${BASE}/analysis`)).body.analysis;
    expect(o.observationCounts).toEqual(analysis.counts);
    expect(o.findingCounts.total).toBe(0);
    expect(Object.values(o.observationCounts as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(analysis.observations.length);
  });

  it("lists high-priority operations with no executed scenario, with the basis, and drops one once it has been run", async () => {
    const { h } = await setup();
    const before = (await overview(h)).untestedHighPriority as Array<{ operationKey: string; basis: string }>;
    const keys = before.map((entry) => entry.operationKey);
    expect(keys).toContain("GET /orders/{orderId}");
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of before) expect(entry.basis).toMatch(/^[a-z-]+: .{10,}/);

    const own = await scenarioIds(h, `operation=${encodeURIComponent("GET /orders/{orderId}")}&category=broken-object-level-authorization`);
    expect(own.length).toBeGreaterThan(0);
    await approve(h, own);
    await runAll(h, own);
    const after = (await overview(h)).untestedHighPriority as Array<{ operationKey: string }>;
    expect(after.map((entry) => entry.operationKey)).not.toContain("GET /orders/{orderId}");
    expect(after.length).toBe(before.length - 1);
  });

  it("shows the scope and the latest run", async () => {
    const { h, items } = await setup();
    await approve(h, items);
    const detail = await runAll(h, items);
    const o = await overview(h);
    expect(o.scope).toEqual({ mode: "all", included: 9, excluded: 0 });
    expect(o.latestRun).toMatchObject({ id: detail.run.id, status: "completed" });
    expect(o.latestRun.summary).toEqual(detail.run.summary);
    expect(o.specificationRevision).toMatch(/^[0-9a-f]{64}$/);
  });

  it("works with no specification and nothing retained, and for another browser sees nothing", async () => {
    const { h } = await setup();
    const other = await import("supertest").then((module) => module.default.agent(h.app));
    const empty = (await other.get(`${BASE}/overview`)).body;
    expect(empty).toMatchObject({ specificationLoaded: false, scenarioCounts: { total: 0 }, findingCounts: { total: 0, occurrences: 0 }, untestedHighPriority: [] });
    expect(empty.latestRun).toBeUndefined();
  });
});

describe("GET /report", () => {
  it("answers 409 nothing_to_report when there is nothing retained", async () => {
    const h = await startHarness({ withSpecification: false });
    harnesses.push(h);
    const res = await h.agent.get(`${BASE}/report`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("nothing_to_report");
  });

  it("produces the assessment as JSON and as a self-contained HTML attachment with the coverage report's headers", async () => {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    await approve(h, items);
    await runAll(h, items);

    const json = await h.agent.get(`${BASE}/report?format=json`);
    expect(json.status).toBe(200);
    expect(json.headers["content-type"]).toMatch(/application\/json/);
    expect(json.headers["content-disposition"]).toMatch(/^attachment; filename="apipilot-security-assessment-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(json.headers["cache-control"]).toBe("no-store");
    expect(json.headers["x-content-type-options"]).toBe("nosniff");
    const report = JSON.parse(json.text);
    expect(report.taxonomyEdition).toBe("owasp-api-top10-2023");
    expect(report.assessmentLabel).toBe("Sample Orders API · sample-api.yaml");
    expect(report.specificationRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(report.runs).toEqual([expect.objectContaining({ profileName: "Sample profile", tier: "local", baseUrl: h.target.origin })]);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.limitsStatement).toMatch(/does not prove runtime vulnerabilities/);
    expect(report.categoryCoverage).toHaveLength(11);
    expect(report.notCovered.length).toBeGreaterThan(0);

    const html = await h.agent.get(`${BASE}/report?format=html`);
    expect(html.status).toBe(200);
    expect(html.headers["content-type"]).toMatch(/text\/html/);
    expect(html.headers["content-disposition"]).toMatch(/filename="apipilot-security-assessment-.*\.html"/);
    expect(html.text).toMatch(/^<!doctype html>/);
    expect(html.text).not.toMatch(/<script|src="http|href="http/);
    expect(html.text).toContain("Sample Orders API");
  });

  it("defaults to JSON and refuses an unknown format", async () => {
    const { h } = await setup();
    expect((await h.agent.get(`${BASE}/report`)).headers["content-type"]).toMatch(/application\/json/);
    const bad = await h.agent.get(`${BASE}/report?format=pdf`);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_request");
  });

  it("narrows to the named runs, and refuses an unknown one", async () => {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    await approve(h, items);
    const first = await runAll(h, items);
    await runAll(h, items);
    const all = JSON.parse((await h.agent.get(`${BASE}/report`)).text);
    const one = JSON.parse((await h.agent.get(`${BASE}/report?runIds=${first.run.id}`)).text);
    expect(all.runs).toHaveLength(2);
    expect(one.runs.map((run: { id: string }) => run.id)).toEqual([first.run.id]);
    const outcomes = (report: typeof all) => report.categoryCoverage.reduce((sum: number, c: { outcomes: Record<string, number> }) => sum + Object.values(c.outcomes).reduce((a, b) => a + b, 0), 0);
    expect(outcomes(all)).toBe(outcomes(one) * 2);
    const missing = await h.agent.get(`${BASE}/report?runIds=nope`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("run_not_found");
  });

  it("works after the session expired and with no specification loaded, from retained work alone", async () => {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    await approve(h, items);
    await runAll(h, items);
    const before = JSON.parse((await h.agent.get(`${BASE}/report`)).text);
    forceExpireForTest(h.sessionId);
    resetStore();
    const after = await h.agent.get(`${BASE}/report`);
    expect(after.status).toBe(200);
    const report = JSON.parse(after.text);
    expect(report.overview.specificationLoaded).toBe(false);
    expect(report.specificationRevision).toBeUndefined();
    expect(report.findings.map((f: { id: string }) => f.id)).toEqual(before.findings.map((f: { id: string }) => f.id));
    expect(report.runs).toEqual(before.runs);
    expect((await h.agent.get(`${BASE}/report?format=html`)).status).toBe(200);
  });

  it("escapes every value taken from the specification or a response in the HTML", async () => {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    const hostile = '<img src=x onerror=alert(1)>"&\'';
    // The profile name reaches the report through each run's profile summary.
    const renamed = await h.agent.put(`${BASE}/profiles/${h.profileId}`).send(profileBody(h, { name: hostile }));
    expect(renamed.status).toBe(200);
    await approve(h, items);
    await runAll(h, items);
    const html = (await h.agent.get(`${BASE}/report?format=html`)).text;
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("onerror=alert(1)>");
    expect(html).toContain("&lt;");
  });

  it("is identical for identical records (the clock is the only difference)", async () => {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    await approve(h, items);
    await runAll(h, items);
    const a = JSON.parse((await h.agent.get(`${BASE}/report`)).text);
    const b = JSON.parse((await h.agent.get(`${BASE}/report`)).text);
    expect({ ...a, generatedAt: "" }).toEqual({ ...b, generatedAt: "" });
  });

  it("contains no credential and no response body, as JSON or HTML", async () => {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    await approve(h, items);
    await runAll(h, items);
    for (const format of ["json", "html"]) {
      const text = (await h.agent.get(`${BASE}/report?format=${format}`)).text;
      assertNoSecrets(`report ${format}`, text, [...ALL_SECRETS, ALICE_TOKEN]);
      expect(text).not.toContain("ord-1001");
    }
  });
});
