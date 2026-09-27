import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPerformanceRunRepository } from "../../../src/persistence/performanceRunRepository";
import { getStatus, sweepForTest } from "../../../src/session/sessionRegistry";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { runFixture, SEEDED_CLIENT_ID, SEEDED_CLIENT_SECRET } from "../../fixtures/performance/builders";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { check, counter, httpReq, iteration, STREAM_START_MS, vus } from "../../fixtures/performance/ndjson";
import { generateReadyScript, PERFORMANCE_BASE as BASE, performanceAgent, readyProbe, unavailableProbe } from "../../fixtures/performance/agent";

/** contracts/performance-api.md "Runs" (FR-024 to FR-034a; SC-006 to SC-008; tasks T060, T074). */

const FAST = { tickIntervalMs: 20, now: () => new Date(STREAM_START_MS) };

async function planSteps(agent: Awaited<ReturnType<typeof performanceAgent>>["agent"]) {
  const plan = (await agent.get(`${BASE}/plan`)).body.plan;
  const steps = plan.journeys.flatMap((journey: { id: string; steps: { id: string; operationKey: string }[] }) =>
    journey.steps.map((step) => ({ ...step, journeyId: journey.id })),
  );
  return (key: string) => steps.find((step: { operationKey: string }) => step.operationKey === key);
}

function iterationLines(step: (key: string) => { id: string; journeyId: string }, atMs: number, options: { status503?: boolean } = {}): string[] {
  const order = step("POST /orders");
  const read = step("GET /orders/{orderId}");
  const status = step("GET /status");
  const warehouse = step("GET /warehouses/{warehouseId}");
  return [
    vus(2, atMs),
    ...httpReq({ step: order.id, journey: order.journeyId, status: 201, method: "POST", durationMs: 80, atMs }),
    check({ step: order.id, journey: order.journeyId, passed: true, atMs }),
    ...httpReq({ step: read.id, journey: read.journeyId, status: 200, method: "GET", durationMs: 40, atMs }),
    ...httpReq({ step: status.id, journey: status.journeyId, status: options.status503 ? 503 : 200, method: "GET", durationMs: 10, atMs }),
    ...httpReq({ step: warehouse.id, journey: warehouse.journeyId, status: 200, method: "GET", durationMs: 20, atMs }),
    iteration(atMs),
  ];
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

describe("performance run routes", () => {
  beforeEach(() => resetStore());

  it("refuses a run in the contract's order: stage, script, readiness, environment, slot", async () => {
    const early = await performanceAgent({ runner: createFakeRunner({ lines: [] }) }, { drive: false });
    expect((await early.agent.post(`${BASE}/runs`).send({ environmentId: "x" })).body.error).toBe("postman_generation_incomplete");

    const { agent, environmentId } = await performanceAgent({ runner: createFakeRunner({ lines: [] }), probe: unavailableProbe() });
    await agent.get(`${BASE}/plan`);
    expect((await agent.post(`${BASE}/runs`).send({ environmentId })).body.error).toBe("script_not_generated");
    await generateReadyScript(agent);
    const unavailable = await agent.post(`${BASE}/runs`).send({ environmentId });
    expect(unavailable.status).toBe(409);
    expect(unavailable.body).toMatchObject({ error: "k6_unavailable", readiness: { state: "unavailable", reason: "not-found" } });
    expect(JSON.stringify(unavailable.body)).not.toMatch(/binaryPath|k6\.exe/);

    const ready = await performanceAgent({ runner: createFakeRunner({ lines: [] }), probe: readyProbe() });
    await generateReadyScript(ready.agent);
    expect((await ready.agent.post(`${BASE}/runs`).send({ environmentId: "missing" })).status).toBe(404);
    getPerformanceRunRepository().create(ready.sessionId, runFixture({ id: "occupying" }));
    const busy = await ready.agent.post(`${BASE}/runs`).send({ environmentId: ready.environmentId });
    expect(busy.status).toBe(409);
    expect(busy.body).toMatchObject({ error: "execution_in_progress", runId: "occupying" });
  }, 60_000);

  it("runs only on the trigger, reports progress, and keeps the result (FR-024, FR-025, FR-030, SC-006)", async () => {
    const runner = createFakeRunner({ lines: [], lineIntervalMs: 2 });
    const { agent, environmentId } = await performanceAgent({ runner, probe: readyProbe(), ...FAST }, { tier: "production" });
    const step = await planSteps(agent);
    runner.lines = [0, 1000, 2000].flatMap((at) => iterationLines(step, at, { status503: at === 1000 }));
    await generateReadyScript(agent);
    await agent.get(`${BASE}/plan`);
    expect(runner.starts).toHaveLength(0);

    // No confirmation on any tier, production included (FR-025).
    const started = await agent.post(`${BASE}/runs`).send({ environmentId });
    expect(started.status).toBe(200);
    expect(started.body.run).toMatchObject({ status: "in-progress", environment: { name: "perf-local", tier: "production" }, k6Version: "1.2.0" });
    expect(runner.starts).toHaveLength(1);
    const input = runner.starts[0];
    expect(Object.values(input.env)).toContain(SEEDED_CLIENT_SECRET);
    expect(Object.keys(input.env).filter((key) => key.startsWith("APIPILOT_V_")).sort()).toEqual(["APIPILOT_V_0", "APIPILOT_V_1", "APIPILOT_V_2", "APIPILOT_V_3"]);
    expect(input.scriptPath.endsWith("script.js")).toBe(true);

    const settled = await waitFor(
      async () => (await agent.get(`${BASE}/runs/${started.body.run.id}`)).body.run,
      (run) => run.status !== "in-progress",
    );
    expect(settled.status).toBe("completed");
    expect(settled.result.totals).toMatchObject({ requests: 12, errors: 1, iterations: 3 });
    expect(settled.progress).toMatchObject({ requestsSoFar: 12, failuresSoFar: 1 });
    expect(settled.progress.steps).toHaveLength(4);
    const statusResult = settled.result.steps.find((s: { operationKey: string }) => s.operationKey === "GET /status");
    expect(statusResult.errorsByStatus).toEqual([{ status: "503", count: 1 }]);
    expect(settled.result.writeRequests).toEqual([{ operationKey: "POST /orders", method: "POST", sent: 3, succeeded: 3 }]);
    expect(settled.result.findings.map((finding: { ruleId: string }) => finding.ruleId)).toContain("slowest-step");

    const list = await agent.get(`${BASE}/runs`);
    expect(list.body.runs.map((run: { id: string }) => run.id)).toEqual([started.body.run.id]);
    expect(list.body.runs[0]).not.toHaveProperty("result");
    expect(runner.starts).toHaveLength(1);
    for (const body of [started.body, settled, list.body]) {
      expect(JSON.stringify(body)).not.toContain(SEEDED_CLIENT_SECRET);
      expect(JSON.stringify(body)).not.toContain(SEEDED_CLIENT_ID);
    }
  }, 60_000);

  it("cancels a running test and keeps what was measured (FR-031, SC-008)", async () => {
    const runner = createFakeRunner({ lines: [], lineIntervalMs: 2, holdUntilCancelled: true });
    const { agent, environmentId } = await performanceAgent({ runner, probe: readyProbe(), ...FAST });
    const step = await planSteps(agent);
    runner.lines = iterationLines(step, 0);
    await generateReadyScript(agent);
    const started = await agent.post(`${BASE}/runs`).send({ environmentId });
    const runId = started.body.run.id;
    await waitFor(async () => (await agent.get(`${BASE}/runs/${runId}`)).body.run, (run) => (run.progress?.requestsSoFar ?? 0) === 4);
    const cancel = await agent.post(`${BASE}/runs/${runId}/cancel`);
    expect(cancel.status).toBe(202);
    expect(cancel.body.run.cancelRequested).toBe(true);
    const settled = await waitFor(async () => (await agent.get(`${BASE}/runs/${runId}`)).body.run, (run) => run.status !== "in-progress");
    expect(settled).toMatchObject({ status: "cancelled", cancelReason: "user-requested" });
    expect(settled.result.totals.requests).toBe(4);
    expect(runner.cancels).toBeGreaterThanOrEqual(1);
    expect((await agent.post(`${BASE}/runs/${runId}/cancel`)).body.error).toBe("run_not_in_progress");
    expect((await agent.post(`${BASE}/runs/nope/cancel`)).status).toBe(404);
  }, 60_000);

  it("fails a run whose metrics are unreadable, or whose k6 cannot start", async () => {
    const garbage = createFakeRunner({ lines: Array.from({ length: 12 }, () => "not json"), lineIntervalMs: 1, holdUntilCancelled: true });
    const first = await performanceAgent({ runner: garbage, probe: readyProbe(), ...FAST });
    await generateReadyScript(first.agent);
    const run = (await first.agent.post(`${BASE}/runs`).send({ environmentId: first.environmentId })).body.run;
    const failed = await waitFor(async () => (await first.agent.get(`${BASE}/runs/${run.id}`)).body.run, (r) => r.status !== "in-progress");
    expect(failed).toMatchObject({ status: "failed", failure: { category: "metrics-unreadable" } });

    const missing = createFakeRunner({ lines: [], spawnError: "not-found" });
    const second = await performanceAgent({ runner: missing, probe: readyProbe(), ...FAST });
    await generateReadyScript(second.agent);
    const run2 = (await second.agent.post(`${BASE}/runs`).send({ environmentId: second.environmentId })).body.run;
    const failed2 = await waitFor(async () => (await second.agent.get(`${BASE}/runs/${run2.id}`)).body.run, (r) => r.status !== "in-progress");
    expect(failed2).toMatchObject({ status: "failed", failure: { category: "k6-unavailable" } });
  }, 60_000);

  it("keeps the session alive while a run is in progress (FR-034a, SC-014)", async () => {
    const runner = createFakeRunner({ lines: [], holdUntilCancelled: true });
    const { agent, sessionId, environmentId } = await performanceAgent({ runner, probe: readyProbe(), ...FAST });
    await generateReadyScript(agent);
    const run = (await agent.post(`${BASE}/runs`).send({ environmentId })).body.run;
    const later = Date.now() + 61 * 60_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      // With no browser request for 61 minutes, only the run's own ticks can keep the session live.
      await new Promise((resolve) => setTimeout(resolve, 80));
      sweepForTest();
      expect(getStatus(sessionId)).toBe("live");
    } finally {
      clock.mockRestore();
    }
    await agent.post(`${BASE}/runs/${run.id}/cancel`);
    await waitFor(async () => (await agent.get(`${BASE}/runs/${run.id}`)).body.run, (r) => r.status !== "in-progress");
  }, 60_000);

  it("serves the report for a settled run only, identical for display and download (FR-035)", async () => {
    const runner = createFakeRunner({ lines: [], lineIntervalMs: 2, holdUntilCancelled: true });
    const { agent, environmentId } = await performanceAgent({ runner, probe: readyProbe(), ...FAST });
    const step = await planSteps(agent);
    runner.lines = [
      ...iterationLines(step, 0),
      counter("apipilot_missing_data", { step: step("GET /warehouses/{warehouseId}").id, journey: step("GET /warehouses/{warehouseId}").journeyId, variable: "warehouseId" }, 10),
    ];
    await generateReadyScript(agent);
    const run = (await agent.post(`${BASE}/runs`).send({ environmentId })).body.run;
    expect((await agent.get(`${BASE}/runs/${run.id}/report`)).body.error).toBe("run_in_progress");
    await waitFor(async () => (await agent.get(`${BASE}/runs/${run.id}`)).body.run, (r) => (r.progress?.requestsSoFar ?? 0) === 4);
    await agent.post(`${BASE}/runs/${run.id}/cancel`);
    await waitFor(async () => (await agent.get(`${BASE}/runs/${run.id}`)).body.run, (r) => r.status !== "in-progress");

    const shown = await agent.get(`${BASE}/runs/${run.id}/report`);
    const downloaded = await agent.get(`${BASE}/runs/${run.id}/report?download=true`);
    expect(shown.status).toBe(200);
    expect(shown.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(downloaded.headers["content-disposition"]).toBe(`attachment; filename="apipilot-performance-${run.id}.html"`);
    expect(downloaded.text).toBe(shown.text);
    expect(shown.text).toContain("Cancelled · by you");
    expect(shown.text).toContain("warehouseId");
    expect(shown.text).not.toContain(SEEDED_CLIENT_SECRET);
    expect((await agent.get(`${BASE}/runs/nope/report`)).status).toBe(404);
  }, 60_000);

  it("keeps a started run visible and cancellable after Postman generation goes stale (contract Stage gating)", async () => {
    const runner = createFakeRunner({ lines: [], holdUntilCancelled: true });
    const { agent, environmentId } = await performanceAgent({ runner, probe: readyProbe(), ...FAST });
    await generateReadyScript(agent);
    const run = (await agent.post(`${BASE}/runs`).send({ environmentId })).body.run;
    const workflow = (await agent.get("/api/test-generation-workflow")).body.workflow;
    const decisions = workflow.dependencyAnalysis.workflows.map((w: { id: string }) => ({ workflowId: w.id, state: "approved" }));
    expect((await agent.post("/api/test-generation-workflow/workflow-review/decisions").send({ decisions })).status).toBe(200);
    expect((await agent.get("/api/test-generation-workflow")).body.workflow.stages.postmanGeneration.status).toBe("stale");

    expect((await agent.get(`${BASE}/readiness`)).status).toBe(200);
    expect((await agent.get(`${BASE}/runs`)).status).toBe(200);
    expect((await agent.get(`${BASE}/runs/${run.id}`)).status).toBe(200);
    expect((await agent.post(`${BASE}/runs/${run.id}/cancel`)).status).toBe(202);
    await waitFor(async () => (await agent.get(`${BASE}/runs/${run.id}`)).body.run, (r) => r.status !== "in-progress");
    expect((await agent.get(`${BASE}/runs/${run.id}/report`)).status).toBe(200);
    expect((await agent.post(`${BASE}/runs`).send({ environmentId })).body.error).toBe("postman_generation_incomplete");
  }, 60_000);
});
