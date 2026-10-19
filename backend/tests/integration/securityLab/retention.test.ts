import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { getSharedConnection } from "../../../src/persistence/connection";
import { getSecurityEvidenceRepository } from "../../../src/persistence/securityEvidenceRepository";
import { getSecurityFindingRepository } from "../../../src/persistence/securityFindingRepository";
import { getSecurityRunRepository } from "../../../src/persistence/securityRunRepository";
import { getSecurityScenarioRepository } from "../../../src/persistence/securityScenarioRepository";
import { loadSecurityLabLimits } from "../../../src/securityLab/config";
import { settleActiveRuns } from "../../../src/securityLab/execution/runService";
import { forceExpireForTest } from "../../../src/session/sessionRegistry";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { sampleHandler } from "../../fixtures/securityLab/sampleTargets";
import { approve, generateAll, scenarioIds, startHarness, startRun, waitForRun, type Harness, type ScenarioRef } from "../../fixtures/securityLab/runHarness";

/**
 * specs/057 FR-051, SC-017, tasks T127: retained work survives the end of a session and a restart, session data does not,
 * another browser sees nothing, and an assessment or everything can be deleted completely, deliberately and never while a
 * run is in progress. Also covers owner isolation and reading retained work with no specification loaded.
 */

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
  await approve(h, items);
  return { h, items };
}

async function runOnce(h: Harness, items: ScenarioRef[]) {
  const started = await startRun(h, items);
  expect(started.status).toBe(202);
  return waitForRun(h, started.body.run.id);
}

/** Loads a second specification as another assessment and generates its scenarios. */
async function secondAssessment(h: Harness): Promise<void> {
  resetStore();
  const upload = await h.agent.post("/api/test-generation-workflow").attach("file", readFileSync(path.join(FIXTURES, "no-security.yaml")), "no-security.yaml");
  expect(upload.status).toBe(200);
  const generated = await h.agent.post(`${BASE}/scenarios/generate`).send({ scope: { mode: "all" } });
  expect(generated.status).toBe(200);
}

const data = async (h: Harness) => (await h.agent.get(`${BASE}/data`)).body;

describe("GET /data", () => {
  it("counts retained work per assessment, with the caps and what goes with the session", async () => {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    await runOnce(h, items);
    await secondAssessment(h);
    const summary = await data(h);
    expect(summary.assessments.map((a: { assessmentLabel: string }) => a.assessmentLabel)).toEqual(["No Security Declared · no-security.yaml", "Sample Orders API · sample-api.yaml"]);
    const sample = summary.assessments.find((a: { assessmentLabel: string }) => a.assessmentLabel.startsWith("Sample"));
    expect(sample.runs).toBe(1);
    expect(sample.findings).toBeGreaterThan(0);
    expect(summary.totals).toEqual({
      scenarios: summary.assessments.reduce((sum: number, a: { scenarios: number }) => sum + a.scenarios, 0),
      runs: 1,
      findings: sample.findings,
    });
    expect(summary.caps).toEqual({ maxScenarios: loadSecurityLabLimits({}).retention.maxScenarios, maxRuns: loadSecurityLabLimits({}).retention.maxRuns });
    expect(summary.removedWithSession.join(" ")).toMatch(/profiles.*credentials.*evidence/i);
    expect(summary.retained.join(" ")).toMatch(/scenarios.*results.*findings/i);
  });

  it("is readable with no specification loaded", async () => {
    const { h } = await setup();
    resetStore();
    const res = await h.agent.get(`${BASE}/data`);
    expect(res.status).toBe(200);
    expect(res.body.totals.scenarios).toBeGreaterThan(0);
  });
});

describe("what survives the end of a session and a restart (SC-017)", () => {
  async function sameBrowserNewSession(h: Harness) {
    // The owner cookie is long-lived; the session cookie is not sent, so this is a new session of the same browser. A new
    // app instance stands for a backend restart: all state that must survive is in the database.
    const owner = (await h.agent.get(`${BASE}/settings`).then(() => h.ownerId)) as string;
    const restarted = createApp();
    return request.agent(restarted).set("Cookie", `apipilotOwner=${owner}`);
  }

  it("keeps scenarios, runs, results and findings, and drops profiles, credentials and evidence", async () => {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    const detail = await runOnce(h, items);
    const before = { scenarios: await data(h), findings: (await h.agent.get(`${BASE}/findings`)).body.total };
    expect(getSecurityEvidenceRepository().has(h.sessionId, detail.results[0].id)).toBe(true);

    forceExpireForTest(h.sessionId);

    const next = await sameBrowserNewSession(h);
    expect((await next.get(`${BASE}/data`)).body.totals).toEqual(before.scenarios.totals);
    expect((await next.get(`${BASE}/findings`)).body.total).toBe(before.findings);
    expect((await next.get(`${BASE}/runs/${detail.run.id}`)).body.run.status).toBe("completed");
    expect((await next.get(`${BASE}/scenarios?pageSize=1`)).body.total).toBeGreaterThan(0);

    expect((await next.get(`${BASE}/profiles`)).body.profiles).toEqual([]);
    expect(getSecurityEvidenceRepository().has(h.sessionId, detail.results[0].id)).toBe(false);
    const credentials = getSharedConnection().db.prepare("SELECT COUNT(*) AS n FROM security_credentials").get();
    expect(credentials).toEqual({ n: 0 });
    const evidence = getSharedConnection().db.prepare("SELECT COUNT(*) AS n FROM security_evidence").get();
    expect(evidence).toEqual({ n: 0 });
  });

  it("shows scenarios as needing a specification, never as executable, once the specification is gone", async () => {
    const { h } = await setup();
    forceExpireForTest(h.sessionId);
    resetStore();
    const next = await sameBrowserNewSession(h);
    const list = (await next.get(`${BASE}/scenarios?pageSize=100`)).body;
    expect(list.total).toBeGreaterThan(0);
    for (const item of list.items) expect(item.flags).toMatchObject({ specificationNotLoaded: true, executable: false });
  });

  it("is settled at startup when a run was left in progress by the process that died", async () => {
    const { h } = await setup();
    const repo = getSecurityRunRepository();
    expect(repo.listRuns(h.ownerId)).toHaveLength(0);
    repo.createRun({
      id: "run-left-behind", ownerId: h.ownerId, sessionId: h.sessionId, status: "in-progress", cancelRequested: false, startedAt: "2026-01-01T00:00:00.000Z",
      profileSummary: { profileId: "p", profileName: "p", environmentName: "e", tier: "local", baseUrl: "http://127.0.0.1:1", tlsPolicy: "verify", permittedCategories: [], limits: { maxRequests: 1, maxConcurrency: 1, timeoutMs: 1000 }, destructivePermitted: false },
      plan: [], planDigest: "0".repeat(64), limits: { maxRequests: 1, maxConcurrency: 1, timeoutMs: 1000 }, budget: { planned: 0, used: 0 },
      confirmation: { targetName: "e", targetBaseUrl: "http://127.0.0.1:1", authorizationAttested: true, destructiveScenarioIds: [] },
      summary: { passed: 0, failed: 0, inconclusive: 0, blocked: 0, errored: 0, not_run: 0 }, cleanup: [], assessmentKey: "k",
    });
    repo.markInterruptedRunsCancelled("2026-01-02T00:00:00.000Z");
    expect(repo.getRun(h.ownerId, "run-left-behind")).toMatchObject({ status: "cancelled", cancelReason: "backend-restart" });
  });
});

describe("another browser sees nothing", () => {
  it("cannot read, count, report on or delete this browser's retained work", async () => {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    await runOnce(h, items);
    const other = request.agent(h.app);
    expect((await other.get(`${BASE}/data`)).body.totals).toEqual({ scenarios: 0, runs: 0, findings: 0 });
    expect((await other.get(`${BASE}/scenarios`)).body.total).toBe(0);
    expect((await other.get(`${BASE}/findings`)).body.total).toBe(0);
    expect((await other.get(`${BASE}/runs`)).body.runs).toEqual([]);
    expect((await other.get(`${BASE}/report`)).status).toBe(409);
    const key = (await data(h)).assessments[0].assessmentKey;
    expect((await other.delete(`${BASE}/assessments/${key}`).send({ confirm: "x" })).status).toBe(404);
    expect((await other.delete(`${BASE}/data`).send({ confirm: "DELETE ALL" })).status).toBe(204);
    expect((await data(h)).totals.scenarios).toBeGreaterThan(0);
  });
});

describe("DELETE /assessments/:assessmentKey", () => {
  it("needs the assessment's label typed back, and answers 404 for an unknown key", async () => {
    const { h } = await setup();
    const [assessment] = (await data(h)).assessments;
    const wrong = await h.agent.delete(`${BASE}/assessments/${assessment.assessmentKey}`).send({ confirm: "sample" });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error).toBe("confirmation_mismatch");
    expect((await h.agent.delete(`${BASE}/assessments/${assessment.assessmentKey}`).send({})).status).toBe(422);
    expect((await h.agent.delete(`${BASE}/assessments/${assessment.assessmentKey}`)).status).toBe(422);
    expect((await data(h)).totals.scenarios).toBe(assessment.scenarios);
    const unknown = await h.agent.delete(`${BASE}/assessments/0000000000000000`).send({ confirm: "x" });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("assessment_not_found");
  });

  it("removes that assessment's scenarios, versions, runs, results, findings and evidence, and nothing of another", async () => {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    const detail = await runOnce(h, items);
    await secondAssessment(h);
    const before = await data(h);
    const sample = before.assessments.find((a: { assessmentLabel: string }) => a.assessmentLabel.startsWith("Sample"));
    const other = before.assessments.find((a: { assessmentLabel: string }) => a.assessmentLabel.startsWith("No Security"));

    const res = await h.agent.delete(`${BASE}/assessments/${sample.assessmentKey}`).send({ confirm: sample.assessmentLabel });
    expect(res.status).toBe(204);

    const after = await data(h);
    expect(after.assessments.map((a: { assessmentKey: string }) => a.assessmentKey)).toEqual([other.assessmentKey]);
    expect(after.assessments[0]).toMatchObject({ scenarios: other.scenarios, runs: 0, findings: 0 });
    const db = getSharedConnection().db;
    expect(getSecurityScenarioRepository().countByOwner(h.ownerId)).toBe(other.scenarios);
    expect(db.prepare("SELECT COUNT(*) AS n FROM security_scenario_versions WHERE scenario_id IN (SELECT id FROM security_scenarios WHERE assessment_key = ?)").get(sample.assessmentKey)).toEqual({ n: 0 });
    expect(getSecurityRunRepository().getRun(h.ownerId, detail.run.id)).toBeUndefined();
    expect(getSecurityRunRepository().listResults(h.ownerId, detail.run.id)).toEqual([]);
    expect(getSecurityFindingRepository().countByOwner(h.ownerId)).toBe(0);
    expect(getSecurityEvidenceRepository().has(h.sessionId, detail.results[0].id)).toBe(false);
    expect((await h.agent.get(`${BASE}/runs/${detail.run.id}`)).status).toBe(404);
  });

  it("is refused while one of its runs is in progress", async () => {
    const { h, items } = await setup();
    const inner = sampleHandler();
    h.target.setHandler((req, res) => void setTimeout(() => inner(req, res), 200));
    const started = await startRun(h, items);
    expect(started.status).toBe(202);
    const [assessment] = (await data(h)).assessments;
    const refused = await h.agent.delete(`${BASE}/assessments/${assessment.assessmentKey}`).send({ confirm: assessment.assessmentLabel });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: "execution_in_progress", runId: started.body.run.id });
    await waitForRun(h, started.body.run.id);
    expect((await h.agent.delete(`${BASE}/assessments/${assessment.assessmentKey}`).send({ confirm: assessment.assessmentLabel })).status).toBe(204);
  });
});

describe("DELETE /data", () => {
  it("needs DELETE ALL typed exactly, then removes every retained row, the settings and the session's own data", async () => {
    const { h, items } = await setup({ behavior: { vulnerable: true } });
    await runOnce(h, items);
    await h.agent.put(`${BASE}/settings`).send({ sensitiveFields: ["internalNote"] });
    for (const confirm of [undefined, "", "delete all", "DELETE  ALL", "DELETE ALL "]) {
      const refused = await h.agent.delete(`${BASE}/data`).send(confirm === undefined ? {} : { confirm });
      expect(refused.status, String(confirm)).toBe(422);
      expect(refused.body.error).toBe("confirmation_mismatch");
    }
    expect((await data(h)).totals.scenarios).toBeGreaterThan(0);

    expect((await h.agent.delete(`${BASE}/data`).send({ confirm: "DELETE ALL" })).status).toBe(204);

    expect((await data(h)).totals).toEqual({ scenarios: 0, runs: 0, findings: 0 });
    const db = getSharedConnection().db;
    for (const table of ["security_scenarios", "security_scenario_versions", "security_runs", "security_run_results", "security_findings", "security_settings", "security_profiles", "security_credentials", "security_evidence"]) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 });
    }
    expect((await h.agent.get(`${BASE}/settings`)).body.sensitiveFields).toEqual([]);
    expect((await h.agent.get(`${BASE}/profiles`)).body.profiles).toEqual([]);
    expect((await h.agent.get(`${BASE}/report`)).status).toBe(409);
  });

  it("is refused while a run is in progress, and deletes nothing", async () => {
    const { h, items } = await setup();
    const inner = sampleHandler();
    h.target.setHandler((req, res) => void setTimeout(() => inner(req, res), 200));
    const started = await startRun(h, items);
    const refused = await h.agent.delete(`${BASE}/data`).send({ confirm: "DELETE ALL" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("execution_in_progress");
    await waitForRun(h, started.body.run.id);
    expect((await data(h)).totals.scenarios).toBeGreaterThan(0);
  });
});

describe("retention caps (SC-017)", () => {
  it("refuses to start a run past the cap on retained runs, naming the cap", async () => {
    const limits = loadSecurityLabLimits({});
    const { h, items } = await setup({ securityLab: { limits: { ...limits, retention: { ...limits.retention, maxRuns: 1 } } } });
    await runOnce(h, items);
    const second = await startRun(h, items);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("retention_limit_reached");
    expect(second.body.message).toMatch(/1/);
    expect(getSecurityRunRepository().listRuns(h.ownerId)).toHaveLength(1);
  });
});
