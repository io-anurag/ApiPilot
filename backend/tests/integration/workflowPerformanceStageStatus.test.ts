import request from "supertest";
import { describe, expect, it } from "vitest";
import type { ChainPlan, ChainRun, TestGenerationWorkflow } from "@apipilot/shared-domain";
import { chainAgent, CHAIN_BASE, createEnvironment, inputOf, newPlan, savePlanContent } from "../fixtures/chain/chainAgent";
import { customerLifecyclePlan } from "../fixtures/chain/chainPlans";
import { TWO_FOLDER_REQUEST_IDS, twoFolderCollection } from "../fixtures/chain/collections";
import { driveToPostmanGenerationComplete } from "../fixtures/execution/driveWorkflow";
import { readyProbe } from "../fixtures/performance/agent";
import { uploadCollection } from "../fixtures/performance/collectionPlans";
import { createFakeRunner } from "../fixtures/performance/fakeRunner";
import { PERFORMANCE_SPECIFICATION_FILENAME, performanceSpecificationBuffer } from "../fixtures/performance/specification";

/**
 * specs/048-workflow-run-stage-status US2: Performance Testing completes when a request-chain run
 * seeded from the guided workflow's specification reaches a final state. The workflow seed is made
 * through the real `POST /api/chain-plans/seed`, so the recorded seed source is the one a user gets.
 */

type Agent = ReturnType<typeof request.agent>;

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function readyAgent(options: { exitCode?: number; hold?: boolean } = {}) {
  const runner = createFakeRunner({ lines: [], exitCode: options.exitCode, holdUntilCancelled: options.hold });
  const { agent } = await chainAgent({ runner, probe: readyProbe() });
  return agent;
}

async function drivePerformanceWorkflow(agent: Agent): Promise<void> {
  await driveToPostmanGenerationComplete(agent, {
    specification: { buffer: performanceSpecificationBuffer(), filename: PERFORMANCE_SPECIFICATION_FILENAME },
  });
}

async function workflowOf(agent: Agent): Promise<TestGenerationWorkflow | null> {
  const response = await agent.get("/api/test-generation-workflow");
  return (response.body.workflow ?? null) as TestGenerationWorkflow | null;
}

async function seedFromWorkflow(agent: Agent): Promise<ChainPlan> {
  const seeded = await agent.post(`${CHAIN_BASE}/seed`).send({ name: "Guided", source: { kind: "workflow" } });
  expect(seeded.status).toBe(201);
  return seeded.body.plan as ChainPlan;
}

/**
 * A seeded plan leaves a step without an expected status when the specification documents none
 * (never fabricated), which blocks the script. The engineer supplies one, as here.
 */
async function makeRunnable(agent: Agent, plan: ChainPlan, environmentId: string): Promise<ChainPlan> {
  const input = inputOf(plan);
  const chains = input.chains.map((chain) => ({
    ...chain,
    steps: chain.steps.map((step) => (step.expectedStatuses.length === 0 ? { ...step, expectedStatuses: ["200"] } : step)),
  }));
  const saved = await agent
    .put(`${CHAIN_BASE}/${plan.id}`)
    .send({ revision: plan.revision, plan: { ...input, chains, targetEnvironmentId: environmentId } });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  return saved.body.plan as ChainPlan;
}

/** Generates the plan's script, starts one run and returns it once it has left in-progress. */
async function runPlan(agent: Agent, seeded: ChainPlan, environmentId: string, cancel = false): Promise<ChainRun> {
  const plan = await makeRunnable(agent, seeded, environmentId);
  const script = await agent.post(`${CHAIN_BASE}/${plan.id}/script`);
  expect(script.status, JSON.stringify(script.body)).toBe(200);
  const started = await agent.post(`${CHAIN_BASE}/${plan.id}/runs`).send({ environmentId });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  const run = started.body.run as ChainRun;
  if (cancel) await agent.post(`${CHAIN_BASE}/runs/${run.id}/cancel`);
  return waitFor(
    async () => (await agent.get(`${CHAIN_BASE}/runs/${run.id}`)).body.run as ChainRun,
    (value) => value.status !== "in-progress",
  );
}

describe("Performance Testing stage completes from a finished chain run (specs/048 US2)", () => {
  it("completes it for a completed run of a plan seeded from the workflow", async () => {
    const agent = await readyAgent();
    await drivePerformanceWorkflow(agent);
    const environmentId = await createEnvironment(agent, {});
    const plan = await seedFromWorkflow(agent);
    const before = await workflowOf(agent);
    expect(before?.stages.performanceTesting.status).toBe("not-yet-reached");

    const run = await runPlan(agent, plan, environmentId);
    expect(run.status).toBe("completed");
    const after = await workflowOf(agent);
    expect(after?.stages.performanceTesting.status).toBe("complete");
    expect(after?.stages.performanceTesting.completedAt).toBeDefined();
  });

  it("completes it for a failed run", async () => {
    const agent = await readyAgent({ exitCode: 1 });
    await drivePerformanceWorkflow(agent);
    const environmentId = await createEnvironment(agent, {});
    const run = await runPlan(agent, await seedFromWorkflow(agent), environmentId);
    expect(run.status).toBe("failed");
    expect((await workflowOf(agent))?.stages.performanceTesting.status).toBe("complete");
  });

  it("completes it for a cancelled run", async () => {
    const agent = await readyAgent({ hold: true });
    await drivePerformanceWorkflow(agent);
    const environmentId = await createEnvironment(agent, {});
    const run = await runPlan(agent, await seedFromWorkflow(agent), environmentId, true);
    expect(run.status).toBe("cancelled");
    expect((await workflowOf(agent))?.stages.performanceTesting.status).toBe("complete");
  });

  it("keeps the completion time when a second run settles", async () => {
    const agent = await readyAgent();
    await drivePerformanceWorkflow(agent);
    const environmentId = await createEnvironment(agent, {});
    const plan = await seedFromWorkflow(agent);
    await runPlan(agent, plan, environmentId);
    const first = (await workflowOf(agent))?.stages.performanceTesting;
    await new Promise((resolve) => setTimeout(resolve, 10));
    const stored = (await agent.get(`${CHAIN_BASE}/${plan.id}`)).body.plan as ChainPlan;
    await runPlan(agent, stored, environmentId);
    expect((await workflowOf(agent))?.stages.performanceTesting).toEqual(first);
  });

  it("does not complete it for a plan built from nothing", async () => {
    const agent = await readyAgent();
    await driveToPostmanGenerationComplete(agent);
    const environmentId = await createEnvironment(agent, { client_id: "id-1", client_secret: "secret-048" });
    const plan = await newPlan(agent);
    await savePlanContent(agent, plan, customerLifecyclePlan({ targetEnvironmentId: environmentId }));
    const stored = (await agent.get(`${CHAIN_BASE}/${plan.id}`)).body.plan as ChainPlan;
    const run = await runPlan(agent, stored, environmentId);
    expect(run.status).toBe("completed");
    expect((await workflowOf(agent))?.stages.performanceTesting.status).toBe("not-yet-reached");
  });

  it("does not complete it for a plan seeded from a collection", async () => {
    const agent = await readyAgent();
    await driveToPostmanGenerationComplete(agent);
    const environmentId = await createEnvironment(agent, {});
    const collectionId = await uploadCollection(agent, twoFolderCollection(), undefined, { name: "Two folders" });
    const seeded = await agent
      .post(`${CHAIN_BASE}/seed`)
      .send({ name: "From collection", source: { kind: "collection", collectionId, orderedRequestIds: TWO_FOLDER_REQUEST_IDS }, environmentId });
    expect(seeded.status).toBe(201);
    const run = await runPlan(agent, seeded.body.plan as ChainPlan, environmentId);
    expect(run.status).toBe("completed");
    expect((await workflowOf(agent))?.stages.performanceTesting.status).toBe("not-yet-reached");
  });

  it("does not complete it when the workflow has since been replaced by one for another specification", async () => {
    const agent = await readyAgent();
    await drivePerformanceWorkflow(agent);
    const environmentId = await createEnvironment(agent, {});
    const plan = await seedFromWorkflow(agent);
    expect((await agent.delete("/api/test-generation-workflow")).status).toBe(204);
    await driveToPostmanGenerationComplete(agent);

    const run = await runPlan(agent, plan, environmentId);
    expect(run.status).toBe("completed");
    expect((await workflowOf(agent))?.stages.performanceTesting.status).toBe("not-yet-reached");
  });
});
