import { beforeEach, describe, expect, it } from "vitest";
import { resetStore } from "../../../src/testGenerationWorkflow/workflowStore";
import { SEEDED_CLIENT_ID, SEEDED_CLIENT_SECRET } from "../../fixtures/performance/builders";
import { createFakeRunner } from "../../fixtures/performance/fakeRunner";
import { PERFORMANCE_BASE as BASE, performanceAgent } from "../../fixtures/performance/agent";

/** contracts/performance-api.md "Plan" and "Script" (tasks T031, T044, T084). */

interface StepBody {
  id: string;
  operationKey: string;
}

function stepsOf(plan: { journeys: { id: string; steps: StepBody[] }[] }): StepBody[] {
  return plan.journeys.flatMap((journey) => journey.steps);
}

function noSecrets(body: unknown): void {
  const text = JSON.stringify(body);
  expect(text).not.toContain(SEEDED_CLIENT_SECRET);
  expect(text).not.toContain(SEEDED_CLIENT_ID);
}

describe("performance plan and script routes", () => {
  beforeEach(() => resetStore());

  it("refuses every plan and script route before Postman generation is complete (research D1)", async () => {
    const { agent } = await performanceAgent({ runner: createFakeRunner({ lines: [] }) }, { drive: false });
    for (const response of [
      await agent.get(`${BASE}/plan`),
      await agent.put(`${BASE}/plan`).send({}),
      await agent.post(`${BASE}/plan/reset`),
      await agent.get(`${BASE}/plan/values?environmentId=x`),
      await agent.post(`${BASE}/script`),
      await agent.get(`${BASE}/script/download?file=script`),
    ]) {
      expect(response.status).toBe(409);
      expect(response.body.error).toBe("postman_generation_incomplete");
    }
  });

  it("builds the proposed plan on first read and enters the stage", async () => {
    const { agent } = await performanceAgent({ runner: createFakeRunner({ lines: [] }) });
    const response = await agent.get(`${BASE}/plan`);
    expect(response.status).toBe(200);
    expect(response.body.script).toBeNull();
    expect(stepsOf(response.body.plan).map((step) => step.operationKey)).toEqual([
      "POST /orders",
      "GET /orders/{orderId}",
      "GET /status",
      "GET /warehouses/{warehouseId}",
    ]);
    const workflow = (await agent.get("/api/test-generation-workflow")).body.workflow;
    expect(workflow.stages.performanceTesting.status).toBe("active");
    expect(workflow.activeStageId).toBe("performanceTesting");
    expect(workflow.performancePlan.fingerprint).toBe(response.body.plan.fingerprint);
    expect(JSON.stringify(workflow)).not.toContain("k6/http");
  }, 30_000);

  it("updates the plan and leaves it unchanged when an update is rejected", async () => {
    const { agent } = await performanceAgent({ runner: createFakeRunner({ lines: [] }) });
    const plan = (await agent.get(`${BASE}/plan`)).body.plan;
    const status = stepsOf(plan).find((step) => step.operationKey === "GET /status")!;

    const rejected = [
      [{ expectedStatuses: { [status.id]: [] } }, "invalid_expected_status"],
      [{ expectedStatuses: { nope: ["200"] } }, "invalid_expected_status"],
      [{ loadProfile: { kind: "load", stages: [] } }, "invalid_load_profile"],
      [{ thinkTimeMs: -1 }, "invalid_load_profile"],
      [{ thresholds: [{ scope: { kind: "run" }, metric: "p95", comparator: "<=", limit: 0 }] }, "invalid_threshold"],
      [{ excludedOperationKeys: ["DELETE /nothing"] }, "unknown_operation"],
      [{ journeyOrder: ["a"] }, "invalid_order"],
    ] as const;
    for (const [body, error] of rejected) {
      const response = await agent.put(`${BASE}/plan`).send(body);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe(error);
    }
    expect((await agent.get(`${BASE}/plan`)).body.plan.fingerprint).toBe(plan.fingerprint);

    const updated = await agent.put(`${BASE}/plan`).send({
      expectedStatuses: { [status.id]: ["200"] },
      thresholds: [{ scope: { kind: "run" }, metric: "p95", comparator: "<=", limit: 500 }],
      thinkTimeMs: 1000,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.plan.stepsNeedingExpectedStatus).toEqual([]);
    expect(updated.body.plan.thresholds).toHaveLength(1);
    expect(updated.body.plan.thinkTimeMs).toBe(1000);
  }, 30_000);

  it("rejects a reorder that breaks a dependency, naming the variable (FR-007, SC-009)", async () => {
    const { agent } = await performanceAgent({ runner: createFakeRunner({ lines: [] }) });
    const plan = (await agent.get(`${BASE}/plan`)).body.plan;
    const workflowJourney = plan.journeys[0];
    const reversed = [...workflowJourney.steps].reverse().map((step: StepBody) => step.id);
    const response = await agent.put(`${BASE}/plan`).send({ stepOrder: { [workflowJourney.id]: reversed } });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "dependency_order_violation", variable: "orderId" });

    const swapped = [plan.journeys[2].id, plan.journeys[1].id, plan.journeys[0].id];
    const reordered = await agent.put(`${BASE}/plan`).send({ journeyOrder: swapped });
    expect(reordered.status).toBe(200);
    expect(reordered.body.plan.journeys.map((journey: { id: string }) => journey.id)).toEqual(swapped);
  }, 30_000);

  it("reports value presence per environment without values, and 404 for an unknown environment (FR-013)", async () => {
    const { agent, environmentId } = await performanceAgent({ runner: createFakeRunner({ lines: [] }) }, { variableValues: { clientId: SEEDED_CLIENT_ID, clientSecret: SEEDED_CLIENT_SECRET } });
    await agent.get(`${BASE}/plan`);
    const response = await agent.get(`${BASE}/plan/values?environmentId=${environmentId}`);
    expect(response.status).toBe(200);
    expect(response.body.environment).toEqual({ id: environmentId, name: "perf-local", tier: "local", baseUrl: "http://127.0.0.1:4600" });
    expect(response.body.values.map((value: { name: string; present: boolean }) => [value.name, value.present])).toEqual([
      ["baseUrl", true],
      ["clientId", true],
      ["clientSecret", true],
      ["warehouseId", false],
    ]);
    noSecrets(response.body);
    expect((await agent.get(`${BASE}/plan/values?environmentId=missing`)).status).toBe(404);
  }, 30_000);

  it("refuses to generate while a step needs an expected status, then generates a stable script (FR-012a, SC-001)", async () => {
    const { agent } = await performanceAgent({ runner: createFakeRunner({ lines: [] }) });
    const plan = (await agent.get(`${BASE}/plan`)).body.plan;
    const status = stepsOf(plan).find((step) => step.operationKey === "GET /status")!;

    const blocked = await agent.post(`${BASE}/script`);
    expect(blocked.status).toBe(422);
    expect(blocked.body).toMatchObject({ error: "expected_status_missing", stepIds: [status.id] });
    expect((await agent.get(`${BASE}/script/download?file=script`)).status).toBe(404);

    await agent.put(`${BASE}/plan`).send({ expectedStatuses: { [status.id]: ["200"] } });
    const first = await agent.post(`${BASE}/script`);
    const second = await agent.post(`${BASE}/script`);
    expect(first.status).toBe(200);
    expect(first.body.script).toMatchObject({ outOfDate: false, stepCount: 4 });
    expect(second.body.script.scriptSha256).toBe(first.body.script.scriptSha256);
    const workflow = (await agent.get("/api/test-generation-workflow")).body.workflow;
    expect(workflow.stages.performanceTesting.status).toBe("complete");

    const script = await agent.get(`${BASE}/script/download?file=script`);
    expect(script.status).toBe(200);
    expect(script.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(script.headers["content-disposition"]).toBe('attachment; filename="apipilot-performance.js"');
    const template = await agent.get(`${BASE}/script/download?file=environment-template`);
    expect(template.headers["content-type"]).toMatch(/^application\/json/);
    noSecrets(script.text);
    noSecrets(template.text);
  }, 30_000);

  it("marks the script out of date after a plan edit and moves the stage back to active (FR-023)", async () => {
    const { agent } = await performanceAgent({ runner: createFakeRunner({ lines: [] }) });
    const plan = (await agent.get(`${BASE}/plan`)).body.plan;
    const status = stepsOf(plan).find((step) => step.operationKey === "GET /status")!;
    await agent.put(`${BASE}/plan`).send({ expectedStatuses: { [status.id]: ["200"] } });
    await agent.post(`${BASE}/script`);

    const edited = await agent.put(`${BASE}/plan`).send({ thinkTimeMs: 500 });
    expect(edited.body.script.outOfDate).toBe(true);
    expect((await agent.get("/api/test-generation-workflow")).body.workflow.stages.performanceTesting.status).toBe("active");
    const download = await agent.get(`${BASE}/script/download?file=script`);
    expect(download.status).toBe(409);
    expect(download.body.error).toBe("script_out_of_date");
  }, 30_000);

  it("resets the proposed plan while keeping the profile, thresholds and surviving expected statuses (D26)", async () => {
    const { agent } = await performanceAgent({ runner: createFakeRunner({ lines: [] }) });
    const plan = (await agent.get(`${BASE}/plan`)).body.plan;
    const status = stepsOf(plan).find((step) => step.operationKey === "GET /status")!;
    await agent.put(`${BASE}/plan`).send({
      expectedStatuses: { [status.id]: ["200"] },
      loadProfile: { kind: "load", stages: [{ durationMs: 60_000, targetVirtualUsers: 5 }] },
      journeyOrder: [plan.journeys[2].id, plan.journeys[1].id, plan.journeys[0].id],
    });
    const reset = await agent.post(`${BASE}/plan/reset`);
    expect(reset.status).toBe(200);
    expect(reset.body.plan.loadProfile.kind).toBe("load");
    expect(reset.body.plan.stepsNeedingExpectedStatus).toEqual([]);
    expect(reset.body.plan.journeys.map((journey: { id: string }) => journey.id)).toEqual(plan.journeys.map((journey: { id: string }) => journey.id));
  }, 30_000);
});
