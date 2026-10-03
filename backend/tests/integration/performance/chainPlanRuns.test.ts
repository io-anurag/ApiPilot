import { describe, expect, it } from "vitest";
import type { ChainPlan, ChainRun } from "@apipilot/shared-domain";
import { getPerformanceRunRepository } from "../../../src/persistence/performanceRunRepository";
import { readyProbe } from "../../fixtures/performance/agent";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { counter, httpReq, sample, vus } from "../../fixtures/performance/ndjson";
import { chainAgent, CHAIN_BASE, createEnvironment, newPlan, savePlanContent } from "../../fixtures/chain/chainAgent";
import { customerLifecyclePlan } from "../../fixtures/chain/chainPlans";

/** AP-037 (specs/037-request-chain-performance tasks T028; contracts/chain-plan-api.md "Script" and "Runs"). */

const VALUES = { client_id: "id-1", client_secret: "secret-RUNS-7f3" };

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function readyPlan(lines: string[] = [], options: { exitCode?: number; hold?: boolean } = {}) {
  const runner = createFakeRunner({ lines, exitCode: options.exitCode, holdUntilCancelled: options.hold });
  const { agent, sessionId } = await chainAgent({ runner, probe: readyProbe() });
  const plan = await newPlan(agent);
  const environmentId = await createEnvironment(agent, VALUES);
  const saved = await savePlanContent(agent, plan, customerLifecyclePlan({ targetEnvironmentId: environmentId }));
  return { agent, sessionId, runner, environmentId, plan: saved.body.plan as ChainPlan };
}

async function settledRun(agent: Awaited<ReturnType<typeof readyPlan>>["agent"], runId: string): Promise<ChainRun> {
  return waitFor(
    async () => (await agent.get(`${CHAIN_BASE}/runs/${runId}`)).body.run as ChainRun,
    (run) => run.status !== "in-progress",
  );
}

describe("request-chain plan routes: script", () => {
  it("refuses a plan with blockers, then generates a script, marks it out of date on change and downloads it", async () => {
    const { agent } = await chainAgent();
    const plan = await newPlan(agent);
    const blocked = await agent.post(`${CHAIN_BASE}/${plan.id}/script`);
    expect(blocked.status).toBe(422);
    expect(blocked.body).toMatchObject({ error: "plan_has_blockers", blockers: [{ kind: "no-runnable-chain" }] });

    const saved = (await savePlanContent(agent, plan, customerLifecyclePlan())).body.plan as ChainPlan;
    const generated = await agent.post(`${CHAIN_BASE}/${plan.id}/script`);
    expect(generated.status).toBe(200);
    expect(generated.body.script).toMatchObject({ planFingerprint: saved.fingerprint, stepCount: 7, outOfDate: false });
    const again = await agent.post(`${CHAIN_BASE}/${plan.id}/script`);
    expect(again.body.script.scriptSha256).toBe(generated.body.script.scriptSha256);

    const script = await agent.get(`${CHAIN_BASE}/${plan.id}/script/download?file=script`);
    expect(script.status).toBe(200);
    expect(script.text).toContain("// ApiPilot k6 performance test, request-chain plan");
    expect(script.headers["x-apipilot-note"]).toBeUndefined();
    const template = await agent.get(`${CHAIN_BASE}/${plan.id}/script/download?file=environment-template`);
    expect(JSON.parse(template.text).client_secret).toEqual({ env: "APIPILOT_V_2", secret: true, value: "" });

    await savePlanContent(agent, saved, customerLifecyclePlan({ thinkTimeMs: 0 }));
    expect((await agent.get(`${CHAIN_BASE}/${plan.id}`)).body.script.outOfDate).toBe(true);
    expect((await agent.get(`${CHAIN_BASE}/${plan.id}/script/download`)).body.error).toBe("script_out_of_date");
  });
});

describe("request-chain plan routes: runs", () => {
  it("refuses a run without a current script, without k6, or for an unknown environment", async () => {
    const { agent, environmentId, plan } = await readyPlan();
    expect((await agent.post(`${CHAIN_BASE}/${plan.id}/runs`).send({ environmentId })).body.error).toBe("script_not_generated");
    await agent.post(`${CHAIN_BASE}/${plan.id}/script`);
    expect((await agent.post(`${CHAIN_BASE}/${plan.id}/runs`).send({ environmentId: "00000000-0000-4000-8000-0000000000ff" })).body.error).toBe("environment_not_found");

    const unavailable = await chainAgent();
    const other = await newPlan(unavailable.agent);
    await savePlanContent(unavailable.agent, other, customerLifecyclePlan());
    await unavailable.agent.post(`${CHAIN_BASE}/${other.id}/script`);
    const env = await createEnvironment(unavailable.agent, VALUES);
    const refused = await unavailable.agent.post(`${CHAIN_BASE}/${other.id}/runs`).send({ environmentId: env });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("k6_unavailable");
  });

  it("starts a run with a snapshot holding no content or value, shares the session's slot, and reports it", async () => {
    const { agent, sessionId, runner, environmentId, plan } = await readyPlan([], { hold: true });
    await agent.post(`${CHAIN_BASE}/${plan.id}/script`);
    const started = await agent.post(`${CHAIN_BASE}/${plan.id}/runs`).send({ environmentId });
    expect(started.status).toBe(200);
    const run = started.body.run as ChainRun;
    expect(run).toMatchObject({ planSource: "chain", planId: plan.id, status: "in-progress", environment: { name: "Local stub", tier: "local" } });
    expect(run.snapshot.contentNotice).toBe("user-authored-unverified");
    expect(run.snapshot.chains[0].steps.map((step) => step.pathTemplate)).toContain("{{baseUrl}}/api/v1/customers/{{customer_id}}");
    const snapshotText = JSON.stringify(run.snapshot);
    expect(snapshotText).not.toContain("Bearer");
    expect(snapshotText).not.toContain("Replaced");
    expect(snapshotText).not.toContain("secret-RUNS-7f3");
    expect(getPerformanceRunRepository().getChainRunPlanDocument(sessionId, run.id)).toContain("Replaced");

    const busy = await agent.post(`${CHAIN_BASE}/${plan.id}/runs`).send({ environmentId });
    expect(busy.body).toMatchObject({ error: "execution_in_progress", runId: run.id });
    expect((await agent.delete(`${CHAIN_BASE}/${plan.id}`)).body.error).toBe("run_in_progress");
    expect((await agent.get(`${CHAIN_BASE}/runs/${run.id}/report`)).status).toBe(409);
    expect((await agent.get(`${CHAIN_BASE}/${plan.id}/runs`)).body.runs.map((summary: { id: string }) => summary.id)).toEqual([run.id]);
    expect(runner.starts[0].env.APIPILOT_V_1).toBe("id-1");

    expect((await agent.post(`${CHAIN_BASE}/runs/${run.id}/cancel`)).status).toBe(202);
    const settled = await settledRun(agent, run.id);
    expect(settled.status).toBe("cancelled");
    const report = await agent.get(`${CHAIN_BASE}/runs/${run.id}/report`);
    expect(report.status).toBe(200);
    expect(report.text).toContain("Steps are authored by the engineer and not verified by ApiPilot.");
    expect(report.text).not.toContain("Bearer {{token}}");
    expect(report.text).not.toContain("secret-RUNS-7f3");

    expect((await agent.delete(`${CHAIN_BASE}/${plan.id}`)).status).toBe(204);
    expect((await agent.get(`${CHAIN_BASE}/runs/${run.id}`)).body.run.id).toBe(run.id);
  });

  it("refuses another session's runs and plan to a second session, which cannot start, cancel, report or restore them", async () => {
    const owner = await readyPlan([], { hold: true });
    await owner.agent.post(`${CHAIN_BASE}/${owner.plan.id}/script`);
    const run = (await owner.agent.post(`${CHAIN_BASE}/${owner.plan.id}/runs`).send({ environmentId: owner.environmentId })).body.run as ChainRun;
    const other = await readyPlan();
    await other.agent.post(`${CHAIN_BASE}/${other.plan.id}/script`);

    const refused = await Promise.all([
      other.agent.get(`${CHAIN_BASE}/runs/${run.id}`),
      other.agent.post(`${CHAIN_BASE}/runs/${run.id}/cancel`),
      other.agent.get(`${CHAIN_BASE}/runs/${run.id}/report`),
      other.agent.post(`${CHAIN_BASE}/runs/${run.id}/restore`).send({ into: "new-plan" }),
      other.agent.post(`${CHAIN_BASE}/runs/${run.id}/restore`).send({ into: "plan", planId: owner.plan.id, revision: owner.plan.revision }),
    ]);
    for (const response of refused) expect([response.req.method, response.req.path, response.status, response.body.error]).toEqual([response.req.method, response.req.path, 404, "run_not_found"]);
    // The plan-scoped list answers for this session only: another session's plan lists no run.
    expect((await other.agent.get(`${CHAIN_BASE}/${owner.plan.id}/runs`)).body).toEqual({ runs: [] });
    const started = await other.agent.post(`${CHAIN_BASE}/${owner.plan.id}/runs`).send({ environmentId: other.environmentId });
    expect([started.status, started.body.error]).toEqual([404, "chain_plan_not_found"]);
    // Nor can its own plan run against the other session's environment and its values.
    const borrowed = await other.agent.post(`${CHAIN_BASE}/${other.plan.id}/runs`).send({ environmentId: owner.environmentId });
    expect([borrowed.status, borrowed.body.error]).toEqual([404, "environment_not_found"]);
    expect(other.runner.starts).toEqual([]);
    expect((await other.agent.get(CHAIN_BASE)).body.plans.map((plan: { id: string }) => plan.id)).toEqual([other.plan.id]);

    expect((await owner.agent.get(`${CHAIN_BASE}/runs/${run.id}`)).body.run.status).toBe("in-progress");
    expect((await owner.agent.post(`${CHAIN_BASE}/runs/${run.id}/cancel`)).status).toBe(202);
    expect((await settledRun(owner.agent, run.id)).status).toBe("cancelled");
  });

  it("settles a run whose Once before load step failed as setup-step-failed, naming the step and reason", async () => {
    const lines = [
      vus(1, 0),
      ...httpReq({ step: "", journey: "", status: 401, method: "POST", durationMs: 12, atMs: 100 }).map((line) => line.replace('"step":"","journey":""', '"apipilot_kind":"setup","setup_step":"s1"')),
      counter("apipilot_setup", { setup_step: "s1", outcome: "failed", reason: "status" }, 120),
    ];
    const { agent, environmentId, plan } = await readyPlan(lines, { exitCode: 108 });
    await agent.post(`${CHAIN_BASE}/${plan.id}/script`);
    const run = (await agent.post(`${CHAIN_BASE}/${plan.id}/runs`).send({ environmentId })).body.run as ChainRun;
    const settled = await settledRun(agent, run.id);
    expect(settled.status).toBe("failed");
    expect(settled.failure).toEqual({ category: "setup-step-failed" });
    expect(settled.result?.setupSteps).toEqual([{ stepId: "s1", outcome: "failed", reason: "status", latencyMs: 12 }]);
    expect(settled.result?.totals.requests).toBe(0);
    const report = await agent.get(`${CHAIN_BASE}/runs/${run.id}/report`);
    expect(report.text).toContain("Failed · a Once before load step failed");
    expect(report.text).toContain("unexpected status");
  });

  it("aggregates a completed chain run by chain and step, with extractor and setup outcomes", async () => {
    const lines = [
      vus(2, 0),
      sample("http_req_duration", 30, { apipilot_kind: "setup", setup_step: "s1", status: "200", method: "POST" }, 50),
      counter("apipilot_setup", { setup_step: "s1", outcome: "ok", reason: "" }, 60),
      ...httpReq({ step: "s2", journey: "c1", status: 201, method: "POST", durationMs: 40, atMs: 200 }),
      counter("apipilot_capture", { step: "s2", journey: "c1", capture: "customer_id", outcome: "ok" }, 210),
      ...httpReq({ step: "s4", journey: "c1", status: 404, method: "PUT", durationMs: 20, atMs: 300 }),
    ];
    const { agent, environmentId, plan } = await readyPlan(lines);
    await agent.post(`${CHAIN_BASE}/${plan.id}/script`);
    const run = (await agent.post(`${CHAIN_BASE}/${plan.id}/runs`).send({ environmentId })).body.run as ChainRun;
    const settled = await settledRun(agent, run.id);
    expect(settled.status).toBe("completed");
    const result = settled.result!;
    expect(result.totals.requests).toBe(2);
    expect(result.setupSteps).toEqual([{ stepId: "s1", outcome: "ok", reason: null, latencyMs: 30 }]);
    expect(result.steps.map((step) => step.stepId)).toEqual(["s2", "s3", "s4", "s5", "s6", "s7"]);
    expect(result.steps[0].captures).toEqual([{ name: "customer_id", succeeded: 1, failed: 0 }]);
    expect(result.steps[2].errorsByStatus).toEqual([{ status: "404", count: 1 }]);
    expect(result.writeRequests).toEqual([
      { operationKey: "s2", method: "POST", sent: 1, succeeded: 1 },
      { operationKey: "s4", method: "PUT", sent: 1, succeeded: 0 },
    ]);
  });

  it("restores a run's plan into the plan at its revision, or as a new plan, generating the script and starting no run", async () => {
    const { agent, runner, environmentId, plan } = await readyPlan();
    await agent.post(`${CHAIN_BASE}/${plan.id}/script`);
    const run = (await agent.post(`${CHAIN_BASE}/${plan.id}/runs`).send({ environmentId })).body.run as ChainRun;
    await settledRun(agent, run.id);
    const edited = (await savePlanContent(agent, plan, customerLifecyclePlan({ targetEnvironmentId: environmentId, thinkTimeMs: 0, chains: [customerLifecyclePlan().chains[0]] }))).body.plan as ChainPlan;
    const changed = { ...edited };
    expect(changed.thinkTimeMs).toBe(0);

    const stale = await agent.post(`${CHAIN_BASE}/runs/${run.id}/restore`).send({ into: "plan", planId: plan.id, revision: 1 });
    expect(stale.body.error).toBe("plan_revision_conflict");
    const restored = await agent.post(`${CHAIN_BASE}/runs/${run.id}/restore`).send({ into: "plan", planId: plan.id, revision: edited.revision });
    expect(restored.status).toBe(200);
    expect(restored.body.plan.thinkTimeMs).toBe(1000);
    expect(restored.body.plan.targetEnvironmentId).toBe(environmentId);
    expect(restored.body.script).toMatchObject({ outOfDate: false, scriptSha256: run.scriptSha256 });
    expect(restored.body.dataSetsNotRestored).toEqual([]);

    const copy = await agent.post(`${CHAIN_BASE}/runs/${run.id}/restore`).send({ into: "new-plan" });
    expect(copy.status).toBe(200);
    expect(copy.body.plan.name).toBe("Customer lifecycle (restored)");
    expect(copy.body.plan.id).not.toBe(plan.id);
    expect(copy.body.script.scriptSha256).toBe(run.scriptSha256);
    expect(runner.starts).toHaveLength(1);
  });
});
