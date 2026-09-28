import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { getPerformanceRunRepository } from "../../../src/persistence/performanceRunRepository";
import { resetQuickTestsForTest } from "../../../src/performance/quick/quickTestStore";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { TargetServer } from "../../fixtures/execution/targetServer";
import { generateReadyScript, PERFORMANCE_BASE, performanceAgent, readyProbe, unavailableProbe } from "../../fixtures/performance/agent";
import { runFixture, SEEDED_CLIENT_SECRET } from "../../fixtures/performance/builders";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { generateQuickScript, QUICK_BASE, quickAgent, uploadQuick, type QuickAgent } from "../../fixtures/performance/quickAgent";
import { establishSession } from "../../fixtures/performance/session";

/** AP-032 contracts/quick-performance-api.md "Readiness and runs" (FR-013, FR-020; US3 AS3, AS4; tasks T050, T051). */

async function environmentFor(agent: QuickAgent["agent"], values: Record<string, string> = {}): Promise<string> {
  const created = await agent
    .post("/api/test-generation-workflow/environments")
    .send({ name: "quick-local", tier: "local", baseUrl: "http://127.0.0.1:4600", variableValues: values });
  expect(created.status).toBe(200);
  return created.body.environment.id;
}

async function waitUntilSettled(agent: QuickAgent["agent"], runId: string) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const run = (await agent.get(`${QUICK_BASE}/runs/${runId}`)).body.run;
    if (run.status !== "in-progress") return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The run did not settle.");
}

describe("quick performance run routes", () => {
  beforeEach(() => {
    resetStore();
    resetQuickTestsForTest();
  });

  it("refuses a run in the contract's order: quick test, script, readiness, environment, slot", async () => {
    const none = await quickAgent({ runner: createFakeRunner({ lines: [] }), probe: readyProbe() });
    expect((await none.agent.post(`${QUICK_BASE}/runs`).send({ environmentId: "x" })).body.error).toBe("quick_test_not_found");

    const unready = await quickAgent({ runner: createFakeRunner({ lines: [] }), probe: unavailableProbe() });
    await uploadQuick(unready.agent);
    const environmentId = await environmentFor(unready.agent);
    expect((await unready.agent.post(`${QUICK_BASE}/runs`).send({ environmentId })).body.error).toBe("script_not_generated");
    await generateQuickScript(unready.agent);
    const plan = (await unready.agent.get(`${QUICK_BASE}/plan`)).body.plan;
    await unready.agent.put(`${QUICK_BASE}/plan`).send({ thinkTimeMs: plan.thinkTimeMs + 500 });
    expect((await unready.agent.post(`${QUICK_BASE}/runs`).send({ environmentId })).body.error).toBe("script_out_of_date");
    await unready.agent.post(`${QUICK_BASE}/script`);
    expect((await unready.agent.post(`${QUICK_BASE}/runs`).send({ environmentId })).body.error).toBe("k6_unavailable");

    const ready = await quickAgent({ runner: createFakeRunner({ lines: [] }), probe: readyProbe() });
    await uploadQuick(ready.agent);
    await generateQuickScript(ready.agent);
    const readyEnvironment = await environmentFor(ready.agent);
    expect((await ready.agent.post(`${QUICK_BASE}/runs`).send({ environmentId: "missing" })).body.error).toBe("environment_not_found");
    getPerformanceRunRepository().create(ready.sessionId, runFixture({ id: "occupying" }));
    const busy = await ready.agent.post(`${QUICK_BASE}/runs`).send({ environmentId: readyEnvironment });
    expect(busy.status).toBe(409);
    expect(busy.body).toMatchObject({ error: "execution_in_progress", runId: "occupying" });
  }, 60_000);

  it("starts a quick run on the trigger, records its source, lists it on the quick path only, and reports it (FR-013)", async () => {
    const runner = createFakeRunner({ lines: [] });
    const { agent } = await quickAgent({ runner, probe: readyProbe(), tickIntervalMs: 20 });
    await uploadQuick(agent);
    await generateQuickScript(agent);
    const environmentId = await environmentFor(agent, { password: SEEDED_CLIENT_SECRET });
    expect(runner.starts).toHaveLength(0);

    const started = await agent.post(`${QUICK_BASE}/runs`).send({ environmentId });
    expect(started.status).toBe(200);
    expect(started.body.run).toMatchObject({ status: "in-progress", planSource: "quick", environment: { name: "quick-local", tier: "local" } });
    expect(started.body.run.planSnapshot.source).toBe("quick");
    expect(runner.starts).toHaveLength(1);
    const runId = started.body.run.id;

    const settled = await waitUntilSettled(agent, runId);
    expect(settled.planSource).toBe("quick");
    expect((await agent.get(`${QUICK_BASE}/runs`)).body.runs.map((run: { id: string }) => run.id)).toEqual([runId]);
    expect((await agent.get(`${PERFORMANCE_BASE}/runs`)).body.runs).toEqual([]);
    // Run-by-id routes accept any run of the session, whichever path started it.
    expect((await agent.get(`${PERFORMANCE_BASE}/runs/${runId}`)).status).toBe(200);

    const report = await agent.get(`${QUICK_BASE}/runs/${runId}/report`);
    expect(report.status).toBe(200);
    expect(report.text).toContain("Plan built by the quick performance test from generated positive scenarios that were not reviewed.");
    expect(report.text).not.toContain(SEEDED_CLIENT_SECRET);

    // Replacing the quick test keeps earlier runs and their reports (FR-021).
    await uploadQuick(agent, { replaceExisting: true });
    expect((await agent.get(`${QUICK_BASE}/runs`)).body.runs.map((run: { id: string }) => run.id)).toEqual([runId]);
    expect((await agent.get(`${QUICK_BASE}/runs/${runId}/report`)).status).toBe(200);
  }, 60_000);

  it("reports value presence as booleans only (FR-019)", async () => {
    const { agent } = await quickAgent();
    await uploadQuick(agent);
    const environmentId = await environmentFor(agent, { password: SEEDED_CLIENT_SECRET });
    const response = await agent.get(`${QUICK_BASE}/plan/values?environmentId=${environmentId}`);
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain(SEEDED_CLIENT_SECRET);
    const byName = new Map(response.body.values.map((value: { name: string; present: boolean }) => [value.name, value.present]));
    expect(byName.get("baseUrl")).toBe(true);
    expect([...byName.values()].every((present) => typeof present === "boolean")).toBe(true);
  });
});

describe("quick runs in the shared execution slot (US3 AS4, FR-020; tasks T051)", () => {
  let targetServer: TargetServer;

  beforeEach(() => {
    resetStore();
    resetQuickTestsForTest();
    targetServer = new TargetServer();
  });

  afterEach(async () => {
    await targetServer.stop();
  });

  it("a quick run in progress blocks a guided performance run, a functional run and an uploaded-collection run", async () => {
    const { agent, sessionId, environmentId } = await performanceAgent({ runner: createFakeRunner({ lines: [] }), probe: readyProbe() });
    await generateReadyScript(agent);
    getPerformanceRunRepository().create(sessionId, runFixture({ id: "quick-run", planSource: "quick", planSnapshot: { ...runFixture().planSnapshot, source: "quick" } }));

    const guided = await agent.post(`${PERFORMANCE_BASE}/runs`).send({ environmentId });
    expect(guided.body).toMatchObject({ error: "execution_in_progress", runId: "quick-run" });

    const functional = await agent.post("/api/test-generation-workflow/execution/start").send({ environmentId, confirmed: true });
    expect(functional.body).toMatchObject({ error: "execution_in_progress", runId: "quick-run" });

    const uploaded = await agent
      .post("/api/external-collections")
      .field("name", "uc")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify({ info: { name: "c" }, item: [{ name: "r", request: { method: "GET", url: "{{baseUrl}}/x" } }] })), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify({ name: "e", values: [{ key: "baseUrl", value: "http://127.0.0.1:9", enabled: true }] })), "environment.json");
    const refusedUploaded = await agent.post(`/api/external-collections/${uploaded.body.uploadedCollection.id}/execution/start`).send({ confirmed: true });
    expect(refusedUploaded.body).toMatchObject({ error: "execution_in_progress", runId: "quick-run" });
  }, 60_000);

  it("a guided performance run in progress blocks a quick run", async () => {
    const { agent, sessionId } = await quickAgent({ runner: createFakeRunner({ lines: [] }), probe: readyProbe() });
    await uploadQuick(agent);
    await generateQuickScript(agent);
    const environmentId = await environmentFor(agent);
    getPerformanceRunRepository().create(sessionId, runFixture({ id: "guided-run" }));
    const refused = await agent.post(`${QUICK_BASE}/runs`).send({ environmentId });
    expect(refused.body).toMatchObject({ error: "execution_in_progress", runId: "guided-run" });
  });

  it("an uploaded-collection run in progress blocks a quick run", async () => {
    const baseUrl = await targetServer.start();
    targetServer.configure("GET", "/slow", { status: 200, body: {}, delayMs: 2000 });
    const agent = request.agent(createApp(undefined, { performance: { runner: createFakeRunner({ lines: [] }), probe: readyProbe() } }));
    await establishSession(agent);
    const uploaded = await agent
      .post("/api/external-collections")
      .field("name", "uc")
      .field("tier", "local")
      .attach("collection", Buffer.from(JSON.stringify({ info: { name: "c" }, item: [{ name: "Slow", request: { method: "GET", url: "{{baseUrl}}/slow" } }] })), "collection.json")
      .attach("environment", Buffer.from(JSON.stringify({ name: "e", values: [{ key: "baseUrl", value: baseUrl, enabled: true }] })), "environment.json");
    const started = await agent.post(`/api/external-collections/${uploaded.body.uploadedCollection.id}/execution/start`).send({ confirmed: true });
    expect(started.body.run.status).toBe("in-progress");

    await uploadQuick(agent);
    await generateQuickScript(agent);
    const environmentId = await environmentFor(agent);
    const refused = await agent.post(`${QUICK_BASE}/runs`).send({ environmentId });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: "execution_in_progress", runId: started.body.run.id });
  }, 30_000);
});
